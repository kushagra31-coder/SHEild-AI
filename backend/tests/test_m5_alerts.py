from uuid import UUID, uuid4

from app.services.alert_provider import (
    MockAlertProvider,
    deliver_queued_incident_alerts,
)


class Query:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.filters = {}

    def select(self, *_): return self
    def eq(self, key, value): self.filters[key] = value; return self
    def in_(self, key, value): self.filters[key] = value; return self
    def order(self, key, **_): self.db.order_by = key; return self
    def execute(self): return type("Result", (), {"data": self.db.rows})()


class DB:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    def table(self, table): return Query(self, table)
    def rpc(self, name, args):
        self.calls.append((name, args))
        query = type("Rpc", (), {})()
        query.execute = lambda: None
        return query


def test_mock_provider_marks_queued_jobs_in_guardian_priority_order():
    incident_id, first, second = uuid4(), uuid4(), uuid4()
    db = DB([
        {"id": str(uuid4()), "guardian_id": str(first), "state": "queued", "attempt_count": 0},
        {"id": str(uuid4()), "guardian_id": str(second), "state": "queued", "attempt_count": 0},
    ])
    deliver_queued_incident_alerts(db, str(incident_id), str(uuid4()), MockAlertProvider())
    assert db.order_by == "stage"
    assert [name for name, _ in db.calls] == ["record_incident_alert_result"] * 2
    assert all(args["p_provider_ref"].startswith("mock:") for _, args in db.calls)


def test_one_provider_failure_does_not_stop_later_guardian_delivery():
    incident_id = uuid4()
    rows = [
        {"id": str(uuid4()), "guardian_id": str(uuid4()), "state": "queued", "attempt_count": 0},
        {"id": str(uuid4()), "guardian_id": str(uuid4()), "state": "queued", "attempt_count": 0},
    ]
    class FailFirst:
        def deliver(self, delivery_id, *_):
            if delivery_id == UUID(rows[0]["id"]):
                raise RuntimeError("network")
    db = DB(rows)
    deliver_queued_incident_alerts(db, str(incident_id), str(uuid4()), FailFirst())
    assert [name for name, _ in db.calls] == ["record_incident_alert_failure", "record_incident_alert_result"]
