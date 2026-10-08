-- Supabase's default function privileges include explicit grants to anon.
-- Remove them from every application SECURITY DEFINER routine, then restore
-- only the authenticated RPCs. Polling/cleanup functions stay owner-only.
REVOKE EXECUTE ON FUNCTION public.accept_guardian_invite(TEXT, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.create_guardian_invite(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.delete_expired_incident_locations() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.process_missed_journeys() FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.process_mock_alert_deliveries(INTEGER) FROM PUBLIC, anon, authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.queue_incident_alerts(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.record_incident_alert_failure(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.record_incident_alert_result(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.record_journey_alert_failure(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.resolve_incident(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.revoke_guardian_link(UUID, UUID) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.submit_incident_location(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, REAL, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.transition_journey(UUID, UUID, TEXT) FROM PUBLIC, anon, service_role;
REVOKE EXECUTE ON FUNCTION public.update_guardian_priority(UUID, UUID, INTEGER) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.accept_guardian_invite(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.acknowledge_incident(UUID, UUID, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_guardian_invite(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.queue_incident_alerts(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_incident_alert_failure(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_incident_alert_result(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_journey_alert_failure(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_incident(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_guardian_link(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_incident_location(UUID, UUID, DOUBLE PRECISION, DOUBLE PRECISION, REAL, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_journey(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_guardian_priority(UUID, UUID, INTEGER) TO authenticated;

-- Supabase ships pg_cron as an available extension; enable it and install
-- idempotent polling/retention jobs so the backend needs no separate worker.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
DO $$
BEGIN
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
END $$;
