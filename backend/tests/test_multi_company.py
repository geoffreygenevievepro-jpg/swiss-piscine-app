# backend/tests/test_multi_company.py
from unittest.mock import MagicMock, call
from fastapi.testclient import TestClient
import app.odoo as odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


def test_company_domain_param():
    assert odoo._company_domain(7) == [["company_id", "=", 7]]


def test_week_planning_uses_employee_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 7)
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    odoo.week_planning(194, 0)
    # le domaine planning.slot doit contenir la société 7 (pas 5)
    flat = str(captured.get("domain"))
    assert '"company_id"' in flat.replace("'", '"') and "7" in flat


# ---- Task 2 tests -----------------------------------------------------------

# Helper: team_week uses the passed company_id
def test_team_week_uses_passed_company(monkeypatch):
    """team_week(7) doit filtrer planning.slot et hr.leave sur company_id=7."""
    calls = []
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        calls.append((model, args[0] if args else []))
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.team_week(7)

    # planning.slot domain must contain ["company_id","=",7]
    slot_domain = next(
        (domain for model, domain in calls if model == "planning.slot"), None
    )
    assert slot_domain is not None, "planning.slot not queried"
    assert ["company_id", "=", 7] in slot_domain

    # hr.leave domain must contain ["employee_company_id","=",7]
    leave_domain = next(
        (domain for model, domain in calls if model == "hr.leave"), None
    )
    assert leave_domain is not None, "hr.leave not queried"
    assert ["employee_company_id", "=", 7] in leave_domain


# Helper: upcoming_holidays uses the passed company_id
def test_upcoming_holidays_uses_passed_company(monkeypatch):
    """upcoming_holidays(7) doit filtrer resource.calendar.leaves sur company_id=7."""
    captured = {}
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        if model == "resource.calendar.leaves":
            captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.upcoming_holidays(7)

    domain = captured.get("domain", [])
    assert ["company_id", "=", 7] in domain


# Helper: list_employees uses the passed company_id
def test_list_employees_uses_passed_company(monkeypatch):
    captured = {}
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.list_employees(7)

    domain = captured.get("domain", [])
    assert ["company_id", "=", 7] in domain


# Helper: admin_employees_hours uses the passed company_id
def test_admin_employees_hours_uses_passed_company(monkeypatch):
    captured = {}
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        if model == "hr.employee":
            captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.admin_employees_hours(7)

    domain = captured.get("domain", [])
    assert ["company_id", "=", 7] in domain


# Helper: admin_leaves uses the passed company_id
def test_admin_leaves_uses_passed_company(monkeypatch):
    captured = {}
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        if model == "hr.leave":
            captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.admin_leaves(7)

    domain = captured.get("domain", [])
    assert ["employee_company_id", "=", 7] in domain


# Helper: pending_leaves uses the passed company_id
def test_pending_leaves_uses_passed_company(monkeypatch):
    captured = {}
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        if model == "hr.leave":
            captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    odoo.pending_leaves(7)

    domain = captured.get("domain", [])
    assert ["employee_company_id", "=", 7] in domain


# Router test: /week/team passes employee's company to team_week
def test_router_week_team_passes_company(monkeypatch):
    """GET /week/team doit appeler odoo.team_week(company_id) avec la société de l'employé."""
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "team_week", lambda company_id, offset=0: captured.__setitem__("cid", company_id) or {})

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "staff",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/week/team")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# Router test: /week/holidays passes employee's company to upcoming_holidays
def test_router_week_holidays_passes_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "upcoming_holidays", lambda company_id, limit=6: captured.__setitem__("cid", company_id) or [])

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "staff",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/week/holidays")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# Router test: /admin/employees-hours passes employee's company to admin_employees_hours
def test_router_admin_employees_hours_passes_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "admin_employees_hours", lambda company_id: captured.__setitem__("cid", company_id) or [])

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "admin",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/admin/employees-hours")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# Router test: /admin/leaves passes employee's company to admin_leaves
def test_router_admin_leaves_passes_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "admin_leaves", lambda company_id: captured.__setitem__("cid", company_id) or [])

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "admin",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/admin/leaves")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# Router test: /manager/leaves (admin) passes company to pending_leaves
def test_router_manager_leaves_admin_passes_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "pending_leaves", lambda company_id, manager_hr_id=None: captured.__setitem__("cid", company_id) or [])

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "admin",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/manager/leaves")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# Router test: /manager/leaves (manager) passes company and manager_hr_id
def test_router_manager_leaves_manager_passes_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(odoo, "pending_leaves", lambda company_id, manager_hr_id=None: (captured.update({"cid": company_id, "mgr": manager_hr_id})) or [])

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "manager",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/manager/leaves")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9
    assert captured.get("mgr") == 42
