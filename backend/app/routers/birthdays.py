"""Anniversaires du jour (hr.employee.birthday, company 5) pour le bandeau d'accueil.

Lit Odoo via les helpers existants (odoo.list_employees / odoo.get_client) sans
modifier odoo.py. Ne renvoie ni l'année ni l'âge (vie privée)."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/birthdays", tags=["birthdays"])


def _today_zurich() -> date:
    return datetime.now(ZoneInfo("Europe/Zurich")).date()


def _is_leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def _parse_birthday(val) -> date | None:
    if not val or not isinstance(val, str):
        return None
    try:
        return date.fromisoformat(val[:10])
    except ValueError:
        return None


def _is_birthday(bd: date, today: date) -> bool:
    if (bd.month, bd.day) == (today.month, today.day):
        return True
    # 29 février célébré le 28 février les années non bissextiles.
    if bd.month == 2 and bd.day == 29 and today.month == 2 and today.day == 28 and not _is_leap(today.year):
        return True
    return False


def _first_name(name: str) -> str:
    parts = (name or "").split()
    return parts[-1] if parts else (name or "")


def match_birthdays(emps: list[dict], by_id: dict, today: date, me_id: int) -> list[dict]:
    out = []
    for e in emps:
        bday = _parse_birthday(by_id.get(e["id"]))
        if bday and _is_birthday(bday, today):
            out.append({"employee_id": e["id"], "first_name": _first_name(e.get("name", "")),
                        "is_me": e["id"] == me_id})
    return out


@router.get("/today")
def today(emp=Depends(get_current_employee)):
    emps = odoo.list_employees()
    ids = [e["id"] for e in emps]
    by_id = {}
    if ids:
        rows = odoo.get_client().execute_kw(
            "hr.employee", "read", [ids], {"fields": ["name", "birthday"]})
        by_id = {r["id"]: r.get("birthday") for r in rows}
    return match_birthdays(emps, by_id, _today_zurich(), emp["hr_employee_id"])
