# backend/tests/test_login_2fa.py
from fastapi.testclient import TestClient
import app.db as db, app.odoo as odoo, app.supabase_access as sa
from app.security import verify_pin  # noqa
import app.security as security
from app.main import app

client = TestClient(app)

def _prep(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db()
    from app.security import hash_pin
    db.upsert_employee(1, "alex", "Alex", "tech", hash_pin("1234"))
    monkeypatch.setattr(sa, "access_decision", lambda *a, **k: {"allowed": True, "effective_tabs": [], "level": None})
    return db.get_employee_by_login("alex")

def test_login_requires_2fa_setup_first_time(tmp_path, monkeypatch):
    _prep(tmp_path, monkeypatch)
    r = client.post("/auth/login", json={"login": "alex", "pin": "1234"})
    assert r.status_code == 200
    assert r.json().get("twofa_setup_required") is True and "pending_token" in r.json()
    assert "access_token" not in r.json()

def test_login_trusted_device_skips_2fa(tmp_path, monkeypatch):
    emp = _prep(tmp_path, monkeypatch)
    db.set_twofa(emp["id"], "totp", "ENC")
    import app.twofa as twofa
    from datetime import datetime, timedelta, timezone
    token = "dev-token"
    db.add_trusted_device(emp["id"], twofa.hash_token(token),
                          (datetime.now(timezone.utc) + timedelta(days=30)).isoformat(), "")
    r = client.post("/auth/login", json={"login": "alex", "pin": "1234"}, cookies={"sp_trust": token})
    assert r.status_code == 200 and "access_token" in r.json()

def test_login_twofa_required(tmp_path, monkeypatch):
    """M4 — employé avec 2FA activé, sans cookie de confiance → twofa_required + pending_token, sans access_token."""
    emp = _prep(tmp_path, monkeypatch)
    db.set_twofa(emp["id"], "totp", "ENC")
    r = client.post("/auth/login", json={"login": "alex", "pin": "1234"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("twofa_required") is True
    assert "pending_token" in body
    assert "access_token" not in body
