from datetime import datetime
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, Field


class LocationPayload(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    accuracy_m: float | None = Field(None, ge=0.0)
    captured_at: AwareDatetime

class CreateIncidentRequest(BaseModel):
    client_event_id: UUID
    trigger: str = Field(..., pattern="^(manual|shake|missed_check_in|voice_keyword|other)$")
    occurred_at: AwareDatetime
    location: LocationPayload | None = None
    share_location: bool = True

class IncidentResponse(BaseModel):
    id: UUID
    owner_id: UUID
    client_event_id: UUID
    trigger: str
    status: str
    started_at: datetime
    share_location: bool
    alert_status: str
    created_at: datetime
    resolved_at: datetime | None = None

class IncidentListResponse(BaseModel):
    items: list[IncidentResponse]

class LocationRecordResponse(BaseModel):
    id: UUID
    incident_id: UUID
    latitude: float
    longitude: float
    accuracy_m: float | None = None
    captured_at: datetime
    expires_at: datetime | None = None

class AcknowledgementResponse(BaseModel):
    id: UUID
    incident_id: UUID
    guardian_id: UUID
    acknowledged_at: datetime
    note: str | None = None

class IncidentDetailResponse(IncidentResponse):
    latest_location: LocationRecordResponse | None = None
    acknowledgements: list[AcknowledgementResponse] = []

class AcknowledgeIncidentRequest(BaseModel):
    note: str | None = Field(None, max_length=280)

class ErrorDetail(BaseModel):
    code: str
    message: str
    request_id: str | None = None

class ErrorEnvelope(BaseModel):
    detail: str | None = None
    error: ErrorDetail
