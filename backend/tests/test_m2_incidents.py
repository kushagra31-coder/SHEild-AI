"""
M2 test suite: incident retrieval, acknowledgement, resolution, location.
All Supabase DB calls are mocked at the call-site.
The get_current_user dependency is overridden for every test.
"""
import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from app.core.security import get_current_user

# ── Helpers ──────────────────────────────────────────────────────────────────
OWNER_ID    = str(uuid4())
GUARDIAN_ID = str(uuid4())
INCIDENT_ID = str(uuid4())
CLIENT_EVT  = str(uuid4())
NOW         = datetime.now(timezone.utc).isoformat()
EXPIRES     = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()

INCIDENT_ROW = {
    "id":              INCIDENT_ID,
    "owner_id":        OWNER_ID,
    "client_event_id": CLIENT_EVT,
    "trigger":         "manual",
    "status":          "active",
    "share_location":  True,
    "started_at":      NOW,
    "expires_at":      EXPIRES,
    "created_at":      NOW,
    "updated_at":      NOW,
    "resolved_at":     None,
}

LOCATION_ROW = {
    "id":          str(uuid4()),
    "incident_id": INCIDENT_ID,
    "latitude":    22.7196,
    "longitude":   75.8577,
    "accuracy_m":  25.0,
    "captured_at": NOW,
    "expires_at":  EXPIRES,
    "created_at":  NOW,
}

ACK_ROW = {
    "id":             str(uuid4()),
    "incident_id":    INCIDENT_ID,
    "guardian_id":    GUARDIAN_ID,
    "acknowledged_at": NOW,
    "note":           "On my way",
}


def _mock_user(user_id: str):
    def _dep():
        return {"sub": user_id, "role": "authenticated", "_token": "tok"}
    return _dep


def _make_db(incident=None, locations=None, acks=None, update_data=None, rpc_data=None, insert_data=None, rpc_error=None):
    """
    Build a MagicMock Supabase client.
    Per-table call counters let select and write (update/insert) return different data
    within the same request handler.
    """
    db = MagicMock()
    _call_counts = {}  # shared across all table() invocations
    db._queries = {}

    def _table(name):
        t = MagicMock()
        q = MagicMock()
        db._queries[name] = q

        for method in ("select", "insert", "update", "eq", "is_", "in_", "order", "limit", "gt"):
            getattr(q, method).return_value = q

        def _execute():
            _call_counts[name] = _call_counts.get(name, 0) + 1
            idx = _call_counts[name] - 1   # 0-indexed call number for this table
            m = MagicMock()

            if name == "incidents":
                if idx == 0:
                    m.data = incident if incident is not None else []
                else:
                    # write result
                    m.data = (update_data if update_data is not None
                              else (insert_data if insert_data is not None else []))
            elif name == "incident_locations":
                if insert_data is not None and update_data is None and idx == 0:
                    # submit_location: insert is the first (and only) call to this table
                    m.data = insert_data
                else:
                    m.data = locations if locations is not None else []
            elif name == "incident_acknowledgements":
                m.data = acks if acks is not None else []
            elif name == "guardian_links":
                m.data = []
            elif name == "alert_deliveries":
                m.data = []
            else:
                m.data = []
            return m

        q.execute.side_effect = _execute
        t.select.return_value  = q
        t.insert.return_value  = q
        t.update.return_value  = q
        t.eq.return_value      = q
        t.order.return_value   = q
        t.limit.return_value   = q
        return t

    db.table.side_effect = _table

    rpc_q = MagicMock()
    rpc_name = None
    def _rpc_execute():
        m = MagicMock()
        if rpc_error:
            raise rpc_error
        if rpc_name == "submit_incident_location" and rpc_data is None:
            m.data = insert_data if insert_data is not None else []
        else:
            m.data = rpc_data if rpc_data is not None else []
        return m
    rpc_q.execute.side_effect = _rpc_execute
    def _rpc(name, *_):
        nonlocal rpc_name
        rpc_name = name
        return rpc_q
    db.rpc.return_value = rpc_q
    db.rpc.side_effect = _rpc

    db.postgrest.auth.return_value = None
    return db


