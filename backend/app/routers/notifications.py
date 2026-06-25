"""Notifications : poll Odoo à l'ouverture (congés validés/refusés, planning maj),
stockage en SQLite, préférences par type."""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .. import db, odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/notifications", tags=["notifications"])

DEFAULT_PREFS = {"leave": True, "planning": True}


class Prefs(BaseModel):
    leave: bool = True
    planning: bool = True


def _prefs(hr: int) -> dict:
    st = db.get_notif_state(hr)
    if st and st["prefs"]:
        try:
            return {**DEFAULT_PREFS, **json.loads(st["prefs"])}
        except Exception:
            pass
    return dict(DEFAULT_PREFS)


@router.get("")
def list_notifs(emp=Depends(get_current_employee)):
    hr = emp["hr_employee_id"]
    st = db.get_notif_state(hr)
    prefs = _prefs(hr)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    since = st["last_poll"] if st and st["last_poll"] else now
    try:
        for ev in odoo.poll_events(hr, since):
            if prefs.get(ev["cat"], True):
                db.insert_notification(hr, ev["type"], ev["title"], ev["body"], ev["dedup_key"], ev["occurred_at"])
    except Exception:
        pass
    db.set_notif_cursor(hr, now)
    return {"items": db.list_notifications(hr), "unread": db.count_unread(hr), "prefs": prefs}


@router.post("/read", status_code=204)
def mark_read(emp=Depends(get_current_employee)):
    db.mark_all_read(emp["hr_employee_id"])


@router.get("/prefs")
def get_prefs(emp=Depends(get_current_employee)):
    return _prefs(emp["hr_employee_id"])


@router.patch("/prefs")
def set_prefs(body: Prefs, emp=Depends(get_current_employee)):
    db.set_notif_prefs(emp["hr_employee_id"], json.dumps(body.model_dump()))
    return body.model_dump()
