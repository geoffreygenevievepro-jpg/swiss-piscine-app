from datetime import date
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import app.routers.birthdays as bd
import app.odoo as odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


# --- Fonctions pures -------------------------------------------------------
def test_match_birthdays_today_and_is_me():
    emps = [{"id": 1, "name": "Niyongira Fanny"}, {"id": 2, "name": "Roberto Da Silva"}]
    by_id = {1: "1990-06-27", 2: "1985-01-03"}
    out = bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=2)
    assert out == [{"employee_id": 1, "first_name": "Fanny", "is_me": False}]


def test_match_birthdays_marks_me():
    emps = [{"id": 2, "name": "Roberto Da Silva"}]
    by_id = {2: "1985-06-27"}
    out = bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=2)
    assert out == [{"employee_id": 2, "first_name": "Silva", "is_me": True}]


def test_match_birthdays_ignores_empty_and_other_days():
    emps = [{"id": 1, "name": "A B"}, {"id": 2, "name": "C D"}, {"id": 3, "name": "E F"}]
    by_id = {1: False, 2: "1990-12-01", 3: None}
    assert bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=9) == []


def test_match_birthdays_feb29_on_feb28_non_leap():
    emps = [{"id": 1, "name": "Jean Test"}]
    by_id = {1: "1992-02-29"}
    # 2027 n'est pas bissextile → célébré le 28/02
    assert bd.match_birthdays(emps, by_id, date(2027, 2, 28), me_id=9)[0]["employee_id"] == 1
    # une année bissextile, le 28/02 ne déclenche PAS le 29/02
    assert bd.match_birthdays(emps, by_id, date(2028, 2, 28), me_id=9) == []
    assert bd.match_birthdays(emps, by_id, date(2028, 2, 29), me_id=9)[0]["employee_id"] == 1


# --- Endpoint --------------------------------------------------------------
def test_birthdays_today_endpoint(monkeypatch):
    monkeypatch.setattr(odoo, "list_employees", lambda: [{"id": 1, "name": "Niyongira Fanny"}])
    cli = MagicMock()
    cli.execute_kw.return_value = [{"id": 1, "name": "Niyongira Fanny", "birthday": "1990-06-27"}]
    monkeypatch.setattr(odoo, "get_client", lambda: cli)
    monkeypatch.setattr(bd, "_today_zurich", lambda: date(2026, 6, 27))
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 1, "name": "Niyongira Fanny"}
    r = client.get("/birthdays/today")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == [{"employee_id": 1, "first_name": "Fanny", "is_me": True}]


def test_birthdays_today_empty(monkeypatch):
    monkeypatch.setattr(odoo, "list_employees", lambda: [{"id": 1, "name": "Niyongira Fanny"}])
    cli = MagicMock()
    cli.execute_kw.return_value = [{"id": 1, "name": "Niyongira Fanny", "birthday": "1990-01-01"}]
    monkeypatch.setattr(odoo, "get_client", lambda: cli)
    monkeypatch.setattr(bd, "_today_zurich", lambda: date(2026, 6, 27))
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 1, "name": "X"}
    r = client.get("/birthdays/today")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == []
