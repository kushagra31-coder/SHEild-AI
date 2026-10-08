-- Atomic guardian consent; only the hash ever reaches this function.
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
  ON CONFLICT (owner_id, guardian_id) DO UPDATE
    SET status = 'accepted', priority = EXCLUDED.priority, consented_at = v_now,
        revoked_at = NULL, updated_at = v_now
    WHERE public.guardian_links.status = 'revoked';
  IF NOT FOUND THEN RAISE EXCEPTION 'USED' USING ERRCODE = '23505'; END IF;
  UPDATE public.guardian_invites SET used_at = v_now, accepted_by = p_guardian_id WHERE id = v_invite.id;
  RETURN QUERY SELECT gl.id, gl.owner_id, gl.guardian_id, gl.priority, gl.status, gl.consented_at
    FROM public.guardian_links gl WHERE gl.owner_id = v_invite.owner_id AND gl.guardian_id = p_guardian_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505';
END; $$;
REVOKE ALL ON FUNCTION public.accept_guardian_invite(TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.accept_guardian_invite(TEXT, UUID) TO authenticated;

-- Invites are owner-managed; guardians cannot alter accepted links directly.
DROP POLICY IF EXISTS "Guardians can update their link status" ON public.guardian_links;
DROP POLICY IF EXISTS "Users can manage their own invites" ON public.guardian_invites;
CREATE POLICY "Owners can read own invites" ON public.guardian_invites FOR SELECT USING (auth.uid() = owner_id);
CREATE OR REPLACE FUNCTION public.create_guardian_invite(
  p_owner_id UUID, p_display_name TEXT, p_phone_number TEXT, p_priority INTEGER, p_token_hash TEXT
)
RETURNS TABLE(id UUID, display_name TEXT, priority INTEGER, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_phone TEXT; v_own_phone TEXT; v_id UUID; v_expires TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  v_phone := regexp_replace(coalesce(p_phone_number, ''), '\D', '', 'g');
  IF char_length(trim(coalesce(p_display_name, ''))) = 0 OR char_length(v_phone) < 3
    OR p_priority IS NULL OR p_priority < 1 OR p_token_hash !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'INVALID_INVITE' USING ERRCODE = '23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':phone:' || v_phone, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':priority:' || p_priority::text, 0));
  SELECT regexp_replace(coalesce(pr.phone_number, ''), '\D', '', 'g') INTO v_own_phone
    FROM public.profiles pr WHERE pr.id = p_owner_id;
  IF v_phone = v_own_phone AND v_phone <> '' THEN RAISE EXCEPTION 'SELF_INVITE' USING ERRCODE = '23514'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.guardian_invites gi WHERE gi.owner_id = p_owner_id AND gi.used_at IS NULL
      AND gi.expires_at > now() AND regexp_replace(gi.phone_number, '\D', '', 'g') = v_phone
  ) THEN RAISE EXCEPTION 'DUPLICATE_INVITE' USING ERRCODE = '23505'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.guardian_links gl WHERE gl.owner_id = p_owner_id AND gl.priority = p_priority
      AND gl.status = 'accepted' AND gl.revoked_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.guardian_invites gi WHERE gi.owner_id = p_owner_id AND gi.priority = p_priority
      AND gi.used_at IS NULL AND gi.expires_at > now()
  ) THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505'; END IF;
  v_expires := now() + interval '7 days';
  INSERT INTO public.guardian_invites(owner_id, display_name, phone_number, priority, token_hash, expires_at)
  VALUES (p_owner_id, trim(p_display_name), trim(p_phone_number), p_priority, p_token_hash, v_expires)
  RETURNING guardian_invites.id INTO v_id;
  RETURN QUERY SELECT v_id, trim(p_display_name), p_priority, v_expires;
