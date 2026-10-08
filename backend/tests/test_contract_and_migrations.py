from pathlib import Path

import yaml

from app.main import app

ROOT = Path(__file__).resolve().parents[2]


def test_openapi_documents_every_registered_backend_route():
    contract = yaml.safe_load((ROOT / "packages/contracts/openapi.yaml").read_text(encoding="utf-8"))
    actual = app.openapi()["paths"]
    for path, operations in actual.items():
        contract_path = path.removeprefix("/api/v1")
        assert contract_path in contract["paths"], f"Undocumented route: {path}"
        for method in operations:
            assert method in contract["paths"][contract_path], f"Undocumented operation: {method.upper()} {path}"


def test_security_migration_keeps_new_relations_rls_protected():
    sql = (ROOT / "supabase/migrations/20261005000001_m3_guardian_journey_security.sql").read_text(encoding="utf-8")
    assert "ALTER TABLE public.journey_alerts ENABLE ROW LEVEL SECURITY" in sql
    assert 'DROP POLICY IF EXISTS "Guardians can update their link status"' in sql
    assert 'DROP POLICY IF EXISTS "Owners can manage links"' in sql
    assert "SECURITY DEFINER SET search_path = public, pg_temp" in sql
    assert "auth.uid() IS DISTINCT FROM p_guardian_id" in sql
    assert "IF v_status = 'acknowledged' THEN" in sql
    assert "ON CONFLICT (journey_id, guardian_id) DO NOTHING" in sql
    assert "FOR UPDATE SKIP LOCKED" in sql
    assert 'DROP POLICY IF EXISTS "Users can manage their own incidents"' in sql
    assert 'DROP POLICY IF EXISTS "Users can manage their own journeys"' in sql
    assert "public.submit_incident_location" in sql
    assert "public.process_missed_journeys" in sql
    assert "public.submit_incident_location" in sql
    assert "public.process_missed_journeys" in sql


def test_rpc_ambiguity_fix_uses_explicit_constraint_and_aliases():
    sql = (ROOT / "supabase/migrations/20261006000001_fix_backend_rpc_ambiguities.sql").read_text(encoding="utf-8")
    invite_sql = (ROOT / "supabase/migrations/20261006000002_qualify_invite_update.sql").read_text(encoding="utf-8")
    assert "ON CONFLICT ON CONSTRAINT uq_guardian_links_owner_guardian" in sql
    assert "WHERE i.id = p_incident_id AND i.owner_id = p_owner_id FOR UPDATE" in sql
    assert "WHERE d.incident_id = p_incident_id AND d.guardian_id = p_guardian_id" in sql
    assert "WHERE gi.id = v_invite.id" in invite_sql


def test_rpc_grants_exclude_anonymous_and_install_database_jobs():
    sql = (ROOT / "supabase/migrations/20261006000003_harden_rpc_grants_and_enable_jobs.sql").read_text(encoding="utf-8")
    assert "FROM PUBLIC, anon" in sql
    assert "CREATE EXTENSION IF NOT EXISTS pg_cron" in sql
    assert "sheild-missed-journeys" in sql
