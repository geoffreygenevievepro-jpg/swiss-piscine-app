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


# Router test: GET /employees passes employee's company to list_employees
def test_router_interventions_employees_passes_company(monkeypatch):
    """GET /employees doit appeler odoo.list_employees(company_id) avec la société de l'employé."""
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(
        odoo, "list_employees",
        lambda company_id: captured.__setitem__("cid", company_id) or []
    )

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "tech",
        "hr_employee_id": 42, "pin_hash": "h"
    }
    r = client.get("/employees")
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("cid") == 9


# ---- Task 3 tests -----------------------------------------------------------

def test_migration_adds_company_id_column(tmp_path, monkeypatch):
    """init_db() doit ajouter la colonne company_id à la table employees."""
    from app import db as _db
    monkeypatch.setattr(_db.settings, "db_path", str(tmp_path / "test.db"))
    _db.init_db()
    with _db.get_conn() as conn:
        cols = [row[1] for row in conn.execute("PRAGMA table_info(employees)").fetchall()]
    assert "company_id" in cols


def test_upsert_employee_stores_company_id(tmp_path, monkeypatch):
    """upsert_employee(..., company_id=7) → get_employee_by_login renvoie company_id==7."""
    from app import db as _db
    monkeypatch.setattr(_db.settings, "db_path", str(tmp_path / "test.db"))
    _db.init_db()
    _db.upsert_employee(
        hr_employee_id=200,
        login="test_user",
        name="Test User",
        role="tech",
        pin_hash="hashed",
        company_id=7,
    )
    emp = _db.get_employee_by_login("test_user")
    assert emp is not None
    assert emp["company_id"] == 7


def test_upsert_employee_updates_company_id(tmp_path, monkeypatch):
    """upsert_employee avec nouveau company_id met à jour la ligne existante."""
    from app import db as _db
    monkeypatch.setattr(_db.settings, "db_path", str(tmp_path / "test.db"))
    _db.init_db()
    _db.upsert_employee(200, "test_user", "Test User", "tech", "hashed", company_id=7)
    _db.upsert_employee(200, "test_user", "Test User", "tech", "hashed", company_id=9)
    emp = _db.get_employee_by_login("test_user")
    assert emp["company_id"] == 9


def test_login_gate_uses_employee_company_id(tmp_path, monkeypatch):
    """login() doit appeler access_decision avec company_id de l'employé (pas settings)."""
    import app.supabase_access as _sa
    from app import db as _db
    monkeypatch.setattr(_db.settings, "db_path", str(tmp_path / "test.db"))
    _db.init_db()

    from app.security import hash_pin
    _db.upsert_employee(300, "emp_co7", "Emp Co7", "tech", hash_pin("1234"), company_id=7)

    captured = {}
    def fake_access_decision(hr_id, company_id):
        captured["company_id"] = company_id
        return {"allowed": True, "effective_tabs": []}
    monkeypatch.setattr(_sa, "access_decision", fake_access_decision)

    # Patch twofa so we skip the 2FA flow (simulate trusted device)
    import app.twofa as _twofa
    monkeypatch.setattr(_twofa, "hash_token", lambda t: t)
    import app.db as _db2
    monkeypatch.setattr(_db2, "is_device_trusted", lambda *a, **kw: True)

    r = client.post("/auth/login", json={"login": "emp_co7", "pin": "1234"})
    assert r.status_code == 200
    assert captured.get("company_id") == 7


def test_me_gate_uses_employee_company_id(monkeypatch):
    """GET /me doit appeler access_decision avec company_id de l'employé (pas settings)."""
    import app.supabase_access as _sa
    import app.odoo as _odoo

    captured = {}
    def fake_access_decision(hr_id, company_id):
        captured["company_id"] = company_id
        return {"allowed": True, "effective_tabs": []}
    monkeypatch.setattr(_sa, "access_decision", fake_access_decision)
    monkeypatch.setattr(_odoo, "get_employee", lambda hr_id: {})
    monkeypatch.setattr(_odoo, "employee_extra", lambda hr_id: {})

    from app.main import app as _app
    from app.deps import get_current_employee

    fake_emp = {
        "id": 1, "login": "u", "name": "U", "role": "tech",
        "hr_employee_id": 300, "pin_hash": "h", "company_id": 7,
    }
    _app.dependency_overrides[get_current_employee] = lambda: fake_emp
    r = client.get("/me")
    _app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("company_id") == 7


def test_me_gate_falls_back_to_settings_when_no_company_id(monkeypatch):
    """GET /me doit utiliser settings.company_id si company_id de l'employé est None."""
    import app.supabase_access as _sa
    import app.odoo as _odoo
    from app.config import settings as _settings

    captured = {}
    def fake_access_decision(hr_id, company_id):
        captured["company_id"] = company_id
        return {"allowed": True, "effective_tabs": []}
    monkeypatch.setattr(_sa, "access_decision", fake_access_decision)
    monkeypatch.setattr(_odoo, "get_employee", lambda hr_id: {})
    monkeypatch.setattr(_odoo, "employee_extra", lambda hr_id: {})

    from app.main import app as _app
    from app.deps import get_current_employee

    fake_emp = {
        "id": 1, "login": "u", "name": "U", "role": "tech",
        "hr_employee_id": 300, "pin_hash": "h", "company_id": None,
    }
    _app.dependency_overrides[get_current_employee] = lambda: fake_emp
    r = client.get("/me")
    _app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("company_id") == _settings.company_id


# ---- Task 4 tests -----------------------------------------------------------