END; $$;
REVOKE ALL ON FUNCTION public.create_guardian_invite(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_guardian_invite(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
DROP POLICY IF EXISTS "Owners can manage links" ON public.guardian_links;
DROP POLICY IF EXISTS "Guardians can view and accept their links" ON public.guardian_links;
CREATE POLICY "Owners can read own links" ON public.guardian_links FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Guardians can read their own links" ON public.guardian_links FOR SELECT USING (auth.uid() = guardian_id);

CREATE OR REPLACE FUNCTION public.revoke_guardian_link(p_link_id UUID, p_owner_id UUID)
RETURNS SETOF public.guardian_links LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_link public.guardian_links%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_link FROM public.guardian_links WHERE id = p_link_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_link.status <> 'revoked' OR v_link.revoked_at IS NULL THEN
    UPDATE public.guardian_links SET status = 'revoked', revoked_at = now(), updated_at = now()
     WHERE id = p_link_id RETURNING * INTO v_link;
  END IF;
  RETURN NEXT v_link;
END; $$;
REVOKE ALL ON FUNCTION public.revoke_guardian_link(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_guardian_priority(p_link_id UUID, p_owner_id UUID, p_priority INTEGER)
RETURNS SETOF public.guardian_links LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_link public.guardian_links%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_priority IS NULL OR p_priority < 1 THEN RAISE EXCEPTION 'INVALID_PRIORITY' USING ERRCODE = '23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_owner_id::text || ':priority:' || p_priority::text, 0));
  IF EXISTS (SELECT 1 FROM public.guardian_invites gi WHERE gi.owner_id = p_owner_id
    AND gi.priority = p_priority AND gi.used_at IS NULL AND gi.expires_at > now())
    THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505'; END IF;
  UPDATE public.guardian_links SET priority = p_priority, updated_at = now()
   WHERE id = p_link_id AND owner_id = p_owner_id AND status = 'accepted' AND revoked_at IS NULL
   RETURNING * INTO v_link;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  RETURN NEXT v_link;
END; $$;
REVOKE ALL ON FUNCTION public.update_guardian_priority(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_guardian_priority(UUID, UUID, INTEGER) TO authenticated;

-- Acknowledgements are written only by the narrow acknowledgement RPC.
DROP POLICY IF EXISTS "Guardians can insert and view their own acknowledgements" ON public.incident_acknowledgements;
CREATE POLICY "Guardians can view own acknowledgements" ON public.incident_acknowledgements FOR SELECT USING (auth.uid() = guardian_id);

DROP POLICY IF EXISTS "Users can manage their own journeys" ON public.journeys;
ALTER TABLE public.journeys ADD COLUMN IF NOT EXISTS client_event_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS uq_journeys_owner_client_event
  ON public.journeys(owner_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE POLICY "Owners can read own journeys" ON public.journeys FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Owners can create own journeys" ON public.journeys FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Accepted guardians can view selected journeys" ON public.journeys FOR SELECT USING (
  guardian_ids @> ARRAY[auth.uid()] AND EXISTS (
    SELECT 1 FROM public.guardian_links gl WHERE gl.owner_id = journeys.owner_id
      AND gl.guardian_id = auth.uid() AND gl.status = 'accepted' AND gl.revoked_at IS NULL
  )
);

-- Owners create incidents and locations, but lifecycle mutation is restricted to the RPCs below.
DROP POLICY IF EXISTS "Users can manage their own incidents" ON public.incidents;
CREATE POLICY "Owners can read own incidents" ON public.incidents FOR SELECT USING (auth.uid() = owner_id);
CREATE POLICY "Owners can create own incidents" ON public.incidents FOR INSERT WITH CHECK (auth.uid() = owner_id);
DROP POLICY IF EXISTS "Users can manage their own incident locations" ON public.incident_locations;
CREATE POLICY "Owners can read own incident locations" ON public.incident_locations FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = incident_locations.incident_id AND i.owner_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.guard_incident_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM NEW.owner_id OR NEW.status <> 'active'
    THEN RAISE EXCEPTION 'INVALID_INCIDENT' USING ERRCODE = '23514'; END IF;
  NEW.expires_at := LEAST(NEW.expires_at, now() + interval '24 hours');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_incident_insert ON public.incidents;
CREATE TRIGGER guard_incident_insert BEFORE INSERT ON public.incidents
  FOR EACH ROW EXECUTE FUNCTION public.guard_incident_insert();

-- Prevent direct authenticated writes from skipping journey invariants or consent checks.
CREATE OR REPLACE FUNCTION public.guard_journey_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_guardian UUID;
BEGIN
  IF auth.uid() IS DISTINCT FROM NEW.owner_id OR NEW.status <> 'in_progress' OR NEW.eta_at <= now()
    OR char_length(trim(NEW.destination_label)) = 0 OR NEW.grace_seconds > 86400
    OR (NEW.destination_lat IS NULL) <> (NEW.destination_lon IS NULL)
    THEN RAISE EXCEPTION 'INVALID_JOURNEY' USING ERRCODE = '23514'; END IF;
  IF NEW.guardian_ids IS NOT NULL THEN
    FOREACH v_guardian IN ARRAY NEW.guardian_ids LOOP
      IF NOT EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.owner_id = NEW.owner_id
        AND gl.guardian_id = v_guardian AND gl.status = 'accepted' AND gl.revoked_at IS NULL)
        THEN RAISE EXCEPTION 'INVALID_GUARDIAN' USING ERRCODE = '23514'; END IF;
    END LOOP;
  END IF;
  NEW.expires_at := NEW.eta_at + make_interval(secs => NEW.grace_seconds);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_journey_insert ON public.journeys;
CREATE TRIGGER guard_journey_insert BEFORE INSERT ON public.journeys
  FOR EACH ROW EXECUTE FUNCTION public.guard_journey_insert();

CREATE OR REPLACE FUNCTION public.transition_journey(p_journey_id UUID, p_owner_id UUID, p_target TEXT)
RETURNS SETOF public.journeys LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_journey public.journeys%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_target NOT IN ('completed', 'cancelled') THEN RAISE EXCEPTION 'INVALID_TARGET' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_journey FROM public.journeys WHERE id = p_journey_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_journey.status = p_target THEN RETURN NEXT v_journey; RETURN; END IF;
  IF v_journey.status <> 'in_progress' THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE = '23514'; END IF;
  UPDATE public.journeys SET status = p_target, updated_at = now()
   WHERE id = p_journey_id RETURNING * INTO v_journey;
  RETURN NEXT v_journey;
END; $$;
REVOKE ALL ON FUNCTION public.transition_journey(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transition_journey(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_incident(p_incident_id UUID, p_owner_id UUID)
RETURNS SETOF public.incidents LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_incident public.incidents%ROWTYPE;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_incident.status = 'resolved' THEN RETURN NEXT v_incident; RETURN; END IF;
  IF v_incident.status NOT IN ('active', 'acknowledged') THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE = '23514'; END IF;
  UPDATE public.incidents SET status = 'resolved', resolved_at = now(), updated_at = now()
   WHERE id = p_incident_id RETURNING * INTO v_incident;
  RETURN NEXT v_incident;
END; $$;
REVOKE ALL ON FUNCTION public.resolve_incident(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_incident(UUID, UUID) TO authenticated;

ALTER TABLE public.journeys DROP CONSTRAINT IF EXISTS journeys_destination_lat_check;
ALTER TABLE public.journeys ADD CONSTRAINT journeys_destination_lat_check
  CHECK (destination_lat IS NULL OR destination_lat BETWEEN -90 AND 90);
ALTER TABLE public.journeys DROP CONSTRAINT IF EXISTS journeys_destination_lon_check;
ALTER TABLE public.journeys ADD CONSTRAINT journeys_destination_lon_check
  CHECK (destination_lon IS NULL OR destination_lon BETWEEN -180 AND 180);

-- Capture time is the mobile sample idempotency key; row locking serializes retries without deleting old data.
CREATE OR REPLACE FUNCTION public.guard_incident_location_insert()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_owner UUID; v_status TEXT; v_sharing BOOLEAN;
BEGIN
  SELECT i.owner_id, i.status, i.share_location INTO v_owner, v_status, v_sharing
    FROM public.incidents i WHERE i.id = NEW.incident_id FOR UPDATE;
  IF NOT FOUND OR auth.uid() IS DISTINCT FROM v_owner THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF v_status NOT IN ('active', 'acknowledged') THEN RAISE EXCEPTION 'INCIDENT_CLOSED' USING ERRCODE = '23514'; END IF;
  IF NOT v_sharing THEN RAISE EXCEPTION 'LOCATION_SHARING_DISABLED' USING ERRCODE = '23514'; END IF;
  NEW.expires_at := LEAST(NEW.expires_at, NEW.captured_at + interval '48 hours', now() + interval '48 hours');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS guard_incident_location_insert ON public.incident_locations;
CREATE TRIGGER guard_incident_location_insert BEFORE INSERT ON public.incident_locations
  FOR EACH ROW EXECUTE FUNCTION public.guard_incident_location_insert();

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
  SELECT * INTO v_incident FROM public.incidents WHERE id = p_incident_id AND owner_id = p_owner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000'; END IF;
  IF v_incident.status NOT IN ('active', 'acknowledged') THEN RAISE EXCEPTION 'INCIDENT_CLOSED' USING ERRCODE = '23514'; END IF;
  IF NOT v_incident.share_location THEN RAISE EXCEPTION 'LOCATION_SHARING_DISABLED' USING ERRCODE = '23514'; END IF;
  SELECT * INTO v_location FROM public.incident_locations
   WHERE incident_locations.incident_id = p_incident_id AND incident_locations.captured_at = p_captured_at
   ORDER BY created_at DESC LIMIT 1;
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
REVOKE ALL ON FUNCTION public.submit_incident_location(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, REAL, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_incident_location(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, REAL, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Safe to call repeatedly from a scheduled database job; expired coordinates are not served meanwhile.
CREATE OR REPLACE FUNCTION public.delete_expired_incident_locations()
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE deleted_count BIGINT;
BEGIN
  DELETE FROM public.incident_locations WHERE expires_at <= now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END; $$;
REVOKE ALL ON FUNCTION public.delete_expired_incident_locations() FROM PUBLIC, authenticated;

-- Run from a trusted scheduler. State transition and unique alert-job inserts commit together.
CREATE TABLE public.journey_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.journeys(id) ON DELETE CASCADE,
  guardian_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  priority INTEGER NOT NULL CHECK (priority >= 1),
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued', 'provider_accepted', 'provider_failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_journey_alert_guardian UNIQUE (journey_id, guardian_id)
);
ALTER TABLE public.journey_alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.journey_alerts TO authenticated;
CREATE INDEX idx_journey_alerts_worker ON public.journey_alerts(state, next_attempt_at) WHERE state IN ('queued', 'provider_failed');
CREATE POLICY "Journey owners and selected guardians read journey alerts" ON public.journey_alerts FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.journeys j WHERE j.id = journey_alerts.journey_id
    AND (j.owner_id = auth.uid() OR (j.guardian_ids @> ARRAY[auth.uid()] AND EXISTS (
      SELECT 1 FROM public.guardian_links gl WHERE gl.owner_id = j.owner_id
        AND gl.guardian_id = auth.uid() AND gl.status = 'accepted' AND gl.revoked_at IS NULL
    ))))
);
CREATE OR REPLACE FUNCTION public.process_missed_journeys()
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed_count BIGINT;
BEGIN
  WITH missed AS (
    UPDATE public.journeys
       SET status = 'missed_check_in', updated_at = now()
     WHERE status = 'in_progress'
       AND eta_at + make_interval(secs => grace_seconds) <= now()
    RETURNING id, owner_id, guardian_ids
  ), jobs AS (
    INSERT INTO public.journey_alerts(journey_id, guardian_id, priority, state, attempt_count)
    SELECT m.id, gl.guardian_id, gl.priority, 'queued', 0
      FROM missed m CROSS JOIN LATERAL unnest(m.guardian_ids) AS selected(guardian_id)
      JOIN public.guardian_links gl ON gl.owner_id = m.owner_id
        AND gl.guardian_id = selected.guardian_id AND gl.status = 'accepted' AND gl.revoked_at IS NULL
      ORDER BY gl.priority
    ON CONFLICT (journey_id, guardian_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO changed_count FROM missed;
  RETURN changed_count;
END; $$;
REVOKE ALL ON FUNCTION public.process_missed_journeys() FROM PUBLIC, authenticated;

CREATE POLICY "Accepted guardians can read own incident deliveries" ON public.alert_deliveries FOR SELECT USING (
  guardian_id = auth.uid() AND EXISTS (
    SELECT 1 FROM public.incidents i JOIN public.guardian_links gl ON gl.owner_id = i.owner_id
    WHERE i.id = alert_deliveries.incident_id AND gl.guardian_id = auth.uid()
      AND gl.status = 'accepted' AND gl.revoked_at IS NULL
  )
);

-- Make acknowledgement retries safe for the same guardian; concurrent other guardians receive a conflict.
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
    SELECT * INTO v_ack FROM public.incident_acknowledgements ia
     WHERE ia.incident_id = p_incident_id AND ia.guardian_id = p_guardian_id;
    IF FOUND THEN
      UPDATE public.alert_deliveries SET state = 'acknowledged', updated_at = now()
       WHERE incident_id = p_incident_id AND guardian_id = p_guardian_id;
      RETURN QUERY SELECT v_ack.id, v_ack.incident_id, v_ack.guardian_id, v_ack.acknowledged_at, v_ack.note;
      RETURN;
    END IF;
  END IF;
  IF v_status <> 'active' THEN RAISE EXCEPTION 'CONFLICT' USING ERRCODE = '23514'; END IF;
  INSERT INTO public.incident_acknowledgements(incident_id, guardian_id, note)
    VALUES (p_incident_id, p_guardian_id, p_note) RETURNING * INTO v_ack;
  UPDATE public.incidents SET status = 'acknowledged', updated_at = now()
   WHERE id = p_incident_id AND status = 'active';
  UPDATE public.alert_deliveries SET state = 'acknowledged', updated_at = now()
   WHERE incident_id = p_incident_id AND guardian_id = p_guardian_id;
  RETURN QUERY SELECT v_ack.id, v_ack.incident_id, v_ack.guardian_id, v_ack.acknowledged_at, v_ack.note;
END; $$;
REVOKE ALL ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) TO authenticated;

-- Queueing is authorized as the incident owner and safely repeats on client retries.
CREATE OR REPLACE FUNCTION public.queue_incident_alerts(p_incident_id UUID, p_owner_id UUID)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE queued_count BIGINT;
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.incidents i WHERE i.id = p_incident_id AND i.owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE = '02000';
  END IF;
  INSERT INTO public.alert_deliveries(incident_id, guardian_id, channel, stage, state)
  SELECT p_incident_id, gl.guardian_id, 'push_fcm', gl.priority, 'queued'
    FROM public.guardian_links gl
   WHERE gl.owner_id = p_owner_id AND gl.status = 'accepted' AND gl.revoked_at IS NULL
   ORDER BY gl.priority
  ON CONFLICT (incident_id, guardian_id, channel, stage) DO NOTHING;
  GET DIAGNOSTICS queued_count = ROW_COUNT;
  RETURN queued_count;
END; $$;
REVOKE ALL ON FUNCTION public.queue_incident_alerts(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.queue_incident_alerts(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_incident_alert_result(
  p_delivery_id UUID, p_owner_id UUID, p_provider_ref TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE public.alert_deliveries d
     SET state = 'provider_accepted', provider_ref = left(p_provider_ref, 200),
         attempt_count = d.attempt_count + 1, next_attempt_at = NULL, updated_at = now()
    FROM public.incidents i
   WHERE d.id = p_delivery_id AND i.id = d.incident_id AND i.owner_id = p_owner_id
     AND d.state IN ('queued', 'provider_failed') AND d.attempt_count < 5
     AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now());
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_NOT_DUE' USING ERRCODE = '02000'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.record_incident_alert_result(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_incident_alert_result(UUID, UUID, TEXT) TO authenticated;

-- In mock mode, due queued/failed jobs are accepted deterministically. Real push needs a separate provider worker.
CREATE OR REPLACE FUNCTION public.process_mock_alert_deliveries(p_limit INTEGER DEFAULT 100)
RETURNS BIGINT LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE processed_count BIGINT; journey_processed_count BIGINT;
BEGIN
  WITH due AS (
    SELECT id FROM public.alert_deliveries
     WHERE state IN ('queued', 'provider_failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       AND attempt_count < 5
     ORDER BY stage, created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 500))
  )
  UPDATE public.alert_deliveries d
     SET state = 'provider_accepted', attempt_count = d.attempt_count + 1,
         next_attempt_at = NULL, provider_ref = 'mock:' || d.id::text, updated_at = now()
    FROM due WHERE d.id = due.id;
  GET DIAGNOSTICS processed_count = ROW_COUNT;
  WITH due AS (
    SELECT id FROM public.journey_alerts
     WHERE state IN ('queued', 'provider_failed')
       AND (next_attempt_at IS NULL OR next_attempt_at <= now())
       AND attempt_count < 5
     ORDER BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT GREATEST(1, LEAST(p_limit, 500))
  )
  UPDATE public.journey_alerts j
     SET state = 'provider_accepted', attempt_count = j.attempt_count + 1,
         next_attempt_at = NULL
    FROM due WHERE j.id = due.id;
  GET DIAGNOSTICS journey_processed_count = ROW_COUNT;
  RETURN processed_count + journey_processed_count;
END; $$;
REVOKE ALL ON FUNCTION public.process_mock_alert_deliveries(INTEGER) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION public.record_incident_alert_failure(p_delivery_id UUID, p_owner_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE public.alert_deliveries d
     SET state = 'provider_failed', attempt_count = d.attempt_count + 1,
         next_attempt_at = CASE WHEN d.attempt_count < 4
           THEN now() + make_interval(secs => LEAST(3600, 15 * (2 ^ d.attempt_count)::INTEGER)) ELSE NULL END,
         updated_at = now()
    FROM public.incidents i
   WHERE d.id = p_delivery_id AND i.id = d.incident_id AND i.owner_id = p_owner_id
     AND d.state IN ('queued', 'provider_failed') AND d.attempt_count < 5;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_TERMINAL' USING ERRCODE = '02000'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.record_incident_alert_failure(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_incident_alert_failure(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_journey_alert_failure(p_alert_id UUID, p_owner_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM p_owner_id THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501'; END IF;
  UPDATE public.journey_alerts a
     SET state = 'provider_failed', attempt_count = a.attempt_count + 1,
         next_attempt_at = CASE WHEN a.attempt_count < 4
           THEN now() + make_interval(secs => LEAST(3600, 15 * (2 ^ a.attempt_count)::INTEGER)) ELSE NULL END
    FROM public.journeys j
   WHERE a.id = p_alert_id AND j.id = a.journey_id AND j.owner_id = p_owner_id
     AND a.state IN ('queued', 'provider_failed') AND a.attempt_count < 5;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_TERMINAL' USING ERRCODE = '02000'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.record_journey_alert_failure(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_journey_alert_failure(UUID, UUID) TO authenticated;

-- Install jobs only when pg_cron has already been enabled on the project.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheild-location-retention') THEN
      PERFORM cron.schedule('sheild-location-retention', '*/15 * * * *',
        'SELECT public.delete_expired_incident_locations()');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheild-missed-journeys') THEN
      PERFORM cron.schedule('sheild-missed-journeys', '* * * * *',
        'SELECT public.process_missed_journeys()');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sheild-mock-alerts') THEN
      PERFORM cron.schedule('sheild-mock-alerts', '* * * * *',
        'SELECT public.process_mock_alert_deliveries(100)');
    END IF;
  END IF;
END $$;
