# Bandeau d'anniversaire — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un bandeau festif sur l'accueil le jour de l'anniversaire d'un employé SP — « Joyeux anniversaire [Prénom] ! » pour la personne, « Aujourd'hui, [Prénom] fête son anniversaire » pour les autres.

**Architecture:** Nouveau router backend `birthdays.py` (`GET /birthdays/today`) qui réutilise les helpers EXISTANTS `odoo.list_employees()` + `odoo.get_client()` sans modifier `odoo.py`. La logique de correspondance de date est une fonction pure testable. Frontend : `accueil.js` charge l'endpoint et rend un bandeau ; nouvelle icône SVG `i-gift`.

**Tech Stack:** Backend FastAPI + pytest (`backend/.venv/bin/python -m pytest`, mock Odoo via `monkeypatch`). Frontend PWA vanilla JS (`node --check`). `zoneinfo` (stdlib) pour Europe/Zurich.

## Global Constraints

- Branche unique : `wip/v2-sprint-elie`.
- **NE PAS modifier `backend/app/odoo.py` ni `backend/app/config.py`** (zone de la session `feat/multi-company`). Le nouveau router lit Odoo via `odoo.get_client()` / `odoo.list_employees()` (helpers existants, non modifiés).
- **Vie privée** : la sortie ne contient NI année de naissance NI âge. Champs autorisés : `employee_id`, `first_name`, `is_me`.
- « Aujourd'hui » = date courante en `Europe/Zurich`. Le 29/02 est célébré le 28/02 les années non bissextiles.
- **Prénom = dernier token du nom complet** (`name.split()[-1]`), pour être cohérent avec `accueil.js` (`me.name.split(" ").slice(-1)[0]`).
- Tests backend : `cd backend && .venv/bin/python -m pytest` (les tests existants restent verts).
- Frontend : `node --check` sur le JS modifié ; bumper `frontend/sw.js` (`sp-app-shell-v48` → `v49`).
- Push : `git push "https://x-access-token:$(gh auth token --user SwissPiscine)@github.com/geoffreygenevievepro-jpg/swiss-piscine-app.git" wip/v2-sprint-elie:wip/v2-sprint-elie`.

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `backend/app/routers/birthdays.py` | Fonctions pures de matching + endpoint `GET /birthdays/today` | Créer |
| `backend/app/main.py` | Enregistrer le router (import + include_router) | Modifier |
| `backend/tests/test_birthdays.py` | Tests des fonctions pures + endpoint | Créer |
| `frontend/js/icons.js` | Ajouter le symbole SVG `i-gift` | Modifier |
| `frontend/js/screens/accueil.js` | Charger `/birthdays/today` + `birthdayBanner()` en tête du dashboard | Modifier |
| `frontend/css/app.css` | Styles `.bday-*` (carte festive) | Modifier |
| `frontend/sw.js` | Bump version cache | Modifier |

---

## Task 1: Backend — endpoint `GET /birthdays/today`

**Files:**
- Create: `backend/app/routers/birthdays.py`
- Modify: `backend/app/main.py:9-10` (import) et zone `include_router` (~ligne 47)
- Test: `backend/tests/test_birthdays.py` (créer)

**Interfaces:**
- Consumes: `odoo.list_employees() -> list[dict]` (items `{"id": int, "name": str}`) ; `odoo.get_client()` (client XML-RPC avec `.execute_kw(model, method, args, kw)`). Tous deux EXISTANTS, non modifiés.
- Consumes: `get_current_employee` (dépendance FastAPI) → dict avec clé `"hr_employee_id"`.
- Produces: `match_birthdays(emps, by_id, today, me_id) -> list[dict]` (items `{"employee_id": int, "first_name": str, "is_me": bool}`). Fonction pure.
- Produces: route `GET /birthdays/today` → même liste.

- [ ] **Step 1: Écrire les tests (échouent)**