def test_company_branding_returns_name_and_logo_data_url(monkeypatch):
    """company_branding renvoie name + logo en data URL depuis res.company."""
    ro = MagicMock()
    ro.execute_kw.return_value = [{"name": "Elie Paysage SA", "logo": "QUJD"}]
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    result = odoo.company_branding(7)

    assert result["id"] == 7
    assert result["name"] == "Elie Paysage SA"
    assert result["logo"] == "data:image/png;base64,QUJD"


def test_company_branding_returns_none_on_exception(monkeypatch):
    """company_branding renvoie name/logo None si l'appel Odoo échoue."""
    ro = MagicMock()
    ro.execute_kw.side_effect = Exception("Odoo unreachable")
    monkeypatch.setattr(odoo, "get_client", lambda: ro)

    result = odoo.company_branding(7)

    assert result == {"id": 7, "name": None, "logo": None}


def test_company_theme_color_returns_color(monkeypatch):
    """company_theme_color renvoie la valeur theme_color depuis Supabase."""
    import app.supabase_access as _sa

    monkeypatch.setattr(_sa, "_get", lambda path: [{"theme_color": "#ff5500"}])

    result = _sa.company_theme_color(7)
    assert result == "#ff5500"


def test_company_theme_color_returns_none_when_absent(monkeypatch):
    """company_theme_color renvoie None si pas de ligne Supabase."""
    import app.supabase_access as _sa

    monkeypatch.setattr(_sa, "_get", lambda path: None)

    result = _sa.company_theme_color(7)
    assert result is None


def test_me_includes_company_block_with_fallback_color(monkeypatch):
    """/me doit inclure un bloc company avec la couleur de repli si Supabase renvoie None."""
    import app.supabase_access as _sa
    import app.odoo as _odoo
    from app.main import app as _app
    from app.deps import get_current_employee

    monkeypatch.setattr(_odoo, "get_employee", lambda hr_id: {})
    monkeypatch.setattr(_odoo, "employee_extra", lambda hr_id: {})
    monkeypatch.setattr(_sa, "access_decision", lambda hr_id, company_id: {"allowed": True, "effective_tabs": []})
    monkeypatch.setattr(_odoo, "company_branding", lambda cid: {"id": cid, "name": "Swiss Piscine Sàrl", "logo": None})
    monkeypatch.setattr(_sa, "company_theme_color", lambda cid: None)

    fake_emp = {
        "id": 1, "login": "u", "name": "U", "role": "tech",
        "hr_employee_id": 42, "pin_hash": "h", "company_id": 5,
    }
    _app.dependency_overrides[get_current_employee] = lambda: fake_emp
    r = client.get("/me")
    _app.dependency_overrides.clear()

    assert r.status_code == 200
    data = r.json()
    assert "company" in data
    assert data["company"]["id"] == 5
    assert data["company"]["name"] == "Swiss Piscine Sàrl"
    assert data["company"]["logo"] is None
    assert data["company"]["color"] == "#0c5e68"


# ---- Task 6 tests -----------------------------------------------------------

def test_companies_arg_parses_csv():
    """companies_arg('5, 4 ,') doit renvoyer [5, 4] (strip, ignore empties)."""
    from seed_employees import companies_arg
    assert companies_arg("5, 4 ,") == [5, 4]


def test_companies_arg_single():
    """companies_arg('5') → [5]."""
    from seed_employees import companies_arg
    assert companies_arg("5") == [5]


def test_seed_loop_calls_per_company(monkeypatch):
    """main() avec --companies 5,7 appelle list_employees et upsert_employee pour chaque société."""
    import sys
    import seed_employees as se
    from app import db as _db, odoo as _odoo

    # Fake employees returned by list_employees
    fake_emp = {"id": 100, "name": "Alice Martin", "job_title": "Tech"}

    list_calls: list[int] = []
    upsert_calls: list[dict] = []

    def fake_list(cid: int):
        list_calls.append(cid)
        return [fake_emp]

    def fake_upsert(hr_employee_id, login, name, role, pin_hash, company_id=None):
        upsert_calls.append({"hr_id": hr_employee_id, "company_id": company_id})

    monkeypatch.setattr(_odoo, "list_employees", fake_list)
    monkeypatch.setattr(_db, "upsert_employee", fake_upsert)
    monkeypatch.setattr(_db, "init_db", lambda: None)

    # --reset skips the existing_hr_ids/get_conn queries, keeping the mock simple
    monkeypatch.setattr(sys, "argv", ["seed_employees.py", "--companies", "5,7", "--pin", "000000", "--reset"])
    se.main()

    assert list_calls == [5, 7], f"list_employees appelé avec {list_calls}"
    assert [c["company_id"] for c in upsert_calls] == [5, 7], f"company_ids dans upsert: {upsert_calls}"


# ---- I1 test — search_report_products scoped to employee's company ------------

def test_router_products_search_uses_employee_company(monkeypatch):
    """GET /products/search doit appeler search_report_products avec la société 9 (pas settings)."""
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 9)
    monkeypatch.setattr(
        odoo, "search_report_products",
        lambda query, company_id, limit=20: captured.__setitem__("company_id", company_id) or [],
    )

    app.dependency_overrides[get_current_employee] = lambda: {
        "id": 1, "login": "u", "name": "U", "role": "tech",
        "hr_employee_id": 42, "pin_hash": "h",
    }
    r = client.get("/products/search", params={"q": "pompe"})
    app.dependency_overrides.clear()

    assert r.status_code == 200
    assert captured.get("company_id") == 9, (
        f"search_report_products appelé avec company_id={captured.get('company_id')}, attendu 9"
    )