# ── Fixtures ─────────────────────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def reset_overrides():
    """Ensure dependency_overrides are clean before each test."""
    app.dependency_overrides = {}
    yield
    app.dependency_overrides = {}


client = TestClient(app, raise_server_exceptions=False)


class TestListIncidents:
    def _request(self, user_id, rows):
        app.dependency_overrides[get_current_user] = _mock_user(user_id)
        db = _make_db(incident=rows)
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db) as get_db:
            response = client.get("/api/v1/incidents")
        get_db.assert_called_once_with(token="tok")
        query = db._queries["incidents"]
        query.in_.assert_called_once_with("status", ["active", "acknowledged"])
        query.gt.assert_called_once()
        assert query.gt.call_args.args[0] == "expires_at"
        assert datetime.fromisoformat(query.gt.call_args.args[1]).tzinfo is not None
        query.order.assert_called_once_with("created_at", desc=True)
        query.eq.assert_not_called()
        return response, query

    def test_owner_lists_incidents_with_response_shape(self):
        response, _ = self._request(OWNER_ID, [INCIDENT_ROW])
        assert response.status_code == 200
        body = response.json()
        assert list(body) == ["items"]
        item = body["items"][0]
        assert {key: value for key, value in item.items() if key not in {"created_at", "started_at"}} == {
            "id": INCIDENT_ID,
            "owner_id": OWNER_ID,
            "client_event_id": CLIENT_EVT,
            "trigger": "manual",
            "status": "active",
            "share_location": True,
            "alert_status": "queued",
            "resolved_at": None,
        }
        assert datetime.fromisoformat(item["created_at"].replace("Z", "+00:00")) == datetime.fromisoformat(NOW)
        assert datetime.fromisoformat(item["started_at"].replace("Z", "+00:00")) == datetime.fromisoformat(INCIDENT_ROW["started_at"])

    def test_accepted_guardian_lists_rls_visible_incident(self):
        response, _ = self._request(GUARDIAN_ID, [INCIDENT_ROW])
        assert response.status_code == 200
        assert [item["id"] for item in response.json()["items"]] == [INCIDENT_ID]

    def test_unrelated_user_sees_no_incidents(self):
        response, _ = self._request(str(uuid4()), [])
        assert response.status_code == 200
        assert response.json() == {"items": []}

    def test_revoked_guardian_sees_no_incidents(self):
        # Supabase RLS excludes incidents when the accepted link is revoked.
        response, _ = self._request(GUARDIAN_ID, [])
        assert response.status_code == 200
        assert response.json() == {"items": []}

    def test_multiple_incidents_are_returned(self):
        second = {**INCIDENT_ROW, "id": str(uuid4()), "status": "acknowledged"}
        response, _ = self._request(OWNER_ID, [INCIDENT_ROW, second])
        assert response.status_code == 200
        assert [item["id"] for item in response.json()["items"]] == [INCIDENT_ID, second["id"]]

    def test_list_requires_authentication(self):
        response = client.get("/api/v1/incidents")
        assert response.status_code in (401, 403)


