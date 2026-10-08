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
  UPDATE public.guardian_invites gi SET used_at = v_now, accepted_by = p_guardian_id WHERE gi.id = v_invite.id;
  RETURN QUERY SELECT gl.id, gl.owner_id, gl.guardian_id, gl.priority, gl.status, gl.consented_at
    FROM public.guardian_links gl WHERE gl.owner_id = v_invite.owner_id AND gl.guardian_id = p_guardian_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'PRIORITY_CONFLICT' USING ERRCODE = '23505';
END; $$;
