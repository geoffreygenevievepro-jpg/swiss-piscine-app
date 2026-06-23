# App Équipe Swiss Piscine

PWA mobile pour les équipes terrain Swiss Piscine, connectée à Odoo.
Deux volets : **RH** (timbrage, congés, fiches de salaire) et **Terrain** (planning,
interventions, rapports). Voir le cadrage complet : [`docs/scope.md`](docs/scope.md).

## Architecture

- **`backend/`** — API REST **FastAPI** (Python). Auth maison (login + PIN, JWT),
  comptes en SQLite, parle à Odoo via `odoo_client.py` (clé API côté serveur).
- **`frontend/`** — PWA **sans build** (JavaScript vanilla, ES modules). Servie en
  fichiers statiques. Shell à 4 onglets : Terrain · Pointer · Moi · Semaine.

## Lancer en local (dev)

**1. Backend** (port 8000) — depuis `app-terrain/backend/` :
```bash
python seed_employees.py        # crée les comptes employés depuis Odoo (1re fois)
python -m uvicorn app.main:app --reload --port 8000
```

**2. Frontend** (port 8080) — depuis `app-terrain/frontend/` :
```bash
python -m http.server 8080
```
Ouvrir http://localhost:8080 et se connecter avec un login/PIN affiché par le seed.

> Le front détecte `localhost` et tape l'API sur `http://localhost:8000`.
> En production, l'API est servie sous `/api` (même domaine, via nginx).

## État

- [x] **Sprint 0 — Fondations** : shell PWA, auth login/PIN + JWT, `/me` relié à Odoo.
- [ ] Sprint 1 — Pointer (`hr.attendance`) + Ma journée (`project.task`).
- [ ] Sprint 2 — Rapport d'intervention (photos, signature, offline).
- [ ] Sprint 3 — Moi : soldes, congés, fiches de salaire.
- [ ] Sprint 4 — Semaine + push + durcissement offline.
