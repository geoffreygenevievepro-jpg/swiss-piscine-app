import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field

from .. import db, odoo, twofa
from ..config import settings
from ..deps import get_pre2fa_employee
from ..security import create_access_token, create_refresh_token

router = APIRouter(prefix="/2fa", tags=["2fa"])
TRUST_DAYS = 30
COOKIE = "sp_trust"

def _now(): return datetime.now(timezone.utc)

class CodeBody(BaseModel):
    code: str = Field(..., min_length=4, max_length=8)
    trust_device: bool = False

def _can_email(emp) -> bool:
    try:
        return bool((odoo.get_employee(emp["hr_employee_id"]) or {}).get("work_email"))
    except Exception:
        return False

def _issue(emp, response: Response, trust_device: bool):
    access = create_access_token(emp["id"], emp["login"], emp["role"])
    refresh, jti, exp = create_refresh_token(emp["id"])
    db.store_refresh_token(jti, emp["id"], exp.isoformat())
    if trust_device:
        token = twofa.new_device_token()
        db.add_trusted_device(emp["id"], twofa.hash_token(token),
                              (_now() + timedelta(days=TRUST_DAYS)).isoformat(), "")
        response.set_cookie(COOKIE, token, max_age=TRUST_DAYS * 86400,
                            httponly=True, secure=True, samesite="lax")
    return {"access_token": access, "refresh_token": refresh,
            "expires_in": settings.access_token_ttl_min * 60}

@router.get("/status")
def status_(emp=Depends(get_pre2fa_employee)):
    return {"enabled": bool(emp["twofa_enabled"]), "method": emp["twofa_method"], "can_email": _can_email(emp)}

@router.post("/setup/totp/start")
def totp_start(emp=Depends(get_pre2fa_employee)):
    secret = twofa.new_secret()
    db.stage_twofa_secret(emp["id"], twofa.encrypt(secret))
    return {"secret": secret, "otpauth_uri": twofa.provisioning_uri(secret, emp["login"])}

@router.post("/setup/totp/confirm")
def totp_confirm(body: CodeBody, response: Response, emp=Depends(get_pre2fa_employee)):
    # I1 — vérification du verrouillage anti-bruteforce
    if emp["locked_until"]:
        if datetime.fromisoformat(emp["locked_until"]) > _now():
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais, réessaie plus tard")
    # Re-fetch to get the staged secret (written by totp_start after dep was resolved).
    fresh = db.get_employee_by_id(emp["id"])
    enc = fresh["twofa_secret_encrypted"] if fresh else None
    if not enc or not twofa.verify_totp(twofa.decrypt(enc), body.code):
        attempts = emp["failed_attempts"] + 1
        locked_iso = None
        if attempts >= settings.max_failed_attempts:
            locked_iso = (_now() + timedelta(minutes=settings.lockout_minutes)).isoformat()
        db.register_failed_attempt(emp["id"], locked_iso)
        raise HTTPException(400, "Code invalide")
    db.reset_failed_attempts(emp["id"])
    db.set_twofa(emp["id"], "totp", enc)
    return _issue(emp, response, body.trust_device)

@router.post("/setup/email/start")
def email_start(emp=Depends(get_pre2fa_employee)):
    # M8 — throttle : refuser si un OTP a été créé il y a moins de 60 s
    existing = db.get_email_otp(emp["id"])
    if existing:
        created = datetime.fromisoformat(existing["created_at"])
        if (_now() - created).total_seconds() < 60:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Patiente avant de redemander un code")
    info = odoo.get_employee(emp["hr_employee_id"]) or {}
    to = info.get("work_email")
    if not to:
        raise HTTPException(400, "Aucune adresse email")
    code = twofa.generate_email_code()
    db.create_email_otp(emp["id"], twofa.hash_code(code), (_now() + timedelta(minutes=10)).isoformat())
    odoo.send_email(to, "Votre code de connexion", f"<p>Votre code : <b>{code}</b> (valable 10 min)</p>")
    return {"sent": True}

@router.post("/setup/email/confirm")
def email_confirm(body: CodeBody, response: Response, emp=Depends(get_pre2fa_employee)):
    # I1 — vérification du verrouillage anti-bruteforce
    if emp["locked_until"]:
        if datetime.fromisoformat(emp["locked_until"]) > _now():
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais, réessaie plus tard")
    if not _verify_email(emp["id"], body.code):
        attempts = emp["failed_attempts"] + 1
        locked_iso = None
        if attempts >= settings.max_failed_attempts:
            locked_iso = (_now() + timedelta(minutes=settings.lockout_minutes)).isoformat()
        db.register_failed_attempt(emp["id"], locked_iso)
        raise HTTPException(400, "Code invalide ou expiré")
    db.reset_failed_attempts(emp["id"])
    db.set_twofa(emp["id"], "email", None)
    return _issue(emp, response, body.trust_device)

@router.post("/verify")
def verify(body: CodeBody, response: Response, emp=Depends(get_pre2fa_employee)):
    # I1 — vérification du verrouillage anti-bruteforce
    if emp["locked_until"]:
        if datetime.fromisoformat(emp["locked_until"]) > _now():
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Trop d'essais, réessaie plus tard")
    if emp["twofa_method"] == "totp":
        enc = emp["twofa_secret_encrypted"]
        ok = bool(enc) and twofa.verify_totp(twofa.decrypt(enc), body.code)
    else:
        ok = _verify_email(emp["id"], body.code)
    if not ok:
        attempts = emp["failed_attempts"] + 1
        locked_iso = None
        if attempts >= settings.max_failed_attempts:
            locked_iso = (_now() + timedelta(minutes=settings.lockout_minutes)).isoformat()
        db.register_failed_attempt(emp["id"], locked_iso)
        raise HTTPException(400, "Code invalide ou expiré")
    db.reset_failed_attempts(emp["id"])
    return _issue(emp, response, body.trust_device)

@router.post("/email/resend")
def resend(emp=Depends(get_pre2fa_employee)):
    return email_start(emp)

def _verify_email(emp_id: int, code: str) -> bool:
    row = db.get_email_otp(emp_id)
    if not row:
        return False
    if datetime.fromisoformat(row["expires_at"]) < _now() or row["attempts"] >= 5:
        return False
    db.bump_email_otp_attempts(emp_id)
    if not hmac.compare_digest(twofa.hash_code(code), row["code_hash"]):
        return False
    db.delete_email_otp(emp_id)
    return True