Créer `backend/tests/test_birthdays.py` :

```python
from datetime import date
from unittest.mock import MagicMock

from fastapi.testclient import TestClient
import app.routers.birthdays as bd
import app.odoo as odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


# --- Fonctions pures -------------------------------------------------------
def test_match_birthdays_today_and_is_me():
    emps = [{"id": 1, "name": "Niyongira Fanny"}, {"id": 2, "name": "Roberto Da Silva"}]
    by_id = {1: "1990-06-27", 2: "1985-01-03"}
    out = bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=2)
    assert out == [{"employee_id": 1, "first_name": "Fanny", "is_me": False}]


def test_match_birthdays_marks_me():
    emps = [{"id": 2, "name": "Roberto Da Silva"}]
    by_id = {2: "1985-06-27"}
    out = bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=2)
    assert out == [{"employee_id": 2, "first_name": "Silva", "is_me": True}]


def test_match_birthdays_ignores_empty_and_other_days():
    emps = [{"id": 1, "name": "A B"}, {"id": 2, "name": "C D"}, {"id": 3, "name": "E F"}]
    by_id = {1: False, 2: "1990-12-01", 3: None}
    assert bd.match_birthdays(emps, by_id, date(2026, 6, 27), me_id=9) == []


def test_match_birthdays_feb29_on_feb28_non_leap():
    emps = [{"id": 1, "name": "Jean Test"}]
    by_id = {1: "1992-02-29"}
    # 2027 n'est pas bissextile → célébré le 28/02
    assert bd.match_birthdays(emps, by_id, date(2027, 2, 28), me_id=9)[0]["employee_id"] == 1
    # une année bissextile, le 28/02 ne déclenche PAS le 29/02
    assert bd.match_birthdays(emps, by_id, date(2028, 2, 28), me_id=9) == []
    assert bd.match_birthdays(emps, by_id, date(2028, 2, 29), me_id=9)[0]["employee_id"] == 1


# --- Endpoint --------------------------------------------------------------
def test_birthdays_today_endpoint(monkeypatch):
    monkeypatch.setattr(odoo, "list_employees", lambda: [{"id": 1, "name": "Niyongira Fanny"}])
    cli = MagicMock()
    cli.execute_kw.return_value = [{"id": 1, "name": "Niyongira Fanny", "birthday": "1990-06-27"}]
    monkeypatch.setattr(odoo, "get_client", lambda: cli)
    monkeypatch.setattr(bd, "_today_zurich", lambda: date(2026, 6, 27))
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 1, "name": "Niyongira Fanny"}
    r = client.get("/birthdays/today")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == [{"employee_id": 1, "first_name": "Fanny", "is_me": True}]


def test_birthdays_today_empty(monkeypatch):
    monkeypatch.setattr(odoo, "list_employees", lambda: [{"id": 1, "name": "Niyongira Fanny"}])
    cli = MagicMock()
    cli.execute_kw.return_value = [{"id": 1, "name": "Niyongira Fanny", "birthday": "1990-01-01"}]
    monkeypatch.setattr(odoo, "get_client", lambda: cli)
    monkeypatch.setattr(bd, "_today_zurich", lambda: date(2026, 6, 27))
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 1, "name": "X"}
    r = client.get("/birthdays/today")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == []
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_birthdays.py -v`
Expected: FAIL (`ModuleNotFoundError: app.routers.birthdays`).

- [ ] **Step 3: Créer le router**

Créer `backend/app/routers/birthdays.py` :

