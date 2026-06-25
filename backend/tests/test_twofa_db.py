from datetime import datetime, timedelta, timezone
import app.db as db

def _iso(dt): return dt.isoformat()

def test_twofa_columns_and_set_reset(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db()
    db.upsert_employee(1, "alex", "Alex", "manager", "h")
    emp = db.get_employee_by_login("alex")
    assert emp["twofa_enabled"] == 0
    db.set_twofa(emp["id"], "totp", "ENC")
    emp = db.get_employee_by_id(emp["id"])
    assert emp["twofa_enabled"] == 1 and emp["twofa_method"] == "totp" and emp["twofa_secret_encrypted"] == "ENC"
    db.reset_twofa(emp["id"])
    emp = db.get_employee_by_id(emp["id"])
    assert emp["twofa_enabled"] == 0 and emp["twofa_method"] is None and emp["twofa_secret_encrypted"] is None

def test_trusted_device(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db(); db.upsert_employee(1, "alex", "Alex", "tech", "h")
    eid = db.get_employee_by_login("alex")["id"]
    now = datetime.now(timezone.utc)
    db.add_trusted_device(eid, "HASH", _iso(now + timedelta(days=30)), "UA")
    assert db.is_device_trusted(eid, "HASH", _iso(now)) is True
    assert db.is_device_trusted(eid, "OTHER", _iso(now)) is False
    # expiré
    assert db.is_device_trusted(eid, "HASH", _iso(now + timedelta(days=31))) is False
    db.revoke_trusted_devices(eid)
    assert db.is_device_trusted(eid, "HASH", _iso(now)) is False

def test_email_otp(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db(); db.upsert_employee(1, "alex", "Alex", "tech", "h")
    eid = db.get_employee_by_login("alex")["id"]
    now = datetime.now(timezone.utc)
    db.create_email_otp(eid, "CH", _iso(now + timedelta(minutes=10)))
    row = db.get_email_otp(eid)
    assert row["code_hash"] == "CH" and row["attempts"] == 0
    db.bump_email_otp_attempts(eid)
    assert db.get_email_otp(eid)["attempts"] == 1
    assert db.count_recent_email_otps(eid, _iso(now - timedelta(hours=1))) == 1
    db.delete_email_otp(eid)
    assert db.get_email_otp(eid) is None
