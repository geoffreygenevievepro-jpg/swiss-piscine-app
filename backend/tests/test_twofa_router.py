# backend/tests/test_twofa_router.py
from fastapi.testclient import TestClient
import pyotp
import app.db as db
import app.odoo as odoo
import app.twofa as twofa
from app.main import app
from app.deps import get_pre2fa_employee
from app.security import create_pre2fa_token

client = TestClient(app)

def _setup(tmp_path, monkeypatch, work_email="a@b.ch"):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db(); db.upsert_employee(1, "alex", "Alex", "tech", "h")
    emp = db.get_employee_by_login("alex")
    app.dependency_overrides[get_pre2fa_employee] = lambda: emp
    monkeypatch.setattr(odoo, "get_employee", lambda hr: {"work_email": work_email})
    monkeypatch.setattr(odoo, "send_email", lambda *a, **k: True)
    return emp

def teardown_function():
    app.dependency_overrides.clear()

def test_status_can_email(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, work_email="a@b.ch")
    r = client.get("/2fa/status")
    assert r.status_code == 200 and r.json()["can_email"] is True and r.json()["enabled"] is False

def test_totp_setup_and_confirm(tmp_path, monkeypatch):
    emp = _setup(tmp_path, monkeypatch)
    start = client.post("/2fa/setup/totp/start").json()
    secret = start["secret"]
    code = pyotp.TOTP(secret).now()
    r = client.post("/2fa/setup/totp/confirm", json={"code": code})
    assert r.status_code == 200
    assert db.get_employee_by_id(emp["id"])["twofa_enabled"] == 1

def test_email_setup_requires_email(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, work_email="")  # pas d'email
    r = client.post("/2fa/setup/email/start")
    assert r.status_code == 400

def test_verify_brute_force_lockout(tmp_path, monkeypatch):
    """I1 — 5 échecs de /2fa/verify → 6e tentative renvoie 429."""
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db()
    db.upsert_employee(1, "alex", "Alex", "tech", "h")
    emp = db.get_employee_by_login("alex")
    # Activer TOTP avec un secret réel
    secret = twofa.new_secret()
    db.set_twofa(emp["id"], "totp", twofa.encrypt(secret))
    # Ne pas override get_pre2fa_employee : on veut des lectures fraîches du DB
    app.dependency_overrides.clear()
    token = create_pre2fa_token(emp["id"])
    headers = {"Authorization": f"Bearer {token}"}

    # 5 tentatives avec un code invalide
    for _ in range(5):
        r = client.post("/2fa/verify", json={"code": "000000"}, headers=headers)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"

    # 6e tentative → verrou 429
    r = client.post("/2fa/verify", json={"code": "000000"}, headers=headers)
    assert r.status_code == 429, f"Expected 429 after lockout, got {r.status_code}: {r.text}"
