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
"""


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(SCHEMA)


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


def upsert_employee(hr_employee_id: int, login: str, name: str, role: str, pin_hash: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO employees (hr_employee_id, login, name, role, pin_hash, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(hr_employee_id) DO UPDATE SET
                login=excluded.login, name=excluded.name,
                role=excluded.role, pin_hash=excluded.pin_hash
            """,
            (hr_employee_id, login, name, role, pin_hash, _utcnow_iso()),
        )


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
