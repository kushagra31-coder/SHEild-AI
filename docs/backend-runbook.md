# SHEild AI backend runbook

## Prerequisites and local start

- Python 3.11 or newer.
- A Supabase project, or the Supabase CLI local stack.
- Node is only needed for the existing Guardian Web/mobile clients.

From PowerShell at the repository root:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

Fill in `.env` from your Supabase project settings. Required values are `SUPABASE_URL`, the anon/publishable `SUPABASE_KEY`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_AUDIENCE`, `SUPABASE_JWKS_URL`, and `DATABASE_URL` for database administration. The API forwards each request's verified user JWT to PostgREST; no service-role key is needed or accepted for normal requests.

For hosted Supabase use the project's Auth JWKS URL (`https://<project-ref>.supabase.co/auth/v1/keys`), issuer (`https://<project-ref>.supabase.co/auth/v1`), and audience (`authenticated`). This verifies the project's ES256 signing keys. Keep the optional local HS256 secret unset for hosted use.

Start from `backend/` with:

```powershell
uvicorn app.main:app --reload
```

Liveness: `GET http://localhost:8000/api/v1/health/live` checks only the process. Readiness: `GET http://localhost:8000/api/v1/health/ready` checks that Supabase/PostgREST responds.

## Migrations and scheduled jobs

Review `supabase/migrations/` before applying. For a linked project, apply with `supabase db push`; for the local stack, start Supabase and use `supabase migration up`. Do not reset a database with existing data. The migrations add the atomic guardian/journey functions and RLS rules; the backend requires them before those endpoints are usable.

Migration `20261006000003_harden_rpc_grants_and_enable_jobs.sql` enables the available `pg_cron` extension and installs three database jobs:

- `sheild-missed-journeys` runs every minute and marks ETA+grace expirations missed while queuing one job per currently accepted, selected guardian.
- `sheild-mock-alerts` runs every minute and accepts due mock incident/journey deliveries.
- `sheild-location-retention` runs every 15 minutes and deletes coordinates whose 48-hour retention has elapsed.

If the project does not permit enabling `pg_cron` from migrations, enable it in Supabase Dashboard under Database > Extensions and schedule these idempotent functions once in the SQL editor:

```sql
select cron.schedule('sheild-missed-journeys', '* * * * *', 'select public.process_missed_journeys()');
select cron.schedule('sheild-mock-alerts', '* * * * *', 'select public.process_mock_alert_deliveries(100)');
select cron.schedule('sheild-location-retention', '*/15 * * * *', 'select public.delete_expired_incident_locations()');
```

Check `cron.job` and `cron.job_run_details` to confirm the jobs and inspect failures. Journey status transitions and alert-job inserts occur in one database transaction. Unique `(journey_id, guardian_id)` jobs and conditional state transitions make polling safe after restarts. Incident alert jobs likewise use the existing unique incident/guardian/channel/stage key. Expired coordinates are filtered from every API read even before cleanup runs.

## API and client configuration

All protected API requests require `Authorization: Bearer <Supabase access token>`. Identity comes from the verified token, and RLS scopes database operations.

Guardian Web reads `VITE_API_BASE_URL`, normally `http://localhost:8000/api/v1`. The mobile app reads `EXPO_PUBLIC_API_BASE_URL`; use `http://10.0.2.2:8000/api/v1` on the Android emulator, `http://localhost:8000/api/v1` for iOS simulator/local web, or the development computer's LAN IP on a physical device.

Implemented routes:

- Health: `GET /health/live`, `GET /health/ready`.
- Incidents: `POST /incidents`, `GET /incidents`, `GET /incidents/history`, `GET /incidents/{id}`, `POST /incidents/{id}/acknowledge`, `POST /incidents/{id}/resolve`.
- Incident locations/deliveries: `POST /incidents/{id}/location`, `GET /incidents/{id}/location`, `GET /incidents/{id}/deliveries`.
- Guardians: `POST /guardians/invites`, `GET /guardians/invites`, `POST /guardians/accept`, `GET /guardians`, `GET /guardians/relationships`, `POST /guardians/{link_id}/revoke`, `PATCH /guardians/{link_id}/priority`.
- Journeys: `POST /journeys`, `GET /journeys`, `GET /journeys/{id}`, `POST /journeys/{id}/complete`, `POST /journeys/{id}/cancel`, `GET /journeys/{id}/alerts`.

Incident creation uses `client_event_id` and optional matching `Idempotency-Key`; replay returns the original incident and re-ensures its alert jobs. Location replay is keyed by incident and `captured_at`; identical samples return the existing record. Journey creation accepts an optional `client_event_id` or matching `Idempotency-Key`; journey completion, cancellation, resolution and acknowledgement are retry-safe for their same target/actor.

Guardian invitation tokens are generated with a cryptographic random source, hashed with SHA-256, persisted only as hashes and shown once to the owner. Acceptance is one-use and transactional. Guardian priority collision is returned as HTTP 409. Revocation is soft and immediately affects relationship-based RLS.

Journeys start in the existing `in_progress` state. ETA is paired with `grace_seconds`; the worker marks a journey `missed_check_in` at ETA plus grace. Only accepted guardians selected when the journey was created receive a queued job, and a revoked guardian is excluded at processing time.

## Alerts, security, and operations

`MockAlertProvider` simulates provider acceptance; it makes no network delivery. Provider acceptance is not proof of human receipt. The database queue is ordered by guardian priority and uses retry counts/timestamps, with a maximum of five attempts for retryable failed rows. No FCM, SMS, WhatsApp, or emergency service is configured. `AlertProvider` is the small seam for a future push adapter. Emergency dispatch remains a separate future concept and has no implementation.

`APP_ENV=development` allows the local Guardian Web/mobile development origins. For other environments, set `APP_ENV=production` and configure `CORS_ORIGINS` as a JSON list of exact origins; no production hostname is assumed. No API rate limiter is installed; put one at the public gateway before exposing sensitive endpoints broadly.

Logs include request IDs, route, response status, elapsed time, and relevant incident/journey IDs or error classes. They exclude access tokens, invite tokens and precise coordinates. The `/live` endpoint does not depend on Supabase; `/ready` does.

## Tests and known limits

Run `python -m pytest` from `backend/`. Ruff is installed in the backend dev extra; `ruff check app tests` may also report existing issues in untouched baseline scripts, so check those separately from changed modules.

The API and SQL queue are ready for a teammate to connect clients. Actual push delivery is still mocked. The background schedule requires `pg_cron` enabled as described above. The backend cannot guarantee mobile offline capture/permissions or Guardian Web presentation; clients should retain their existing Supabase sessions and retry IDs. There is no police/112 or other emergency-service connection.
