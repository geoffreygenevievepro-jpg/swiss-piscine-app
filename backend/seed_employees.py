"""Seed des comptes employés dans SQLite à partir de hr.employee (Odoo company 5).

Usage :
    python seed_employees.py            # crée les comptes manquants (PIN aléatoire)
    python seed_employees.py --reset    # régénère TOUS les comptes (nouveaux PIN)
    python seed_employees.py --pin 0000 # impose un même PIN à tous (dev uniquement)

À lancer depuis app-terrain/backend/. Affiche un tableau login / PIN à distribuer
à l'équipe. Les logins sont éditables ensuite directement en base si besoin.
"""
import argparse
import secrets
import sqlite3
import unicodedata

from app import db, odoo
from app.security import hash_pin


def slugify(text: str) -> str:
    norm = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return "".join(c for c in norm.lower() if c.isalnum())


def make_login(name: str, used: set[str]) -> str:
    """Login = dernier mot du nom (souvent le prénom ici), dédupliqué."""
    parts = [p for p in name.split() if p]
    base = slugify(parts[-1]) if parts else "user"
    login = base
    # Collision : on préfixe par l'initiale du premier mot (ex. robertoa / robertop).
    if login in used and len(parts) > 1:
        login = base + slugify(parts[0])[:1]
    suffix = 2
    while login in used:
        login = f"{base}{suffix}"
        suffix += 1
    used.add(login)
    return login


def role_for(job_title: str | None) -> str:
    jt = (job_title or "").lower()
    if "direction" in jt or "responsable" in jt:
        return "manager"
    if "commerce" in jt or "administ" in jt:
        return "office"
    return "tech"


def existing_hr_ids() -> set[int]:
    with db.get_conn() as conn:
        rows = conn.execute("SELECT hr_employee_id FROM employees").fetchall()
    return {r["hr_employee_id"] for r in rows}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="régénère tous les comptes")
    ap.add_argument("--pin", help="PIN imposé commun (dev uniquement)")
    args = ap.parse_args()

    db.init_db()
    employees = odoo.list_employees()
    if not employees:
        print("Aucun employé trouvé pour company_id=5.")
        return

    already = set() if args.reset else existing_hr_ids()
    used_logins: set[str] = set()
    if not args.reset:
        with db.get_conn() as conn:
            used_logins = {r["login"] for r in conn.execute("SELECT login FROM employees")}

    created = []
    skipped = []
    for emp in employees:
        hr_id = emp["id"]
        if hr_id in already:
            skipped.append(emp["name"])
            continue
        login = make_login(emp["name"], used_logins)
        pin = args.pin or f"{secrets.randbelow(900000) + 100000}"  # 6 chiffres
        role = role_for(emp.get("job_title"))
        db.upsert_employee(hr_id, login, emp["name"], role, hash_pin(pin))
        created.append((emp["name"], login, pin, role))

    print("\n=== Comptes créés ===")
    if created:
        print(f'{"Employé":<24}{"Login":<14}{"PIN":<8}{"Rôle"}')
        print("-" * 54)
        for name, login, pin, role in created:
            print(f"{name:<24}{login:<14}{pin:<8}{role}")
    else:
        print("(aucun)")
    if skipped:
        print(f"\nIgnorés (déjà existants) : {', '.join(skipped)}")
    print("\nÀ distribuer à l'équipe. Relancer avec --reset pour régénérer les PIN.")


if __name__ == "__main__":
    main()
