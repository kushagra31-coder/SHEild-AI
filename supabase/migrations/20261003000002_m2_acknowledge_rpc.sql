-- M2: Narrowly-scoped SECURITY DEFINER function for guardian incident acknowledgement.
-- This function is the ONLY way a guardian can transition an incident to 'acknowledged'.
-- No broad UPDATE policy is granted to guardians on public.incidents.

CREATE OR REPLACE FUNCTION public.acknowledge_incident(
    p_incident_id UUID,
    p_guardian_id UUID,
    p_note        VARCHAR(280)
)
RETURNS TABLE(
    id              UUID,
    incident_id     UUID,
    guardian_id     UUID,
    acknowledged_at TIMESTAMPTZ,
    note            VARCHAR(280)
)
LANGUAGE plpgsql
SECURITY DEFINER
-- Explicit search_path prevents search_path injection
SET search_path = public, pg_temp
AS $$
DECLARE
    v_incident_status TEXT;
    v_link_exists     BOOLEAN;
    v_ack_id          UUID;
    v_ack_at          TIMESTAMPTZ;
BEGIN
    -- 1. Verify caller is auth.uid() == p_guardian_id (prevents caller spoofing)
    IF auth.uid() IS DISTINCT FROM p_guardian_id THEN
        RAISE EXCEPTION 'FORBIDDEN: caller does not match guardian_id'
            USING ERRCODE = '42501';
    END IF;

    -- 2. Verify guardian has an active, accepted, non-revoked link to the incident owner
    SELECT EXISTS (
        SELECT 1
        FROM   public.incidents i
        JOIN   public.guardian_links gl
               ON gl.owner_id = i.owner_id
        WHERE  i.id            = p_incident_id
        AND    gl.guardian_id  = p_guardian_id
        AND    gl.status       = 'accepted'
        AND    gl.revoked_at   IS NULL
    ) INTO v_link_exists;

    IF NOT v_link_exists THEN
        RAISE EXCEPTION 'FORBIDDEN: not an accepted guardian for this incident'
            USING ERRCODE = '42501';
    END IF;

    -- 3. Fetch current incident status (lock row for update)
    SELECT i.status INTO v_incident_status
    FROM   public.incidents i
    WHERE  i.id = p_incident_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'NOT_FOUND: incident does not exist'
            USING ERRCODE = '02000';
    END IF;

    -- 4. Enforce valid transition: only 'active' → 'acknowledged' is permitted
    IF v_incident_status NOT IN ('active') THEN
        RAISE EXCEPTION 'CONFLICT: incident status is % and cannot be acknowledged', v_incident_status
            USING ERRCODE = '23514';
    END IF;

    -- 5. Insert acknowledgement (idempotent: ON CONFLICT DO NOTHING)
    INSERT INTO public.incident_acknowledgements (incident_id, guardian_id, note, acknowledged_at)
    VALUES (p_incident_id, p_guardian_id, p_note, now())
    ON CONFLICT ON CONSTRAINT uq_acknowledgements_incident_guardian DO NOTHING
    RETURNING
        incident_acknowledgements.id,
        incident_acknowledgements.acknowledged_at,
        incident_acknowledgements.note
    INTO v_ack_id, v_ack_at, p_note;

    -- If row already existed, fetch it
    IF v_ack_id IS NULL THEN
        SELECT ia.id, ia.acknowledged_at, ia.note
        INTO   v_ack_id, v_ack_at, p_note
        FROM   public.incident_acknowledgements ia
        WHERE  ia.incident_id = p_incident_id
        AND    ia.guardian_id = p_guardian_id;
    END IF;

    -- 6. Transition incident status to 'acknowledged'
    UPDATE public.incidents
    SET    status     = 'acknowledged',
           updated_at = now()
    WHERE  id         = p_incident_id
    AND    status     = 'active';  -- guard against concurrent transitions

    -- 7. Return the acknowledgement record
    RETURN QUERY
    SELECT
        v_ack_id,
        p_incident_id,
        p_guardian_id,
        v_ack_at,
        p_note;
END;
$$;

-- Revoke default PUBLIC execute, grant only to authenticated role
REVOKE ALL ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) TO authenticated;
