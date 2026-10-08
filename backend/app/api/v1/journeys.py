# ruff: noqa: B008
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Response
from pydantic import AwareDatetime, BaseModel, Field

from app.core.security import get_current_user
from app.db.supabase import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)


class JourneyCreate(BaseModel):
    client_event_id: UUID | None = None
    destination_label: str = Field(min_length=1, max_length=160)
    eta_at: AwareDatetime
    grace_seconds: int = Field(default=900, ge=0, le=86400)
    destination_lat: float | None = Field(default=None, ge=-90, le=90)
    destination_lon: float | None = Field(default=None, ge=-180, le=180)
    guardian_ids: list[UUID] | None = None


def _db(user):
    return get_supabase_client(user.get("_token", ""))


@router.post("", status_code=201)
def create_journey(body: JourneyCreate, response: Response, user=Depends(get_current_user), idempotency_key: UUID | None = Header(default=None, alias="Idempotency-Key")):
    if idempotency_key and body.client_event_id and idempotency_key != body.client_event_id:
        raise HTTPException(400, "Idempotency-Key must match client_event_id.")
    client_event_id = body.client_event_id or idempotency_key
    db = _db(user)
    if client_event_id:
        existing = db.table("journeys").select("*").eq("owner_id", user["sub"]).eq("client_event_id", str(client_event_id)).execute().data
        if existing:
            response.status_code = 200
            return existing[0]
    now = datetime.now(UTC)
    if body.eta_at <= now:
        raise HTTPException(422, "ETA must be in the future.")
    if not body.destination_label.strip():
        raise HTTPException(422, "Destination label is required.")
    if (body.destination_lat is None) != (body.destination_lon is None):
        raise HTTPException(422, "Destination latitude and longitude must be supplied together.")
    guardian_ids = db.table("guardian_links").select("guardian_id").eq("owner_id", user["sub"]).eq("status", "accepted").is_("revoked_at", "null").execute().data
    allowed = {row["guardian_id"] for row in guardian_ids}
    selected = [str(item) for item in body.guardian_ids] if body.guardian_ids is not None else list(allowed)
    if len(selected) != len(set(selected)):
        raise HTTPException(422, "A guardian can only be selected once.")
    if not set(selected) <= allowed:
        raise HTTPException(422, "Every journey guardian must be an accepted guardian.")
    payload = {
        "owner_id": user["sub"], "destination_label": body.destination_label.strip(),
        "client_event_id": str(client_event_id) if client_event_id else None,
        "eta_at": body.eta_at.isoformat(), "grace_seconds": body.grace_seconds,
        "destination_lat": body.destination_lat, "destination_lon": body.destination_lon,
        "guardian_ids": selected, "expires_at": (body.eta_at + timedelta(seconds=body.grace_seconds)).isoformat(),
    }
    try:
        rows = db.table("journeys").insert(payload).execute().data
    except Exception as exc:  # noqa: BLE001 - insertion can fail due to DB conflict or transport error.
        if client_event_id and ("23505" in str(exc) or "uq_journeys_owner_client_event" in str(exc)):
            existing = db.table("journeys").select("*").eq("owner_id", user["sub"]).eq("client_event_id", str(client_event_id)).execute().data
            if existing:
                response.status_code = 200
                return existing[0]
        logger.error("journey creation failed user_id=%s error_type=%s", user["sub"], type(exc).__name__)
        raise HTTPException(500, "Journey could not be created.") from None
    if not rows:
        raise HTTPException(500, "Journey could not be created.")
    return rows[0]


@router.get("")
def list_journeys(user=Depends(get_current_user)):
    return {"items": _db(user).table("journeys").select("*").order("created_at", desc=True).execute().data}


@router.get("/{journey_id}")
def get_journey(journey_id: str, user=Depends(get_current_user)):
    rows = _db(user).table("journeys").select("*").eq("id", journey_id).execute().data
    if not rows:
        raise HTTPException(404, "Journey not found.")
    return rows[0]


def transition(journey_id, target, user):
    db = _db(user)
    current = db.table("journeys").select("*").eq("id", journey_id).execute().data
    if not current:
        raise HTTPException(404, "Journey not found.")
    row = current[0]
    if row["owner_id"] != user["sub"]:
        raise HTTPException(403, "Only the journey owner can change its state.")
    try:
        updated = db.rpc("transition_journey", {
            "p_journey_id": journey_id, "p_owner_id": user["sub"], "p_target": target,
        }).execute().data
    except Exception as exc:  # noqa: BLE001 - database function signals transactional conflicts.
        if "FORBIDDEN" in str(exc):
            raise HTTPException(403, "Only the journey owner can change its state.") from None
        if "CONFLICT" in str(exc):
            raise HTTPException(409, "Journey is already in a different terminal state.") from None
        logger.error("journey transition failed journey_id=%s error_type=%s", journey_id, type(exc).__name__)
        raise HTTPException(500, "Journey state could not be changed.") from None
    if not updated:
        raise HTTPException(409, "Journey state changed concurrently.")
    return updated[0] if isinstance(updated, list) else updated


@router.post("/{journey_id}/complete")
def complete_journey(journey_id: str, user=Depends(get_current_user)):
    return transition(journey_id, "completed", user)


@router.post("/{journey_id}/cancel")
def cancel_journey(journey_id: str, user=Depends(get_current_user)):
    return transition(journey_id, "cancelled", user)


@router.get("/{journey_id}/alerts")
def list_journey_alerts(journey_id: str, user=Depends(get_current_user)):
    db = _db(user)
    if not db.table("journeys").select("id").eq("id", journey_id).execute().data:
        raise HTTPException(404, "Journey not found.")
    rows = db.table("journey_alerts").select(
        "id,journey_id,guardian_id,priority,state,attempt_count,next_attempt_at,created_at"
    ).eq("journey_id", journey_id).order("priority").execute().data
    return {"items": rows}
