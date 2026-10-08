# ruff: noqa: B008
import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status

from app.core.security import get_current_user
from app.db.supabase import get_supabase_client
from app.schemas.incident import (
    AcknowledgeIncidentRequest,
    AcknowledgementResponse,
    CreateIncidentRequest,
    IncidentDetailResponse,
    IncidentListResponse,
    IncidentResponse,
    LocationPayload,
    LocationRecordResponse,
)
from app.services.alert_provider import (
    MockAlertProvider,
    deliver_queued_incident_alerts,
)

router = APIRouter()
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Valid state-machine transitions
# ---------------------------------------------------------------------------
# owner:   active → resolved, acknowledged → resolved
# guardian: active → acknowledged (via SECURITY DEFINER RPC only)
OWNER_RESOLVE_FROM = {"active", "acknowledged"}
TERMINAL_STATUSES  = {"resolved", "expired"}


def _not_found():
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Incident not found or unauthorized.",
    )


def _format_response(row: dict) -> dict:
    return {
        "id":              row["id"],
        "owner_id":        row["owner_id"],
        "client_event_id": row["client_event_id"],
        "trigger":         row["trigger"],
        "status":          row["status"],
        "started_at":      row["started_at"],
        "share_location":  row["share_location"],
        "alert_status":    row.get("alert_status", "queued"),
        "created_at":      row["created_at"],
        "resolved_at":     row.get("resolved_at"),
    }


# ---------------------------------------------------------------------------
# POST /incidents  (M1 — unchanged)
# ---------------------------------------------------------------------------
@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    request: CreateIncidentRequest,
    response: Response,
    idempotency_key: str | None = Header(None, alias="Idempotency-Key"),
    current_user: dict = Depends(get_current_user),
):
    """
    Create an emergency incident.

    Idempotency: if Idempotency-Key header is supplied it MUST equal client_event_id.
    Re-submitting the same (owner_id, client_event_id) pair returns the existing incident.
    """
    if idempotency_key is not None and idempotency_key != str(request.client_event_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header must match client_event_id if provided.",
        )

    user_id: str = current_user["sub"]
    raw_token: str = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    expires_at = (datetime.now(UTC) + timedelta(hours=24)).isoformat()

    duplicate = False
    try:
        res = db.table("incidents").insert({
            "owner_id":        user_id,
            "client_event_id": str(request.client_event_id),
            "trigger":         request.trigger,
            "share_location":  request.share_location,
            "started_at":      request.occurred_at.isoformat(),
            "expires_at":      expires_at,
        }).execute()

        incident = res.data[0]

    except Exception as exc:  # noqa: BLE001 - Supabase client errors vary by transport/provider.
        err = str(exc)
        if (
            "uq_incidents_owner_client_event" in err
            or "23505" in err
            or "duplicate key" in err.lower()
            or "conflict" in err.lower()
        ):
            existing = (
                db.table("incidents")
                .select("*")
                .eq("owner_id", user_id)
                .eq("client_event_id", str(request.client_event_id))
                .execute()
            )
            if existing.data:
                incident = existing.data[0]
                duplicate = True
        if not duplicate:
            logger.error("incident persistence failed user_id=%s error_type=%s", user_id, type(exc).__name__)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Incident could not be created.") from None

    # Alert queueing is isolated from incident persistence and safely repeatable.
    try:
        db.rpc("queue_incident_alerts", {"p_incident_id": incident["id"], "p_owner_id": user_id}).execute()
        deliver_queued_incident_alerts(db, incident["id"], user_id, MockAlertProvider())
    except Exception as exc:  # noqa: BLE001 - alert queue must not fail incident persistence.
        logger.error("alert queue failed incident_id=%s error_type=%s", incident["id"], type(exc).__name__)

    if request.location is not None and incident.get("status") in {"active", "acknowledged"}:
        try:
            submit_location(incident["id"], request.location, current_user)
        except Exception as exc:  # noqa: BLE001 - location failure must not roll back persisted incident.
            logger.error("initial_location_failed incident_id=%s error_type=%s", incident["id"], type(exc).__name__)

    if duplicate:
        response.status_code = status.HTTP_200_OK

    return _format_response(incident)


# ---------------------------------------------------------------------------
# GET /incidents  (active incidents visible to the authenticated caller)
# ---------------------------------------------------------------------------
@router.get("", response_model=IncidentListResponse)
def list_incidents(current_user: dict = Depends(get_current_user)):
    """List recent active incidents visible under the caller's Supabase RLS."""
    db = get_supabase_client(token=current_user.get("_token", ""))
    res = (
        db.table("incidents")
        .select("*")
        .in_("status", ["active", "acknowledged"])
        .gt("expires_at", datetime.now(UTC).isoformat())
        .order("created_at", desc=True)
        .execute()
    )
    return {"items": [_format_response(row) for row in res.data]}