```python
"""Anniversaires du jour (hr.employee.birthday, company 5) pour le bandeau d'accueil.

Lit Odoo via les helpers existants (odoo.list_employees / odoo.get_client) sans
modifier odoo.py. Ne renvoie ni l'année ni l'âge (vie privée)."""
from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from .. import odoo
from ..deps import get_current_employee

router = APIRouter(prefix="/birthdays", tags=["birthdays"])


def _today_zurich() -> date:
    return datetime.now(ZoneInfo("Europe/Zurich")).date()


def _is_leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


def _parse_birthday(val) -> date | None:
    if not val or not isinstance(val, str):
        return None
    try:
        return date.fromisoformat(val[:10])
    except ValueError:
        return None


def _is_birthday(bd: date, today: date) -> bool:
    if (bd.month, bd.day) == (today.month, today.day):
        return True
    # 29 février célébré le 28 février les années non bissextiles.
    if bd.month == 2 and bd.day == 29 and today.month == 2 and today.day == 28 and not _is_leap(today.year):
        return True
    return False


def _first_name(name: str) -> str:
    parts = (name or "").split()
    return parts[-1] if parts else (name or "")


def match_birthdays(emps: list[dict], by_id: dict, today: date, me_id: int) -> list[dict]:
    out = []
    for e in emps:
        bday = _parse_birthday(by_id.get(e["id"]))
        if bday and _is_birthday(bday, today):
            out.append({"employee_id": e["id"], "first_name": _first_name(e.get("name", "")),
                        "is_me": e["id"] == me_id})
    return out


@router.get("/today")
def today(emp=Depends(get_current_employee)):
    emps = odoo.list_employees()
    ids = [e["id"] for e in emps]
    by_id = {}
    if ids:
        rows = odoo.get_client().execute_kw(
            "hr.employee", "read", [ids], {"fields": ["name", "birthday"]})
        by_id = {r["id"]: r.get("birthday") for r in rows}
    return match_birthdays(emps, by_id, _today_zurich(), emp["hr_employee_id"])
```

- [ ] **Step 4: Enregistrer le router dans `main.py`**

Dans `backend/app/main.py`, ajouter `birthdays` à l'import (ligne 9-10) :

```python
from .routers import (admin, announcement, attendance, auth, birthdays, documents, expenses,
                      interventions, manager, me, notifications, rh, twofa, week)
```

Et ajouter la ligne d'enregistrement (avec les autres `include_router`, ~ligne 47) :

```python
app.include_router(birthdays.router)
```

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `cd backend && .venv/bin/python -m pytest tests/test_birthdays.py -v`
Expected: PASS (6 tests).

- [ ] **Step 6: Non-régression**

Run: `cd backend && .venv/bin/python -m pytest`
Expected: tous verts.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/birthdays.py backend/app/main.py backend/tests/test_birthdays.py
git commit -m "feat(api): GET /birthdays/today (anniversaires du jour, sans annee/age)"
```

---

## Task 2: Frontend — icône cadeau + bandeau accueil

**Files:**
- Modify: `frontend/js/icons.js` (symbole `i-gift`)
- Modify: `frontend/js/screens/accueil.js` (chargement + `birthdayBanner`)
- Modify: `frontend/css/app.css` (styles `.bday-*`)
- Modify: `frontend/sw.js` (bump v48 → v49)

**Interfaces:**
- Consumes: `GET /birthdays/today` (Task 1) → `[{employee_id, first_name, is_me}]`.
- Consumes: helper `icon("gift")` (utilise `#i-gift`).

- [ ] **Step 1: Ajouter l'icône `i-gift`**

Dans `frontend/js/icons.js`, ajouter une ligne `<symbol>` dans `ICON_SPRITE` (juste après la ligne du symbole `i-leaf`) :

```javascript
<symbol id="i-gift" viewBox="0 0 24 24"><rect x="4" y="9.5" width="16" height="11" rx="1.5"/><path d="M3 9.5h18v3.5H3zM12 9.5v11"/><path d="M12 9.5C10.5 6.5 6.5 6.5 6.5 8.5S9 9.5 12 9.5zM12 9.5C13.5 6.5 17.5 6.5 17.5 8.5S15 9.5 12 9.5z"/></symbol>
```

- [ ] **Step 2: Vérifier la syntaxe de icons.js**

