"""Accès SQLite : comptes employés, refresh tokens, verrouillage anti-bruteforce."""
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS employees (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hr_employee_id  INTEGER UNIQUE NOT NULL,   -- id du hr.employee dans Odoo
    login           TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'tech', -- tech | manager | admin
    pin_hash        TEXT NOT NULL,
    active          INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until    TEXT,                       -- ISO8601 ou NULL
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
    jti         TEXT PRIMARY KEY,
    employee_id INTEGER NOT NULL,
    expires_at  TEXT NOT NULL,
    revoked     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    FOREIGN KEY (employee_id) REFERENCES employees(id)
);

CREATE TABLE IF NOT EXISTS notifications (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    hr_employee_id  INTEGER NOT NULL,
    type            TEXT NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    dedup_key       TEXT,
    occurred_at     TEXT,
    created_at      TEXT NOT NULL,
    read_at         TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notif_dedup ON notifications(hr_employee_id, dedup_key);
CREATE INDEX IF NOT EXISTS idx_notif_emp ON notifications(hr_employee_id);

CREATE TABLE IF NOT EXISTS notif_state (
    hr_employee_id  INTEGER PRIMARY KEY,
    last_poll       TEXT,
    prefs           TEXT
);

CREATE TABLE IF NOT EXISTS announcement (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    text        TEXT,
    author      TEXT,
    updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS trusted_devices (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    token_hash  TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    user_agent  TEXT,
    created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trusted_emp ON trusted_devices(employee_id);

CREATE TABLE IF NOT EXISTS email_otps (
    employee_id INTEGER PRIMARY KEY,
    code_hash   TEXT NOT NULL,
    expires_at  TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
);
"""


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        # Colonnes 2FA ajoutées aux installations existantes (ALTER idempotent).
        for ddl in (
            "ALTER TABLE employees ADD COLUMN twofa_method TEXT",
            "ALTER TABLE employees ADD COLUMN twofa_secret_encrypted TEXT",
            "ALTER TABLE employees ADD COLUMN twofa_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE employees ADD COLUMN company_id INTEGER",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass  # colonne déjà présente


@contextmanager
def get_conn():
    conn = sqlite3.connect(settings.db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# --- Employés --------------------------------------------------------------

def get_employee_by_login(login: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM employees WHERE login = ? AND active = 1", (login,)
        ).fetchone()


def get_employee_by_id(emp_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM employees WHERE id = ? AND active = 1", (emp_id,)
        ).fetchone()


def upsert_employee(
    hr_employee_id: int,
    login: str,
    name: str,
    role: str,
    pin_hash: str,
    company_id: int | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO employees (hr_employee_id, login, name, role, pin_hash, company_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(hr_employee_id) DO UPDATE SET
                login=excluded.login, name=excluded.name,
                role=excluded.role, pin_hash=excluded.pin_hash,
                company_id=excluded.company_id
            """,
            (hr_employee_id, login, name, role, pin_hash, company_id, _utcnow_iso()),
        )


def update_pin(emp_id: int, pin_hash: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE employees SET pin_hash = ? WHERE id = ?", (pin_hash, emp_id))


# --- Notifications ---------------------------------------------------------

def get_notif_state(hr_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM notif_state WHERE hr_employee_id = ?", (hr_id,)).fetchone()


def set_notif_cursor(hr_id: int, ts: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO notif_state (hr_employee_id, last_poll) VALUES (?, ?) "
            "ON CONFLICT(hr_employee_id) DO UPDATE SET last_poll = excluded.last_poll", (hr_id, ts))


def set_notif_prefs(hr_id: int, prefs_json: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO notif_state (hr_employee_id, prefs) VALUES (?, ?) "
            "ON CONFLICT(hr_employee_id) DO UPDATE SET prefs = excluded.prefs", (hr_id, prefs_json))


def insert_notification(hr_id: int, type_: str, title: str, body: str, dedup_key: str, occurred_at: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO notifications (hr_employee_id, type, title, body, dedup_key, occurred_at, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)", (hr_id, type_, title, body, dedup_key, occurred_at, _utcnow_iso()))


def list_notifications(hr_id: int, limit: int = 40) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, type, title, body, occurred_at, read_at FROM notifications "
            "WHERE hr_employee_id = ? ORDER BY id DESC LIMIT ?", (hr_id, limit)).fetchall()
        return [dict(r) for r in rows]


def count_unread(hr_id: int) -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM notifications WHERE hr_employee_id = ? AND read_at IS NULL", (hr_id,)).fetchone()[0]


def get_announcement() -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT text, author, updated_at FROM announcement WHERE id = 1").fetchone()


def set_announcement(text: str, author: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO announcement (id, text, author, updated_at) VALUES (1, ?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET text = excluded.text, author = excluded.author, updated_at = excluded.updated_at",
            (text, author, _utcnow_iso()))


def mark_all_read(hr_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE notifications SET read_at = ? WHERE hr_employee_id = ? AND read_at IS NULL",
                     (_utcnow_iso(), hr_id))


def register_failed_attempt(emp_id: int, locked_until_iso: str | None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE employees SET failed_attempts = failed_attempts + 1, locked_until = ? WHERE id = ?",
            (locked_until_iso, emp_id),
        )


def reset_failed_attempts(emp_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE employees SET failed_attempts = 0, locked_until = NULL WHERE id = ?",
            (emp_id,),
        )


# --- Refresh tokens --------------------------------------------------------

def store_refresh_token(jti: str, employee_id: int, expires_at_iso: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO refresh_tokens (jti, employee_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (jti, employee_id, expires_at_iso, _utcnow_iso()),
        )


def get_refresh_token(jti: str) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM refresh_tokens WHERE jti = ?", (jti,)).fetchone()


def revoke_refresh_token(jti: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE refresh_tokens SET revoked = 1 WHERE jti = ?", (jti,))


def revoke_all_for_employee(employee_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE refresh_tokens SET revoked = 1 WHERE employee_id = ?", (employee_id,))


# --- 2FA : Authentification multi-facteurs ------------------------------------

def set_twofa(emp_id: int, method: str, secret_encrypted: str | None) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE employees SET twofa_method = ?, twofa_secret_encrypted = ?, twofa_enabled = 1 WHERE id = ?",
            (method, secret_encrypted, emp_id))


def stage_twofa_secret(emp_id: int, secret_encrypted: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE employees SET twofa_secret_encrypted = ?, twofa_enabled = 0 WHERE id = ?",
                     (secret_encrypted, emp_id))


def reset_twofa(emp_id: int) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE employees SET twofa_method = NULL, twofa_secret_encrypted = NULL, twofa_enabled = 0 WHERE id = ?",
            (emp_id,))


# --- Appareils de confiance ---

def add_trusted_device(employee_id: int, token_hash: str, expires_at_iso: str, user_agent: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO trusted_devices (employee_id, token_hash, expires_at, user_agent, created_at) "
            "VALUES (?, ?, ?, ?, ?)", (employee_id, token_hash, expires_at_iso, user_agent, _utcnow_iso()))


def is_device_trusted(employee_id: int, token_hash: str, now_iso: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM trusted_devices WHERE employee_id = ? AND token_hash = ? AND expires_at > ? LIMIT 1",
            (employee_id, token_hash, now_iso)).fetchone()
        return row is not None


def revoke_trusted_devices(employee_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM trusted_devices WHERE employee_id = ?", (employee_id,))


# --- Codes OTP email ---

def create_email_otp(employee_id: int, code_hash: str, expires_at_iso: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO email_otps (employee_id, code_hash, expires_at, attempts, created_at) "
            "VALUES (?, ?, ?, 0, ?) "
            "ON CONFLICT(employee_id) DO UPDATE SET code_hash=excluded.code_hash, "
            "expires_at=excluded.expires_at, attempts=0, created_at=excluded.created_at",
            (employee_id, code_hash, expires_at_iso, _utcnow_iso()))


def get_email_otp(employee_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute("SELECT * FROM email_otps WHERE employee_id = ?", (employee_id,)).fetchone()


def bump_email_otp_attempts(employee_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE email_otps SET attempts = attempts + 1 WHERE employee_id = ?", (employee_id,))


def delete_email_otp(employee_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM email_otps WHERE employee_id = ?", (employee_id,))


def count_recent_email_otps(employee_id: int, since_iso: str) -> int:
    with get_conn() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM email_otps WHERE employee_id = ? AND created_at >= ?",
            (employee_id, since_iso)).fetchone()[0]
