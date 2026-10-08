"""
Backend API tests – Phase 1 / M1 vertical slice.

Design notes
------------
* We override `get_current_user` so the JWT path never runs.
* We override `get_supabase_client` via monkeypatching the module because
  it is called as a plain function inside the route (not via Depends).
* The mock Supabase client returns minimal plausible data so we can assert
  on HTTP status codes and response shape without a real DB.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_current_user

# ── Shared test state ──────────────────────────────────────────────────────────
FAKE_USER_ID = str(uuid4())
FAKE_TOKEN = "fake.jwt.token"


# ── Dependency overrides ───────────────────────────────────────────────────────
def _mock_current_user() -> dict:
    """Simulate a validated JWT payload (what security.py normally returns)."""
    return {
        "sub": FAKE_USER_ID,
        "role": "authenticated",
        "aud": "authenticated",
        "_token": FAKE_TOKEN,
    }


app.dependency_overrides[get_current_user] = _mock_current_user

# Test client – created AFTER overrides are applied
client = TestClient(app, raise_server_exceptions=False)


# ── Supabase mock factory ─────────────────────────────────────────────────────
def _build_supabase_mock(
    *,
    insert_data: list[dict] | None = None,
    select_data: list[dict] | None = None,
    raise_on_insert: Exception | None = None,
):
    """
    Returns a mock Supabase client whose table().insert/select chains
    return the supplied data.
    """
    incident_id = str(uuid4())
    client_event_id = None  # filled in per-call

    default_incident = {
        "id": incident_id,
        "owner_id": FAKE_USER_ID,
        "client_event_id": "PLACEHOLDER",
        "trigger": "manual",
        "status": "active",
        "share_location": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
    }

    if insert_data is None:
        insert_data = [default_incident]
    if select_data is None:
        select_data = [default_incident]

    mock_sb = MagicMock()

    # Build chain: .table().insert().execute() / .table().select().eq().eq().execute()
    insert_execute = MagicMock()
    if raise_on_insert:
        insert_execute.side_effect = raise_on_insert
    else:
        insert_result = MagicMock()
        insert_result.data = insert_data
        insert_execute.return_value = insert_result

    select_result = MagicMock()
    select_result.data = select_data

    # The select chain can have arbitrary .eq() / .is_() calls
    select_chain = MagicMock()
    select_chain.eq.return_value = select_chain
    select_chain.is_.return_value = select_chain
    select_chain.execute.return_value = select_result

    insert_chain = MagicMock()
    insert_chain.execute = insert_execute

    table_mock = MagicMock()
    table_mock.insert.return_value = insert_chain
    table_mock.select.return_value = select_chain
    table_mock.update.return_value = select_chain   # alert_deliveries update

    mock_sb.table.return_value = table_mock
    mock_sb.postgrest.auth.return_value = None

    return mock_sb


# ── Helper ────────────────────────────────────────────────────────────────────
def _incident_payload(ceid: str | None = None) -> dict:
    ceid = ceid or str(uuid4())
    return {
        "client_event_id": ceid,
        "trigger": "manual",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "share_location": True,
    }


# ══════════════════════════════════════════════════════════════════════════════
# Health
# ══════════════════════════════════════════════════════════════════════════════
def test_health_live():
    resp = client.get("/api/v1/health/live")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "alive" in body["message"].lower()


# ══════════════════════════════════════════════════════════════════════════════
# Authentication
# ══════════════════════════════════════════════════════════════════════════════
def test_missing_auth_token():
    """No Authorization header → 401/403 depending on Starlette version (no credentials provided)."""
    # Remove the override so real security runs
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.post("/api/v1/incidents", json=_incident_payload())
        # FastAPI HTTPBearer returns 401 or 403 depending on version; both mean "no auth"
        assert resp.status_code in (401, 403)
    finally:
        app.dependency_overrides[get_current_user] = _mock_current_user


def test_invalid_jwt():
    """Malformed Bearer token → 401."""
    app.dependency_overrides.pop(get_current_user, None)
    try:
        resp = client.post(
            "/api/v1/incidents",
            json=_incident_payload(),
            headers={"Authorization": "Bearer this.is.garbage"},
        )
        assert resp.status_code == 401
    finally:
        app.dependency_overrides[get_current_user] = _mock_current_user


# ══════════════════════════════════════════════════════════════════════════════
# Incident creation
# ══════════════════════════════════════════════════════════════════════════════
def test_create_incident_success():
    ceid = str(uuid4())
    payload = _incident_payload(ceid)
    payload["client_event_id"] = ceid

    mock_sb = _build_supabase_mock(
        insert_data=[{
            "id": str(uuid4()),
            "owner_id": FAKE_USER_ID,
            "client_event_id": ceid,
            "trigger": "manual",
            "status": "active",
            "share_location": True,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": datetime.now(timezone.utc).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "resolved_at": None,
        }]
    )

    with patch("app.api.v1.incidents.get_supabase_client", return_value=mock_sb):
        resp = client.post(
            "/api/v1/incidents",
            json=payload,
            headers={"Authorization": f"Bearer {FAKE_TOKEN}"},
        )

    assert resp.status_code == 201, resp.json()
    body = resp.json()
    assert body["client_event_id"] == ceid
    assert body["status"] == "active"
    assert body["alert_status"] == "queued"


def test_idempotency_key_mismatch():
    """Idempotency-Key != client_event_id → 400."""
    ceid = str(uuid4())
    mismatch = str(uuid4())

    with patch("app.api.v1.incidents.get_supabase_client", return_value=MagicMock()):
        resp = client.post(
            "/api/v1/incidents",
            json=_incident_payload(ceid),
            headers={
                "Authorization": f"Bearer {FAKE_TOKEN}",
                "Idempotency-Key": mismatch,
            },
        )

    assert resp.status_code == 400
    assert "Idempotency-Key" in resp.json()["detail"]


def test_duplicate_client_event_id_returns_existing():
    """Duplicate (owner_id, client_event_id) → 200 with existing incident (not 500)."""
    ceid = str(uuid4())
    existing_id = str(uuid4())
    existing_row = {
        "id": existing_id,
        "owner_id": FAKE_USER_ID,
        "client_event_id": ceid,
        "trigger": "manual",
        "status": "active",
        "share_location": True,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
    }

    # Insert raises a duplicate-key error; select returns the existing row
    mock_sb = _build_supabase_mock(
        raise_on_insert=Exception("duplicate key value violates unique constraint uq_incidents_owner_client_event"),
        select_data=[existing_row],
    )

    with patch("app.api.v1.incidents.get_supabase_client", return_value=mock_sb):
        resp = client.post(
            "/api/v1/incidents",
            json=_incident_payload(ceid),
            headers={
                "Authorization": f"Bearer {FAKE_TOKEN}",
                "Idempotency-Key": ceid,
            },
        )

    # Should NOT be 500 — idempotent return of existing record
    assert resp.status_code in (200, 201), resp.json()
    body = resp.json()
    assert body["id"] == existing_id


def test_invalid_trigger_value():
    """Unknown trigger string → 422 Unprocessable Entity."""
    payload = _incident_payload()
    payload["trigger"] = "scream"

    with patch("app.api.v1.incidents.get_supabase_client", return_value=MagicMock()):
        resp = client.post(
            "/api/v1/incidents",
            json=payload,
            headers={"Authorization": f"Bearer {FAKE_TOKEN}"},
        )

    assert resp.status_code == 422


def test_missing_required_field():
    """Missing client_event_id → 422."""
    payload = {
        "trigger": "manual",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "share_location": True,
    }

    with patch("app.api.v1.incidents.get_supabase_client", return_value=MagicMock()):
        resp = client.post(
            "/api/v1/incidents",
            json=payload,
            headers={"Authorization": f"Bearer {FAKE_TOKEN}"},
        )

    assert resp.status_code == 422
