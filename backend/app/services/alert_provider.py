import logging
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

logger = logging.getLogger(__name__)


class AlertProvider(Protocol):
    def deliver(self, delivery_id: UUID, incident_id: UUID, guardian_id: UUID) -> str: ...


class MockAlertProvider:
    """Local demo provider. Acceptance is simulated; no notification leaves the backend."""

    def deliver(self, delivery_id: UUID, incident_id: UUID, guardian_id: UUID) -> str:
        return f"mock:{delivery_id}"


def deliver_queued_incident_alerts(db, incident_id: str, owner_id: str, provider: AlertProvider) -> None:
    """Deliver due jobs in priority order; a failed delivery never changes the incident."""
    rows = db.table("alert_deliveries").select(
        "id,guardian_id,state,next_attempt_at,attempt_count"
    ).eq("incident_id", incident_id).in_("state", ["queued", "provider_failed"]).order("stage").execute().data
    for row in rows:
        retry_at = row.get("next_attempt_at")
        if row.get("attempt_count", 0) >= 5 or (retry_at and datetime.fromisoformat(retry_at) > datetime.now(UTC)):
            continue
        try:
            provider_ref = provider.deliver(UUID(row["id"]), UUID(incident_id), UUID(row["guardian_id"]))
            db.rpc("record_incident_alert_result", {
                "p_delivery_id": row["id"], "p_owner_id": owner_id, "p_provider_ref": provider_ref,
            }).execute()
        except Exception as exc:  # noqa: BLE001 - provider adapters expose transport-specific failures.
            logger.error("alert_delivery_failed incident_id=%s error_type=%s", incident_id, type(exc).__name__)
            try:
                db.rpc("record_incident_alert_failure", {
                    "p_delivery_id": row["id"], "p_owner_id": owner_id,
                }).execute()
            except Exception as record_exc:  # noqa: BLE001 - keep other deliveries isolated.
                logger.error("alert_failure_record_failed incident_id=%s error_type=%s", incident_id, type(record_exc).__name__)