Run: `cd frontend && node --check js/icons.js`
Expected: pas d'erreur.

- [ ] **Step 3: Charger `/birthdays/today` dans le render de l'accueil**

Dans `frontend/js/screens/accueil.js`, fonction `render`, ajouter l'appel au `Promise.all`. Remplacer le bloc destructuré existant :

```javascript
    let overview, balances, planning, leaves, team, holidays, status, ann;
    try {
      [overview, balances, planning, leaves, team, holidays, status, ann] = await Promise.all([
        api("/attendance/overview"),
        api("/rh/balances"),
        api("/week/upcoming?days=5"),
        api("/rh/leaves"),
        api("/week/team?offset=0"),
        api("/week/holidays").catch(() => []),
        api("/attendance/status").catch(() => ({ state: "out" })),
        api("/announcement").catch(() => ({})),
      ]);
    } catch {
```

par :

```javascript
    let overview, balances, planning, leaves, team, holidays, status, ann, bdays;
    try {
      [overview, balances, planning, leaves, team, holidays, status, ann, bdays] = await Promise.all([
        api("/attendance/overview"),
        api("/rh/balances"),
        api("/week/upcoming?days=5"),
        api("/rh/leaves"),
        api("/week/team?offset=0"),
        api("/week/holidays").catch(() => []),
        api("/attendance/status").catch(() => ({ state: "out" })),
        api("/announcement").catch(() => ({})),
        api("/birthdays/today").catch(() => []),
      ]);
    } catch {
```

- [ ] **Step 4: Rendre le bandeau en tête du dashboard**

Toujours dans `render`, remplacer l'assemblage du `dash.innerHTML` :

```javascript
    dash.innerHTML =
      messageBanner(ann, false) +
      meteoCard() +
```

par (ajoute `birthdayBanner(bdays)` en première position) :

```javascript
    dash.innerHTML =
      birthdayBanner(bdays) +
      messageBanner(ann, false) +
      meteoCard() +
```

- [ ] **Step 5: Ajouter la fonction `birthdayBanner`**

Dans `frontend/js/screens/accueil.js`, ajouter cette fonction (par ex. juste avant `function meteoCard()`) :

