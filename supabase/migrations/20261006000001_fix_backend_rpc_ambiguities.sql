-- Qualify PL/pgSQL output-column names that overlap table columns.
CREATE OR REPLACE FUNCTION public.accept_guardian_invite(p_token_hash TEXT, p_guardian_id UUID)
RETURNS TABLE(id UUID, owner_id UUID, guardian_id UUID, priority INTEGER, status TEXT, consented_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_invite public.guardian_invites%ROWTYPE; v_now TIMESTAMPTZ := now();
BEGIN
  IF auth.uid() IS DISTINCT FROM p_guardian_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_invite FROM public.guardian_invites WHERE token_hash = p_token_hash FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVALID' USING ERRCODE = '22023'; END IF;
  IF v_invite.expires_at <= v_now THEN RAISE EXCEPTION 'EXPIRED' USING ERRCODE = '22023'; END IF;
  IF v_invite.used_at IS NOT NULL THEN RAISE EXCEPTION 'USED' USING ERRCODE = '22023'; END IF;
  IF v_invite.owner_id = p_guardian_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_invite.owner_id::text || ':priority:' || v_invite.priority::text, 0));
  IF EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.owner_id = v_invite.owner_id
    AND gl.priority = v_invite.priority AND gl.status = 'accepted' AND gl.revoked_at IS NULL
    AND gl.guardian_id <> p_guardian_id)
    OR EXISTS (SELECT 1 FROM public.guardian_invites gi WHERE gi.owner_id = v_invite.owner_id
      AND gi.priority = v_invite.priority AND gi.id <> v_invite.id AND gi.used_at IS NULL AND gi.expires_at > v_now)
    THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505'; END IF;
  INSERT INTO public.guardian_links(owner_id, guardian_id, priority, status, consented_at)
  VALUES (v_invite.owner_id, p_guardian_id, v_invite.priority, 'accepted', v_now)
  ON CONFLICT ON CONSTRAINT uq_guardian_links_owner_guardian DO UPDATE
    SET status = 'accepted', priority = EXCLUDED.priority, consented_at = v_now,
        revoked_at = NULL, updated_at = v_now
    WHERE public.guardian_links.status = 'revoked';
  IF NOT FOUND THEN RAISE EXCEPTION 'USED' USING ERRCODE = '23505'; END IF;
  UPDATE public.guardian_invites SET used_at = v_now, accepted_by = p_guardian_id WHERE id = v_invite.id;
  RETURN QUERY SELECT gl.id, gl.owner_id, gl.guardian_id, gl.priority, gl.status, gl.consented_at
    FROM public.guardian_links gl WHERE gl.owner_id = v_invite.owner_id AND gl.guardian_id = p_guardian_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505';
END; $$;

CREATE OR REPLACE FUNCTION public.submit_incident_location(
  p_incident_id UUID, p_owner_id UUID, p_latitude DOUBLE PRECISION, p_longitude DOUBLE PRECISION,
  p_accuracy_m REAL, p_captured_at TIMESTAMPTZ, p_expires_at TIMESTAMPTZ
)
RETURNS TABLE(id UUID, incident_id UUID, latitude DOUBLE PRECISION, longitude DOUBLE PRECISION,
  accuracy_m REAL, captured_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_incident public.incidents%ROWTYPE; v_location public.incident_locations%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT i.* INTO v_incident FROM public.incidents i
   WHERE i.id = p_incident_id AND i.owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_incident.status NOT IN ('active', 'acknowledged') THEN RAISE EXCEPTION 'INCIDENT_CLOSED' USING ERRCODE = '23514'; END IF;
  IF NOT v_incident.share_location THEN RAISE EXCEPTION 'LOCATION_SHARING_DISABLED' USING ERRCODE = '23514'; END IF;
  SELECT il.* INTO v_location FROM public.incident_locations il
   WHERE il.incident_id = p_incident_id AND il.captured_at = p_captured_at
   ORDER BY il.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF (v_location.latitude, v_location.longitude, v_location.accuracy_m)
       IS DISTINCT FROM (p_latitude, p_longitude, p_accuracy_m)
      THEN RAISE EXCEPTION 'LOCATION_CONFLICT' USING ERRCODE = '23505'; END IF;
    RETURN QUERY SELECT v_location.id, v_location.incident_id, v_location.latitude, v_location.longitude,
      v_location.accuracy_m, v_location.captured_at, v_location.expires_at;
    RETURN;
  END IF;
  INSERT INTO public.incident_locations(incident_id, latitude, longitude, accuracy_m, captured_at, expires_at)
  VALUES (p_incident_id, p_latitude, p_longitude, p_accuracy_m, p_captured_at,
    LEAST(p_expires_at, now() + interval '48 hours', p_captured_at + interval '48 hours'))
  RETURNING * INTO v_location;
  RETURN QUERY SELECT v_location.id, v_location.incident_id, v_location.latitude, v_location.longitude,
    v_location.accuracy_m, v_location.captured_at, v_location.expires_at;
END; $$;

CREATE OR REPLACE FUNCTION public.acknowledge_incident(
  p_incident_id UUID, p_guardian_id UUID, p_note VARCHAR(280)
)
RETURNS TABLE(id UUID, incident_id UUID, guardian_id UUID, acknowledged_at TIMESTAMPTZ, note VARCHAR(280))
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_status TEXT; v_ack public.incident_acknowledgements%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_guardian_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.incidents i JOIN public.guardian_links gl ON gl.owner_id = i.owner_id
     WHERE i.id = p_incident_id AND gl.guardian_id = p_guardian_id
       AND gl.status = 'accepted' AND gl.revoked_at IS NULL
  ) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT i.status INTO v_status FROM public.incidents i WHERE i.id = p_incident_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_status = 'acknowledged' THEN
    SELECT ia.* INTO v_ack FROM public.incident_acknowledgements ia
     WHERE ia.incident_id = p_incident_id AND ia.guardian_id = p_guardian_id;
    IF FOUND THEN
      UPDATE public.alert_deliveries d SET state = 'acknowledged', updated_at = now()
       WHERE d.incident_id = p_incident_id AND d.guardian_id = p_guardian_id;
      RETURN QUERY SELECT v_ack.id, v_ack.incident_id, v_ack.guardian_id, v_ack.acknowledged_at, v_ack.note;
      RETURN;
    END IF;
  END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.incident_acknowledgements(incident_id, guardian_id, note)
    VALUES (p_incident_id, p_guardian_id, p_note) RETURNING * INTO v_ack;
  UPDATE public.incidents i SET status = 'acknowledged', updated_at = now()
   WHERE i.id = p_incident_id AND i.status = 'active';
  UPDATE public.alert_deliveries d SET state = 'acknowledged', updated_at = now()
   WHERE d.incident_id = p_incident_id AND d.guardian_id = p_guardian_id;
  RETURN QUERY SELECT v_ack.id, v_ack.incident_id, v_ack.guardian_id, v_ack.acknowledged_at, v_ack.note;
END; $$;
