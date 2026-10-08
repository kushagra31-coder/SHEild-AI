# ruff: noqa: B008
import hashlib
import logging
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.core.security import get_current_user
from app.db.supabase import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)


class InviteRequest(BaseModel):
    display_name: str = Field(min_length=1, max_length=120)
    phone_number: str = Field(min_length=3, max_length=40)
    priority: int = Field(ge=1, le=2147483647)


class AcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=200)


class PriorityRequest(BaseModel):
    priority: int = Field(ge=1, le=2147483647)


def _db(user):
    return get_supabase_client(user.get("_token", ""))


@router.post("/invites", status_code=201)
def create_invite(body: InviteRequest, user=Depends(get_current_user)):
    db = _db(user)
    if len(re.sub(r"\D", "", body.phone_number)) < 3:
        raise HTTPException(422, "A valid phone number is required.")
    token = secrets.token_urlsafe(32)
    try:
        result = db.rpc("create_guardian_invite", {
            "p_owner_id": user["sub"], "p_display_name": body.display_name.strip(),
            "p_phone_number": body.phone_number.strip(), "p_priority": body.priority,
            "p_token_hash": hashlib.sha256(token.encode()).hexdigest(),
        }).execute().data
        row = result[0] if isinstance(result, list) and result else result
        if not row:
            raise HTTPException(500, "Invitation could not be created.")
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        error = str(exc)
        if "PRIORITY_CONFLICT" in error or "uq_active_guardian_priority" in error:
            raise HTTPException(409, "Priority is already in use.")
        if "SELF_INVITE" in error:
            raise HTTPException(422, "You cannot invite yourself.") from None
        if "DUPLICATE_INVITE" in error:
            raise HTTPException(409, "An active invitation already exists for this contact.") from None
        if "INVALID_INVITE" in error:
            raise HTTPException(422, "Invitation details are invalid.") from None
        logger.error("guardian invitation creation failed user_id=%s error_type=%s", user["sub"], type(exc).__name__)
        raise HTTPException(500, "Invitation could not be created.") from None
    return {**row, "token": token}


@router.post("/accept", status_code=201)
def accept_invite(body: AcceptRequest, user=Depends(get_current_user)):
    try:
        result = _db(user).rpc("accept_guardian_invite", {
            "p_token_hash": hashlib.sha256(body.token.encode()).hexdigest(),
            "p_guardian_id": user["sub"],
        }).execute()
        data = result.data[0] if isinstance(result.data, list) and result.data else result.data
        if not data:
            raise HTTPException(500, "Invitation acceptance returned no relationship.")
        return data
    except Exception as exc:
        if isinstance(exc, HTTPException):
            raise
        error = str(exc)
        if "EXPIRED" in error or "USED" in error or "INVALID" in error:
            raise HTTPException(409, "Invitation is invalid, expired, or already used.")
        if "FORBIDDEN" in error:
            raise HTTPException(403, "Invitation owner cannot accept their own invitation.")
        raise HTTPException(409, "Invitation could not be accepted.")


@router.get("")
def list_guardians(user=Depends(get_current_user)):
    db = _db(user)
    rows = db.table("guardian_links").select("*").eq("owner_id", user["sub"]).order("priority").execute().data
    for row in rows:
        profiles = db.table("profiles").select("display_name,phone_number").eq("id", row["guardian_id"]).execute().data
        row["display_name"] = profiles[0]["display_name"] if profiles else None
        phone = profiles[0].get("phone_number") if profiles else None
        row["phone_number"] = f"••••{phone[-4:]}" if phone and len(phone) >= 4 else None
    return {"items": rows}


@router.get("/invites")
def list_invites(user=Depends(get_current_user)):
    rows = _db(user).table("guardian_invites").select(
        "id,display_name,phone_number,priority,expires_at,accepted_by,used_at,created_at"
    ).eq("owner_id", user["sub"]).order("created_at", desc=True).execute().data
    return {"items": rows}


@router.get("/relationships")
def list_my_guardianships(user=Depends(get_current_user)):
    rows = _db(user).table("guardian_links").select(
        "id,owner_id,guardian_id,priority,status,consented_at,revoked_at,created_at"
    ).eq("guardian_id", user["sub"]).order("created_at", desc=True).execute().data
    return {"items": rows}


@router.post("/{link_id}/revoke")
def revoke_guardian(link_id: str, user=Depends(get_current_user)):
    try:
        rows = _db(user).rpc("revoke_guardian_link", {"p_link_id": link_id, "p_owner_id": user["sub"]}).execute().data
    except Exception as exc:  # noqa: BLE001 - Supabase client raises transport and API exception types.
        if "FORBIDDEN" in str(exc):
            raise HTTPException(403, "Only the relationship owner can revoke it.") from None
        logger.error("guardian revocation failed user_id=%s error_type=%s", user["sub"], type(exc).__name__)
        raise HTTPException(500, "Guardian relationship could not be revoked.") from None
    if not rows:
        raise HTTPException(404, "Guardian relationship not found.")
    return rows[0] if isinstance(rows, list) else rows


@router.patch("/{link_id}/priority")
def update_priority(link_id: str, body: PriorityRequest, user=Depends(get_current_user)):
    db = _db(user)
    try:
        rows = db.rpc("update_guardian_priority", {
            "p_link_id": link_id, "p_owner_id": user["sub"], "p_priority": body.priority,
        }).execute().data
    except Exception as exc:  # noqa: BLE001 - Supabase client raises transport and API exception types.
        if "23505" in str(exc) or "uq_active_guardian_priority" in str(exc):
            raise HTTPException(409, "Priority is already assigned to another active guardian.")
        logger.error("guardian priority update failed user_id=%s error_type=%s", user["sub"], type(exc).__name__)
        raise HTTPException(500, "Priority could not be updated.") from None
    if not rows:
        raise HTTPException(404, "Guardian relationship not found.")
    return rows[0] if isinstance(rows, list) else rows