# ════════════════════════════════════════════════════════════════════════════
# GET /incidents/{id}
# ════════════════════════════════════════════════════════════════════════════
class TestGetIncident:

    def test_owner_gets_incident(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[INCIDENT_ROW], locations=[LOCATION_ROW], acks=[])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{INCIDENT_ID}")
        assert r.status_code == 200
        body = r.json()
        assert body["id"] == INCIDENT_ID
        assert body["status"] == "active"
        assert body["latest_location"]["latitude"] == 22.7196
        assert body["acknowledgements"] == []

    def test_missing_incident_returns_404(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[], locations=[], acks=[])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{uuid4()}")
        assert r.status_code == 404

    def test_get_incident_no_auth_rejected(self):
        # No override → real security runs → no token → 401/403
        r = client.get(f"/api/v1/incidents/{INCIDENT_ID}")
        assert r.status_code in (401, 403)

    def test_get_incident_with_acks(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[INCIDENT_ROW], locations=[], acks=[ACK_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{INCIDENT_ID}")
        assert r.status_code == 200
        assert len(r.json()["acknowledgements"]) == 1


# ════════════════════════════════════════════════════════════════════════════
# POST /incidents/{id}/acknowledge
# ════════════════════════════════════════════════════════════════════════════
class TestAcknowledgeIncident:

    def test_guardian_acknowledges_successfully(self):
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db(rpc_data=[ACK_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(
                f"/api/v1/incidents/{INCIDENT_ID}/acknowledge",
                json={"note": "On my way"},
            )
        assert r.status_code == 200
        body = r.json()
        assert body["incident_id"] == INCIDENT_ID
        assert body["guardian_id"] == GUARDIAN_ID

    def test_acknowledge_with_no_body_succeeds(self):
        """requestBody is optional (note is nullable)."""
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db(rpc_data=[ACK_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/acknowledge")
        assert r.status_code == 200

    def test_acknowledge_note_too_long_rejected(self):
        """note > 280 chars must be rejected by Pydantic before hitting the DB."""
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db(rpc_data=[ACK_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(
                f"/api/v1/incidents/{INCIDENT_ID}/acknowledge",
                json={"note": "x" * 281},
            )
        assert r.status_code == 422

    def test_rpc_forbidden_returns_403(self):
        """FORBIDDEN error from DB surfaces as 403."""
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db()
        db.rpc.return_value.execute.side_effect = Exception("FORBIDDEN: not an accepted guardian")
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/acknowledge")
        assert r.status_code == 403

    def test_rpc_conflict_returns_409(self):
        """CONFLICT error (wrong status) surfaces as 409."""
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db()
        db.rpc.return_value.execute.side_effect = Exception("CONFLICT: incident status is resolved")
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/acknowledge")
        assert r.status_code == 409

    def test_acknowledge_no_auth_rejected(self):
        r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/acknowledge")
        assert r.status_code in (401, 403)


# ════════════════════════════════════════════════════════════════════════════
# POST /incidents/{id}/resolve
# ════════════════════════════════════════════════════════════════════════════
class TestResolveIncident:

    def test_owner_resolves_active_incident(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        resolved_row = {**INCIDENT_ROW, "status": "resolved", "resolved_at": NOW}
        db = _make_db(incident=[INCIDENT_ROW], rpc_data=[resolved_row])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"

    def test_owner_resolves_acknowledged_incident(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        acked_row   = {**INCIDENT_ROW, "status": "acknowledged"}
        resolved_row = {**acked_row, "status": "resolved", "resolved_at": NOW}
        db = _make_db(incident=[acked_row], rpc_data=[resolved_row])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"

    def test_resolve_already_resolved_is_idempotent(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        resolved_row = {**INCIDENT_ROW, "status": "resolved", "resolved_at": NOW}
        db = _make_db(incident=[resolved_row])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code == 200
        assert r.json()["status"] == "resolved"

    def test_resolve_expired_returns_400(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        expired_row = {**INCIDENT_ROW, "status": "expired"}
        db = _make_db(incident=[expired_row])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code == 400

    def test_resolve_nonexistent_returns_404(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{uuid4()}/resolve")
        assert r.status_code == 404

    def test_resolve_wrong_owner_returns_403(self):
        """Incident is owned by OWNER_ID but caller is GUARDIAN_ID."""
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        # RLS in production would return empty; in mock we can check our belt-and-suspenders
        db = _make_db(incident=[INCIDENT_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code == 403

    def test_resolve_no_auth_rejected(self):
        r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/resolve")
        assert r.status_code in (401, 403)


# ════════════════════════════════════════════════════════════════════════════
# POST /incidents/{id}/location
# ════════════════════════════════════════════════════════════════════════════
class TestSubmitLocation:

    _payload = {
        "latitude":    22.7196,
        "longitude":   75.8577,
        "accuracy_m":  25.0,
        "captured_at": NOW,
    }

    def test_owner_submits_location(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        inc = [{**INCIDENT_ROW, "id": INCIDENT_ID, "owner_id": OWNER_ID}]
        db = _make_db(incident=inc, insert_data=[LOCATION_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=self._payload)
        assert r.status_code == 200
        body = r.json()
        assert body["incident_id"] == INCIDENT_ID

    def test_location_rejected_for_terminal_incident(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        resolved = [{**INCIDENT_ROW, "status": "resolved", "owner_id": OWNER_ID}]
        db = _make_db(incident=resolved)
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=self._payload)
        assert r.status_code == 400

    def test_location_rejected_when_sharing_disabled(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        no_share = [{**INCIDENT_ROW, "share_location": False, "owner_id": OWNER_ID}]
        db = _make_db(incident=no_share)
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=self._payload)
        assert r.status_code == 403

    def test_location_wrong_owner_returns_403(self):
        app.dependency_overrides[get_current_user] = _mock_user(GUARDIAN_ID)
        db = _make_db(incident=[INCIDENT_ROW])  # OWNER_ID != GUARDIAN_ID
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=self._payload)
        assert r.status_code == 403

    def test_location_missing_required_field_422(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        bad = {k: v for k, v in self._payload.items() if k != "latitude"}
        db = _make_db(incident=[INCIDENT_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=bad)
        assert r.status_code == 422

    def test_location_out_of_range_rejected(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        bad = {**self._payload, "latitude": 999.0}
        db = _make_db(incident=[INCIDENT_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=bad)
        assert r.status_code == 422

    def test_location_no_auth_rejected(self):
        r = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=self._payload)
        assert r.status_code in (401, 403)


# ════════════════════════════════════════════════════════════════════════════
# GET /incidents/{id}/location
# ════════════════════════════════════════════════════════════════════════════
class TestGetLatestLocation:

    def test_owner_gets_latest_location(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[INCIDENT_ROW], locations=[LOCATION_ROW])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{INCIDENT_ID}/location")
        assert r.status_code == 200
        assert r.json()["latitude"] == 22.7196

    @pytest.mark.parametrize("longitude,expected", [(75.8577, 200), (76.0, 409)])
    def test_location_retry_returns_same_sample_or_conflict(self, longitude, expected):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        payload = {"latitude": 22.7196, "longitude": longitude, "accuracy_m": 25.0, "captured_at": NOW}
        rpc_data = [LOCATION_ROW] if expected == 200 else None
        db = _make_db(incident=[INCIDENT_ROW], rpc_data=rpc_data,
                      rpc_error=Exception("LOCATION_CONFLICT") if expected == 409 else None)
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            response = client.post(f"/api/v1/incidents/{INCIDENT_ID}/location", json=payload)
        assert response.status_code == expected

    def test_no_location_returns_404(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[INCIDENT_ROW], locations=[])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{INCIDENT_ID}/location")
        assert r.status_code == 404

    def test_incident_not_found_returns_404(self):
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        db = _make_db(incident=[])
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{uuid4()}/location")
        assert r.status_code == 404

    def test_no_auth_rejected(self):
        r = client.get(f"/api/v1/incidents/{INCIDENT_ID}/location")
        assert r.status_code in (401, 403)

    def test_expired_location_excluded_returns_404(self):
        """
        The mock simulates what happens after the .gt('expires_at', now) filter is applied:
        Supabase returns no rows (all records are expired).
        The endpoint must return 404, not an expired coordinate.
        """
        app.dependency_overrides[get_current_user] = _mock_user(OWNER_ID)
        # Simulate DB returning empty after the expires_at > now() filter is applied
        db = _make_db(incident=[INCIDENT_ROW], locations=[])  # empty = all expired after filter
        with patch("app.api.v1.incidents.get_supabase_client", return_value=db):
            r = client.get(f"/api/v1/incidents/{INCIDENT_ID}/location")
        assert r.status_code == 404
