import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
import app.db as db
from app.security import create_pre2fa_token, create_access_token
from app.deps import get_pre2fa_employee

def _creds(tok): return HTTPAuthorizationCredentials(scheme="Bearer", credentials=tok)

def test_pre2fa_accepts_only_pre2fa(tmp_path, monkeypatch):
    monkeypatch.setattr(db.settings, "db_path", str(tmp_path / "t.db"))
    db.init_db(); db.upsert_employee(1, "alex", "Alex", "tech", "h")
    eid = db.get_employee_by_login("alex")["id"]
    emp = get_pre2fa_employee(_creds(create_pre2fa_token(eid)))
    assert emp["id"] == eid
    # un token d'accès normal est refusé sur cette dépendance
    with pytest.raises(HTTPException):
        get_pre2fa_employee(_creds(create_access_token(eid, "alex", "tech")))
