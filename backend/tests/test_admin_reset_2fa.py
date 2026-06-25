from fastapi.testclient import TestClient
import app.db as db
from app.main import app
from app.routers.admin import require_admin

client = TestClient(app)

def test_reset_2fa(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db(); db.upsert_employee(1, "alex", "Alex", "tech", "h")
    emp = db.get_employee_by_login("alex")
    db.set_twofa(emp["id"], "totp", "ENC")
    app.dependency_overrides[require_admin] = lambda: {"id": 99, "role": "admin"}
    r = client.post(f"/admin/employees/{emp['id']}/reset-2fa")
    assert r.status_code == 200
    assert db.get_employee_by_id(emp["id"])["twofa_enabled"] == 0
    app.dependency_overrides.clear()
