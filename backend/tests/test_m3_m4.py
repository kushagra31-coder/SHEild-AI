import hashlib
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.responses import Response

from app.api.v1.guardians import (
    AcceptRequest,
    InviteRequest,
    PriorityRequest,
    accept_invite,
    create_invite,
    revoke_guardian,
    update_priority,
)
from app.api.v1.journeys import (
    JourneyCreate,
    cancel_journey,
    complete_journey,
    create_journey,
)
from app.core.security import get_current_user
from app.main import app

OWNER = str(uuid4())
GUARDIAN = str(uuid4())
OTHER = str(uuid4())


class Result:
    def __init__(self, data):
        self.data = data


class StubDatabaseError(Exception):
    pass


class Query:
    def __init__(self, db, table):
        self.db, self.table, self.op, self.payload = db, table, "select", None
        self.filters = {}

    def select(self, *_): self.op = "select"; return self
    def insert(self, payload): self.op, self.payload = "insert", payload; return self
    def update(self, payload): self.op, self.payload = "update", payload; return self
    def rpc(self, *_): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def is_(self, *_): return self
    def order(self, *_ , **__): return self
    def execute(self):
        self.db.calls.append((self.table, self.op, self.payload))
        if self.table == "profiles": return Result(self.db.profiles)
        if self.table == "guardian_links":
            if self.op == "insert": return Result([self.payload])
            if self.op == "update":
                if self.db.fail_update:
                    raise StubDatabaseError(self.db.fail_update)
                return Result(self.db.update_rows)
            return Result(self.db.links)
        if self.table == "guardian_invites":
            if self.op == "insert":
                return Result([{**self.payload, "id": str(uuid4())}])
            return Result(self.db.invites)
        if self.table == "journeys":
            if self.op == "insert":
                self.db.journey.update(self.payload)
                return Result([{**self.payload, "id": self.db.journey["id"], "status": "in_progress", "created_at": datetime.now(UTC).isoformat()}])
            if self.op == "update":
                if self.db.journey["status"] != "in_progress": return Result([])
                self.db.journey.update(self.payload)
                return Result([self.db.journey.copy()])
            if any(self.db.journey.get(key) != value for key, value in self.filters.items()):
                return Result([])
            return Result([self.db.journey.copy()] if self.db.journey else [])
        raise AssertionError(self.table)


class DB:
    def __init__(self):
        self.calls, self.profiles, self.links, self.invites = [], [], [], []
        self.update_rows, self.fail_update = [], None
        self.rpc_error = None
        self.journey = {"id": str(uuid4()), "owner_id": OWNER, "status": "in_progress", "guardian_ids": [GUARDIAN]}
        self.rpc_result = [{"id": str(uuid4()), "owner_id": OWNER, "guardian_id": GUARDIAN, "status": "accepted"}]
        self.rpc_error = None

    def table(self, name): return Query(self, name)
    def rpc(self, name, args):
        self.rpc_args = (name, args)
        q = MagicMock()
        if self.rpc_error:
            q.execute.side_effect = StubDatabaseError(self.rpc_error)
        elif name == "create_guardian_invite":
            self.invite_rpc_payload = args
            q.execute.return_value = Result([{"id": str(uuid4()), "display_name": args["p_display_name"], "priority": args["p_priority"], "expires_at": (datetime.now(UTC) + timedelta(days=7)).isoformat()}])
        elif name == "transition_journey":
            target = args["p_target"]
            if self.journey["status"] not in ("in_progress", target):
                q.execute.side_effect = StubDatabaseError("CONFLICT")
            else:
                self.journey["status"] = target
                q.execute.return_value = Result([self.journey.copy()])
        elif name == "revoke_guardian_link":
            q.execute.return_value = Result([{"id": args["p_link_id"], "status": "revoked", "revoked_at": datetime.now(UTC).isoformat()}])
        else:
            q.execute.return_value = Result(self.rpc_result)
        return q


def test_invitation_returns_random_plaintext_but_persists_only_hash():
    db = DB()
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db):
        result = create_invite(InviteRequest(display_name="Guardian", phone_number="+1 555 0100", priority=1), {"sub": OWNER})
    assert len(result["token"]) >= 40
    assert db.invite_rpc_payload["p_token_hash"] == hashlib.sha256(result["token"].encode()).hexdigest()
    assert "token" not in db.invite_rpc_payload


def test_owner_cannot_invite_self_by_profile_phone():
    db = DB()
    db.rpc_error = "SELF_INVITE"
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db), pytest.raises(HTTPException) as error:
        create_invite(InviteRequest(display_name="Me", phone_number="+1 555 0100", priority=1), {"sub": OWNER})
    assert error.value.status_code == 422
    assert db.rpc_args[0] == "create_guardian_invite"


def test_acceptance_sends_only_hash_to_atomic_rpc():
    db = DB()
    token = "a" * 43
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db):
        result = accept_invite(AcceptRequest(token=token), {"sub": GUARDIAN})
    assert result["status"] == "accepted"
    assert db.rpc_args == ("accept_guardian_invite", {
        "p_token_hash": hashlib.sha256(token.encode()).hexdigest(), "p_guardian_id": GUARDIAN,
    })
    assert token not in repr(db.rpc_args)


@pytest.mark.parametrize("reason", ["INVALID", "EXPIRED", "USED", "FORBIDDEN"])
def test_invite_acceptance_failures_are_conflicts_or_forbidden(reason):
    db = DB()
    db.rpc_error = StubDatabaseError(reason)
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db), pytest.raises(HTTPException) as error:
        accept_invite(AcceptRequest(token="a" * 43), {"sub": GUARDIAN})
    assert error.value.status_code == (403 if reason == "FORBIDDEN" else 409)
    assert "token" not in error.value.detail


def test_priority_collision_is_conflict():
    db = DB()
    db.rpc_error = "23505 uq_active_guardian_priority"
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db), pytest.raises(HTTPException) as error:
        update_priority(str(uuid4()), PriorityRequest(priority=2), {"sub": OWNER})
    assert error.value.status_code == 409


def test_revocation_is_soft_and_owner_scoped():
    db = DB()
    db.update_rows = [{"id": str(uuid4()), "status": "revoked", "revoked_at": datetime.now(UTC).isoformat()}]
    with patch("app.api.v1.guardians.get_supabase_client", return_value=db):
        result = revoke_guardian(db.update_rows[0]["id"], {"sub": OWNER})
    assert result["status"] == "revoked"
    assert db.rpc_args[0] == "revoke_guardian_link"
    assert db.rpc_args[1]["p_owner_id"] == OWNER


def test_journey_creation_requires_future_eta_and_authorized_guardians():
    db = DB()
    with patch("app.api.v1.journeys.get_supabase_client", return_value=db):
        with pytest.raises(HTTPException) as past:
            create_journey(JourneyCreate(destination_label="Home", eta_at=datetime.now(UTC) - timedelta(seconds=1)), Response(), {"sub": OWNER}, idempotency_key=None)
        assert past.value.status_code == 422
        db.links = [{"guardian_id": GUARDIAN}]
        with pytest.raises(HTTPException) as unrelated:
            create_journey(JourneyCreate(destination_label="Home", eta_at=datetime.now(UTC) + timedelta(hours=1), guardian_ids=[OTHER]), Response(), {"sub": OWNER}, idempotency_key=None)
        assert unrelated.value.status_code == 422


def test_journey_create_and_create_retry_return_one_row():
    db = DB()
    db.links = [{"guardian_id": GUARDIAN}]
    event_id = uuid4()
    body = JourneyCreate(
        destination_label="Home", eta_at=datetime.now(UTC) + timedelta(hours=1),
        guardian_ids=[UUID(GUARDIAN)], client_event_id=event_id,
    )
    with patch("app.api.v1.journeys.get_supabase_client", return_value=db):
        first = create_journey(body, Response(), {"sub": OWNER}, idempotency_key=None)
        second_response = Response()
        second = create_journey(body, second_response, {"sub": OWNER}, idempotency_key=None)
    assert first["status"] == "in_progress"
    assert second["id"] == first["id"]
    assert second_response.status_code == 200
    assert sum(op == "insert" for table, op, _ in db.calls if table == "journeys") == 1


def test_guardian_cannot_change_owner_journey():
    db = DB()
    with patch("app.api.v1.journeys.get_supabase_client", return_value=db), pytest.raises(HTTPException) as error:
        complete_journey(db.journey["id"], {"sub": GUARDIAN})
    assert error.value.status_code == 403


def test_new_guardian_and_journey_routes_reject_anonymous_requests():
    original = app.dependency_overrides.copy()
    app.dependency_overrides.pop(get_current_user, None)
    client = TestClient(app)
    try:
        invite = client.post("/api/v1/guardians/invites", json={"display_name": "A", "phone_number": "+1 555 0100", "priority": 1})
        journeys = client.get("/api/v1/journeys")
        acceptance = client.post("/api/v1/guardians/accept", json={"token": "a" * 43})
    finally:
        app.dependency_overrides = original
    assert invite.status_code in (401, 403)
    assert journeys.status_code in (401, 403)
    assert acceptance.status_code in (401, 403)


def test_journey_completion_is_idempotent_but_other_terminal_transition_conflicts():
    db = DB()
    with patch("app.api.v1.journeys.get_supabase_client", return_value=db):
        assert complete_journey(db.journey["id"], {"sub": OWNER})["status"] == "completed"
        assert complete_journey(db.journey["id"], {"sub": OWNER})["status"] == "completed"
        with pytest.raises(HTTPException) as error:
            cancel_journey(db.journey["id"], {"sub": OWNER})
    assert error.value.status_code == 409


def test_unrelated_cannot_change_journey():
    db = DB()
    with patch("app.api.v1.journeys.get_supabase_client", return_value=db), pytest.raises(HTTPException) as error:
        complete_journey(db.journey["id"], {"sub": OTHER})
    assert error.value.status_code == 403