```javascript
// --- Bandeau anniversaire ----------------------------------------------------
function birthdayBanner(list) {
  if (!Array.isArray(list) || !list.length) return "";
  const me = list.find(b => b.is_me);
  const others = list.filter(b => !b.is_me);
  const lines = [];
  if (me) lines.push(`<div class="bday-line"><strong>Joyeux anniversaire ${escapeHtml(me.first_name)} !</strong></div>`);
  others.forEach(o => lines.push(`<div class="bday-line">Aujourd'hui, <strong>${escapeHtml(o.first_name)}</strong> fête son anniversaire</div>`));
  return `<div class="card bday-card">
    <span class="bday-ic">${icon("gift")}</span>
    <div class="bday-body">${lines.join("")}</div>
  </div>`;
}
```

- [ ] **Step 6: Ajouter les styles `.bday-*`**

Dans `frontend/css/app.css`, ajouter (par ex. à la suite des styles `.vac-*`) :

```css
/* Bandeau anniversaire (dégradé festif). */
.bday-card { display: flex; align-items: center; gap: 14px; border: 0; background: linear-gradient(135deg, #7C4DFF, #FF5FA2); color: #fff; }
.bday-ic { width: 46px; height: 46px; border-radius: 13px; background: rgba(255,255,255,.22); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
.bday-body { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.bday-line { font-size: .98rem; }
.bday-card strong { font-weight: 700; }
```

- [ ] **Step 7: Bump du service worker**

Dans `frontend/sw.js`, remplacer `const CACHE = "sp-app-shell-v48";` par `const CACHE = "sp-app-shell-v49";`.

- [ ] **Step 8: Vérifier la syntaxe**

Run: `cd frontend && for f in js/icons.js js/screens/accueil.js sw.js; do node --check "$f" && echo "OK $f"; done`
Expected: `OK` pour chaque fichier.

- [ ] **Step 9: Commit**

```bash
git add frontend/js/icons.js frontend/js/screens/accueil.js frontend/css/app.css frontend/sw.js
git commit -m "feat(accueil): bandeau anniversaire (icone cadeau, message soi/collegue) (SW v49)"
```

---

## Task 3: Déploiement + vérification

**Files:** aucun (déploiement).

- [ ] **Step 1: Non-régression complète**

Run: `cd backend && .venv/bin/python -m pytest` puis `cd ../frontend && for f in js/icons.js js/screens/accueil.js sw.js; do node --check "$f"; done; echo done`
Expected: pytest vert, `done` sans erreur.

- [ ] **Step 2: Push**

```bash
git push "https://x-access-token:$(gh auth token --user SwissPiscine)@github.com/geoffreygenevievepro-jpg/swiss-piscine-app.git" wip/v2-sprint-elie:wip/v2-sprint-elie
```

- [ ] **Step 3: Déployer le backend (nouveau router)**

```bash
rsync -avz --exclude '.DS_Store' --exclude '__pycache__' --exclude '.venv' \
  --exclude 'data' --exclude '.env' --exclude '.secret_key' \
  backend/app/ alexandre@84.234.20.167:/var/www/swiss-piscine-app/backend/app/
ssh alexandre@84.234.20.167 "sudo systemctl restart swiss-piscine-app"
```

- [ ] **Step 4: Déployer le frontend**

```bash
rsync -avz --exclude '.DS_Store' frontend/ alexandre@84.234.20.167:/var/www/swiss-piscine-app/frontend/
```

- [ ] **Step 5: Vérifier en prod**

```bash
curl -s https://app.swiss-piscine.ch/sw.js | grep -m1 sp-app-shell        # → v49
curl -s -H "Authorization: Bearer <token>" https://app.swiss-piscine.ch/api/birthdays/today  # → 200 + JSON (liste)
curl -s https://app.swiss-piscine.ch/css/app.css | grep -m1 bday-card     # → règle présente
```

Expected: SW v49, `/api/birthdays/today` répond 200 (liste, vide si aucun anniversaire aujourd'hui), CSS `.bday-card` présent.

- [ ] **Step 6: Test manuel**

Dans Odoo (compte admin), mettre temporairement la date de naissance d'un employé SP de test à aujourd'hui (jour+mois). Ouvrir https://app.swiss-piscine.ch connecté en tant que cet employé → vérifier « Joyeux anniversaire [Prénom] ! ». Se connecter avec un autre employé → vérifier « Aujourd'hui, [Prénom] fête son anniversaire ». Restaurer la date d'origine.

---

## Self-Review (couverture spec)

- `GET /birthdays/today`, sans toucher odoo.py → Task 1 ✅
- Réutilise `list_employees` + `get_client` → Task 1 step 3 ✅
- Vie privée (pas d'année/âge ; sortie = employee_id/first_name/is_me) → Task 1 (sortie) + test `test_match_birthdays_*` ✅
- Jour J Europe/Zurich + 29/02→28/02 non bissextile → `_today_zurich` / `_is_birthday` + test feb29 ✅
- Prénom = dernier token → `_first_name` + tests ✅
- Bandeau en tête, message soi vs collègue, plusieurs le même jour → Task 2 steps 4-5 ✅
- Dégradation propre (`/birthdays/today` 404/échec → `.catch(()=>[])` → pas de bandeau) → Task 2 step 3 ✅
- Icône SVG (zéro émoji) → Task 2 step 1 ✅
- Bump SW → Task 2 step 7 ✅
- Enregistrement main.py (pas odoo.py/config.py) → Task 1 step 4 ✅
- Hors périmètre (à venir / souhaiter / cloche / dismiss / âge) → respecté ✅