@router.get("/history", response_model=IncidentListResponse)
def list_incident_history(current_user: dict = Depends(get_current_user)):
    """Owner's most recent incident history; RLS scopes the query to the JWT identity."""
    db = get_supabase_client(token=current_user.get("_token", ""))
    res = (db.table("incidents").select("*").eq("owner_id", current_user["sub"])
           .order("created_at", desc=True).limit(100).execute())
    return {"items": [_format_response(row) for row in res.data]}


# ---------------------------------------------------------------------------
# GET /incidents/{incident_id}  (M2)
# ---------------------------------------------------------------------------
@router.get("/{incident_id}", response_model=IncidentDetailResponse)
def get_incident(
    incident_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve incident details. RLS restricts access to owner or accepted guardians.
    """
    raw_token = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    res = db.table("incidents").select("*").eq("id", incident_id).execute()
    if not res.data:
        raise _not_found()

    incident = res.data[0]

    # Latest location
    loc_res = (
        db.table("incident_locations")
        .select("*")
        .eq("incident_id", incident_id)
        .gt("expires_at", datetime.now(UTC).isoformat())
        .order("captured_at", desc=True)
        .limit(1)
        .execute()
    )
    latest_loc = loc_res.data[0] if loc_res.data else None

    # Acknowledgements
    ack_res = (
        db.table("incident_acknowledgements")
        .select("*")
        .eq("incident_id", incident_id)
        .execute()
    )

    response_data = _format_response(incident)
    response_data["latest_location"] = latest_loc
    response_data["acknowledgements"] = ack_res.data
    return response_data


# ---------------------------------------------------------------------------
# POST /incidents/{incident_id}/acknowledge  (M2)
# ---------------------------------------------------------------------------
@router.post("/{incident_id}/acknowledge", response_model=AcknowledgementResponse)
def acknowledge_incident(
    incident_id: str,
    request: AcknowledgeIncidentRequest = AcknowledgeIncidentRequest(),
    current_user: dict = Depends(get_current_user),
):
    """
    Guardian acknowledgement via SECURITY DEFINER RPC.
    Enforces: accepted link, active→acknowledged transition, duplicate-safe.
    """
    guardian_id = current_user["sub"]
    raw_token   = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    try:
        res = db.rpc("acknowledge_incident", {
            "p_incident_id": incident_id,
            "p_guardian_id": guardian_id,
            "p_note":        request.note,
        }).execute()
    except Exception as exc:  # noqa: BLE001 - Supabase RPC errors vary by provider/transport.
        err = str(exc)
        if "FORBIDDEN" in err or "42501" in err:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not an accepted guardian for this incident.")
        if "NOT_FOUND" in err or "02000" in err:
            raise _not_found()
        if "CONFLICT" in err or "23514" in err:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incident is not in an acknowledgeable state.")
        logger.error("incident acknowledgement failed incident_id=%s error_type=%s", incident_id, type(exc).__name__)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Acknowledgement failed.") from None

    if not res.data:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Acknowledgement failed.")

    return res.data[0]


# ---------------------------------------------------------------------------
# POST /incidents/{incident_id}/resolve  (M2)
# ---------------------------------------------------------------------------
@router.post("/{incident_id}/resolve", response_model=IncidentResponse)
def resolve_incident(
    incident_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Owner resolves an active or acknowledged incident. Terminal state.
    Only the incident owner may resolve. RLS enforces ownership.
    """
    user_id   = current_user["sub"]
    raw_token = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    # Fetch incident (RLS limits to owner)
    res = db.table("incidents").select("*").eq("id", incident_id).execute()
    if not res.data:
        raise _not_found()

    incident = res.data[0]

    # Extra ownership assertion (belt-and-suspenders beyond RLS)
    if incident["owner_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the incident owner can resolve.")

    # State-machine guard
    if incident["status"] == "resolved":
        return _format_response(incident)
    if incident["status"] in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Incident is already in terminal state '{incident['status']}'.",
        )
    if incident["status"] not in OWNER_RESOLVE_FROM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot resolve an incident with status '{incident['status']}'.",
        )

    try:
        updated = db.rpc("resolve_incident", {"p_incident_id": incident_id, "p_owner_id": user_id}).execute().data
    except Exception as exc:  # noqa: BLE001 - database function signals transactional conflicts.
        if "FORBIDDEN" in str(exc):
            raise HTTPException(status_code=403, detail="Only the incident owner can resolve it.") from None
        if "CONFLICT" in str(exc):
            raise HTTPException(status_code=409, detail="Incident is not in a resolvable state.") from None
        logger.error("incident resolution failed incident_id=%s error_type=%s", incident_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Incident could not be resolved.") from None
    if not updated:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incident state changed concurrently. Retry.")

    return _format_response(updated[0] if isinstance(updated, list) else updated)


@router.get("/{incident_id}/deliveries")
def list_incident_deliveries(incident_id: str, current_user: dict = Depends(get_current_user)):
    """Delivery progress visible to the incident owner and accepted guardians under RLS."""
    db = get_supabase_client(token=current_user.get("_token", ""))
    if not db.table("incidents").select("id").eq("id", incident_id).execute().data:
        raise _not_found()
    rows = db.table("alert_deliveries").select(
        "id,incident_id,guardian_id,channel,stage,state,attempt_count,next_attempt_at,created_at,updated_at"
    ).eq("incident_id", incident_id).order("stage").execute().data
    return {"items": rows}


# ---------------------------------------------------------------------------
# POST /incidents/{incident_id}/location  (M2)
# ---------------------------------------------------------------------------
@router.post(
    "/{incident_id}/location",
    response_model=LocationRecordResponse,
    status_code=status.HTTP_200_OK,
)
def submit_location(
    incident_id: str,
    payload: LocationPayload,
    current_user: dict = Depends(get_current_user),
):
    """
    Owner submits a live location update for an active incident.
    """
    user_id   = current_user["sub"]
    raw_token = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    # Verify incident exists, is owned by caller, and is in an active state
    inc_res = db.table("incidents").select("id,status,share_location,owner_id").eq("id", incident_id).execute()
    if not inc_res.data:
        raise _not_found()

    incident = inc_res.data[0]

    if incident["owner_id"] != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the incident owner can submit locations.")
    if incident["status"] in TERMINAL_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Location updates cannot be submitted for a terminal incident.",
        )
    if not incident.get("share_location", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Location sharing is disabled for this incident.",
        )

    from app.core.config import settings
    retention_hours = min(48, int(getattr(settings, "LOCATION_RETENTION_HOURS", 48)))
    expires_at = (datetime.now(UTC) + timedelta(hours=retention_hours)).isoformat()

    try:
        rows = db.rpc("submit_incident_location", {
            "p_incident_id": incident_id,
            "p_owner_id": user_id,
            "p_latitude": payload.latitude,
            "p_longitude": payload.longitude,
            "p_accuracy_m": payload.accuracy_m,
            "p_captured_at": payload.captured_at.isoformat(),
            "p_expires_at": expires_at,
        }).execute().data
        if not rows:
            raise HTTPException(status_code=500, detail="Location could not be recorded.")
        return rows[0] if isinstance(rows, list) else rows
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        if "LOCATION_CONFLICT" in str(exc):
            raise HTTPException(status_code=409, detail="A different location sample already uses this capture time.") from None
        if "LOCATION_SHARING_DISABLED" in str(exc):
            raise HTTPException(status_code=403, detail="Location sharing is disabled for this incident.") from None
        logger.error("location persistence failed incident_id=%s error_type=%s", incident_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="Location could not be recorded.") from None


# ---------------------------------------------------------------------------
# GET /incidents/{incident_id}/location  (M2)
# ---------------------------------------------------------------------------
@router.get("/{incident_id}/location", response_model=LocationRecordResponse)
def get_latest_location(
    incident_id: str,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve the latest known location. RLS restricts access:
    owner always; guardian only when share_location=true and incident is active/acknowledged.
    """
    raw_token = current_user.get("_token", "")
    db = get_supabase_client(token=raw_token)

    # Verify incident exists & is accessible (RLS check via select)
    inc_res = db.table("incidents").select("id,status").eq("id", incident_id).execute()
    if not inc_res.data:
        raise _not_found()

    now_iso = datetime.now(UTC).isoformat()
    loc_res = (
        db.table("incident_locations")
        .select("*")
        .eq("incident_id", incident_id)
        .gt("expires_at", now_iso)          # Exclude expired records (retention policy)
        .order("captured_at", desc=True)
        .limit(1)
        .execute()
    )

    if not loc_res.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No location data for this incident.")

    return loc_res.data[0]
