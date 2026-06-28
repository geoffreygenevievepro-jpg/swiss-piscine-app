"""Vue CCNT (onglet Présence, HHC uniquement) : mapping des congés + gating société."""
from fastapi.testclient import TestClient

from app import odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


def emp(company_id):
    return {"id": 1, "login": "u", "name": "U", "role": "staff",
            "hr_employee_id": 42, "pin_hash": "h", "company_id": company_id}


def test_leave_cat_mapping():
    assert odoo._ccnt_leave_cat("Paid Time Off (Switzerland)") == "vac"
    assert odoo._ccnt_leave_cat("Vacance (1/2 journée)") == "vac"
    assert odoo._ccnt_leave_cat("Salary in case of Illness") == "mal"
    assert odoo._ccnt_leave_cat("Sick Time Off") == "mal"
    assert odoo._ccnt_leave_cat("Salary in case of Accident") == "acc"
    assert odoo._ccnt_leave_cat("Maternity / Paternity Leave") == "mat"
    assert odoo._ccnt_leave_cat("Military Leave") == "mil"
    assert odoo._ccnt_leave_cat("Déménagement") == "conge"
    assert odoo._ccnt_leave_cat(None) == "conge"


def test_ccnt_disabled_for_non_hhc(monkeypatch):
    """Société != HHC (1) → {enabled: False}, ccnt_year jamais appelé."""
    called = {"n": 0}
    monkeypatch.setattr(odoo, "ccnt_year", lambda *a, **k: called.__setitem__("n", called["n"] + 1) or {})
    app.dependency_overrides[get_current_employee] = lambda: emp(5)  # Swiss Piscine
    r = client.get("/attendance/ccnt")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == {"enabled": False}
    assert called["n"] == 0


def test_ccnt_enabled_for_hhc(monkeypatch):
    """Société HHC (1) → appelle ccnt_year(hr, 1, year) et renvoie enabled:True."""
    captured = {}
    monkeypatch.setattr(odoo, "ccnt_year",
                        lambda hr, cid, year: captured.update(hr=hr, cid=cid, year=year) or {"months": [], "calendar": []})
    app.dependency_overrides[get_current_employee] = lambda: emp(1)  # HHC
    r = client.get("/attendance/ccnt?year=2025")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True
    assert captured == {"hr": 42, "cid": 1, "year": 2025}


def test_ccnt_resolves_company_via_odoo_when_null(monkeypatch):
    """company_id NULL en base → résolu via employee_company_id (ici 1 = HHC)."""
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 1)
    monkeypatch.setattr(odoo, "ccnt_year", lambda hr, cid, year: {"ok": cid})
    app.dependency_overrides[get_current_employee] = lambda: emp(None)
    r = client.get("/attendance/ccnt")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json().get("enabled") is True
