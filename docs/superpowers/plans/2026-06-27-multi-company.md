# App RH multi-société — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'app RH multi-société (aujourd'hui Swiss Piscine en dur) : la société vient de chaque employé (Odoo), onglets et thème s'adaptent — un seul code, un seul déploiement.

**Architecture:** On dé-câble `settings.company_id` (=5). La société d'un employé est résolue depuis Odoo (`employee_company_id(hr_id)`, déjà présent + caché) pour les helpers `odoo.py`, et stockée sur la ligne SQLite `employees` (au seed) pour le gate d'accès. `/me` renvoie un bloc `company` (id, nom, logo Odoo, couleur Supabase) ; le frontend applique le thème.

**Tech Stack:** Python 3.12, FastAPI, SQLite, Odoo JSON-RPC, Supabase (lecture), pytest ; frontend PWA vanilla JS.

## Global Constraints
- La société d'un employé = `hr.employee.company_id` (Odoo). `settings.company_id` ne reste qu'en **repli** (défaut SP=5).
- Helpers `odoo.py` scopés par société : résoudre via `employee_company_id(hr_id)` (caché) ; les helpers « société entière » (team/admin/list) reçoivent `company_id` en paramètre depuis le router (= société de l'employé courant).
- **Onglets par société** = déjà câblés (`app_rh_company_config.enabled_tabs` → `access_decision` → `navScreens`). Ne pas re-coder ; juste passer la **bonne** société à `access_decision`.
- **Thème** : logo+nom depuis Odoo `res.company` ; couleur depuis `app_rh_company_config.theme_color` (Supabase). `/me` → `company:{id,name,logo,color}`. Repli = look actuel.
- Features **SP-spécifiques** (Rapport « Je fais » → fiche/facture) restent SP-only (autres sociétés ne les activent pas) ; on les rend quand même company-aware (passent la société de l'employé) pour ne rien casser.
- Tests : `cd backend && .venv/bin/python -m pytest tests/ -q`. JS : `node --check`.
- Worktree isolé `~/swiss-piscine-multicompany` (branche `feat/multi-company`). **Pas de déploiement prod** dans ce plan (build+test local ; déploiement après fusion).
- Non-régression SP : avec sa config (onglets actuels, couleur `#0c5e68`), l'app SP est identique à aujourd'hui.

## File Structure
| Fichier | Responsabilité | Action |
|---|---|---|
| `backend/app/odoo.py` | Helpers Odoo : `_company_domain(company_id)`, helpers scopés société, `company_branding` | Modifier |
| `backend/app/db.py` | colonne `company_id` sur `employees` + helper | Modifier |
| `backend/seed_employees.py` | seed multi-société (`--companies`) + stocke `company_id` | Modifier |
| `backend/app/routers/me.py` | `/me` → bloc `company` + access_decision par société | Modifier |
| `backend/app/routers/auth.py` | access_decision par société (login) | Modifier |
| `backend/app/routers/week.py`, `admin.py`, `manager.py` | passer la société aux helpers « société entière » | Modifier |
| `frontend/js/store.js` | (profil déjà stocké — rien) | — |
| `frontend/js/theme.js` | applique le thème (couleurs CSS) — nouveau | Créer |
| `frontend/js/app.js` | en-tête (nom+logo société) + applique le thème au boot | Modifier |
| `backend/tests/test_multi_company.py` | tests société/branding/seed | Créer |
| Supabase `app_rh_company_config` | colonne `theme_color` + lignes par société | Migration (PAT) |

---

### Task 1 : `_company_domain(company_id)` + helpers scopés par employé

**Files:** Modify `backend/app/odoo.py` ; Test `backend/tests/test_multi_company.py`

**Interfaces:**
- Consumes: `employee_company_id(hr_id) -> int` (existant, odoo.py:746).
- Produces: `_company_domain(company_id: int) -> list` (signature **change** : prend la société).

**Pattern de transformation** (à appliquer) :
- `_company_domain()` → `_company_domain(company_id: int)` : `return [["company_id", "=", company_id]]`.
- Dans chaque helper qui **reçoit `hr_employee_id`** et appelle `_company_domain()` ou utilise `settings.company_id` : ajouter en tête `company_id = employee_company_id(hr_employee_id)` puis passer `company_id` (à `_company_domain(company_id)` ou au champ `company_id`/`employee_company_id` du domaine/des valeurs).

**Sites à modifier (helpers AVEC `hr_employee_id`)** — résoudre `company_id = employee_company_id(hr_employee_id)` et l'utiliser :
- `get_employee` (odoo.py:79), `today_interventions` (482), `intervention_detail` (495), `week_planning` (1289), `upcoming_planning` (1310), `submit_report` (1044), `poll_events` (1727), `client_history` (816), `slot_overlaps` (837).
- Écritures : `create_intervention` (641 — `company_id` du `planning.slot`), `create_expense` (1782 — `hr.expense`), `create_draft_invoice` (614 — `account.move`). Ces 3 prennent `hr_employee_id` → utiliser sa société au lieu de `settings.company_id`.

- [ ] **Step 1 : test (échoue)**
```python
# backend/tests/test_multi_company.py
from unittest.mock import MagicMock
import app.odoo as odoo

def test_company_domain_param():
    assert odoo._company_domain(7) == [["company_id", "=", 7]]

def test_week_planning_uses_employee_company(monkeypatch):
    captured = {}
    monkeypatch.setattr(odoo, "employee_company_id", lambda hr: 7)
    ro = MagicMock()
    def exec_kw(model, method, args, kw=None):
        captured["domain"] = args[0]
        return []
    ro.execute_kw.side_effect = exec_kw
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    odoo.week_planning(194, 0)
    # le domaine planning.slot doit contenir la société 7 (pas 5)
    flat = str(captured.get("domain"))
    assert '"company_id"' in flat.replace("'", '"') and "7" in flat
```

- [ ] **Step 2 : lancer (échoue)** — `cd backend && .venv/bin/python -m pytest tests/test_multi_company.py -q` → FAIL.

- [ ] **Step 3 : implémenter** — changer `_company_domain` (signature) puis, à chaque site listé ci-dessus, résoudre `company_id = employee_company_id(hr_employee_id)` et passer `company_id`. (Le fichier est lu par l'implémenteur ; appliquer le pattern partout. Pour `team_week`/`admin_*`/`list_employees` → **Task 2**, ne pas y toucher ici, mais comme `_company_domain` change de signature, leur appel temporairement cassé sera corrigé en Task 2 — donc **faire Task 1 et 2 ensemble avant de lancer la suite complète**, ou passer `settings.company_id` en repli provisoire aux sites Task 2.)

> Note d'implémentation : `_company_domain` n'a **aucun appelant sans hr_id sauf** les helpers « société entière » (Task 2). Pour garder le fichier importable entre Task 1 et 2, donner à `_company_domain` un **défaut** : `def _company_domain(company_id: int | None = None): return [["company_id", "=", company_id or settings.company_id]]`. Ainsi les sites non encore migrés (Task 2) restent valides (repli SP) jusqu'à leur migration.

- [ ] **Step 4 : lancer (passe)** — `pytest tests/test_multi_company.py -q` PASS + suite complète verte.

- [ ] **Step 5 : commit** — `git add backend/app/odoo.py backend/tests/test_multi_company.py && git commit -m "feat(multi): _company_domain(company_id) + helpers scopes par employe"`

---

### Task 2 : helpers « société entière » (équipe / admin / liste) — société en paramètre

**Files:** Modify `backend/app/odoo.py`, `backend/app/routers/week.py`, `backend/app/routers/admin.py`, `backend/app/routers/manager.py`, `backend/app/routers/me.py` ; Test `backend/tests/test_multi_company.py`

**Interfaces (signatures changées) :**
- `list_employees(company_id: int) -> list[dict]`
- `team_week(company_id: int, offset: int = 0) -> dict`
- `upcoming_holidays(company_id: int, ...) -> ...` (garder ses autres params)
- `admin_employees_hours(company_id: int) -> list[dict]`
- `admin_leaves(company_id: int) -> list[dict]`
- `pending_leaves(company_id: int, manager_hr_id: int | None = None) -> list[dict]`

Chaque helper utilise `company_id` (au lieu de `settings.company_id`/`_company_domain()` sans param). Les **routers** résolvent la société de l'employé courant : `company_id = emp["company_id"] or odoo.employee_company_id(emp["hr_employee_id"])` et la passent.

- [ ] **Step 1 : test** — pour un de ces helpers (ex. `team_week`), monkeypatch `get_client`, appeler `odoo.team_week(7)`, asserter que le domaine `planning.slot`/`hr.leave` contient la société 7. Et un test router (TestClient + override `get_current_employee` renvoyant `{"company_id":7,...}`) asserte que `/week/team` appelle `team_week` avec 7 (monkeypatch `odoo.team_week`).
- [ ] **Step 2 : lancer (échoue)**.
- [ ] **Step 3 : implémenter** — changer les signatures + corps (utiliser `company_id`), puis mettre à jour les call sites routers (`week.py` team/holidays, `admin.py`, `manager.py` pending_leaves, `me.py`/team si applicable) pour passer la société de l'employé courant.
- [ ] **Step 4 : lancer (passe)** + suite complète.
- [ ] **Step 5 : commit** — `git commit -m "feat(multi): helpers societe-entiere parametres par company_id + routers"`

---

### Task 3 : `company_id` sur SQLite `employees` + gate d'accès par société

**Files:** Modify `backend/app/db.py`, `backend/app/routers/me.py`, `backend/app/routers/auth.py` ; Test `backend/tests/test_multi_company.py`

**Interfaces:**
- `db.upsert_employee(hr_employee_id, login, name, role, pin_hash, company_id=None)` (ajout du param, colonne `company_id`).
- `/me` et `auth.login` : `access_decision(hr_id, emp["company_id"] or settings.company_id)`.

- [ ] **Step 1 : test** — migration ajoute `company_id` ; `upsert_employee(..., company_id=7)` → `get_employee_by_id` renvoie `company_id==7`. Test login : `access_decision` est appelé avec la société de l'employé (monkeypatch `supabase_access.access_decision`, asserter l'arg company).
- [ ] **Step 2 : lancer (échoue)**.
- [ ] **Step 3 : implémenter** :
  - `db.py` : `ALTER TABLE employees ADD COLUMN company_id INTEGER` (idempotent, même pattern que les colonnes 2FA) ; `upsert_employee` écrit `company_id`.
  - `me.py:36` : `access_decision(emp["hr_employee_id"], emp["company_id"] or settings.company_id)`.
  - `auth.py:83` : idem.
- [ ] **Step 4 : lancer (passe)** + suite.
- [ ] **Step 5 : commit** — `git commit -m "feat(multi): colonne company_id (employees) + gate d'acces par societe"`

---

### Task 4 : branding société (`res.company`) + `/me` bloc `company`

**Files:** Modify `backend/app/odoo.py` (helper), `backend/app/supabase_access.py` (lecture theme_color), `backend/app/routers/me.py` ; Test `backend/tests/test_multi_company.py`

**Interfaces:**
- `odoo.company_branding(company_id: int) -> dict` → `{"id":.., "name":.., "logo": "data:image/png;base64,..."|None}` (lit `res.company` name+logo ; best-effort).
- `supabase_access.company_theme_color(company_id: int) -> str | None` (lit `app_rh_company_config.theme_color`).
- `/me` ajoute `"company": {"id":.., "name":.., "logo":.., "color": <theme_color or "#0c5e68">}`.

- [ ] **Step 1 : test** — `company_branding` (mock odoo client renvoyant `[{"name":"Elie Paysage SA","logo":"<b64>"}]`) → dict avec name + logo en data URL ; sur exception → `{"id":cid,"name":None,"logo":None}`. `/me` (mocks) contient le bloc `company` avec la couleur de repli si Supabase n'a rien.
- [ ] **Step 2 : lancer (échoue)**.
- [ ] **Step 3 : implémenter** :
  - `odoo.company_branding` : `read res.company [name, logo]`, logo (b64 brut Odoo) → `"data:image/png;base64,"+logo` si présent ; try/except → None.
  - `supabase_access.company_theme_color` : GET `app_rh_company_config?company_id=eq.{cid}&select=theme_color` (réutilise `_get`), renvoie la valeur ou None.
  - `me.py` : `cid = emp["company_id"] or settings.company_id ; b = odoo.company_branding(cid) ; color = supabase_access.company_theme_color(cid) or "#0c5e68"` ; ajouter `"company": {**b, "color": color}`.
- [ ] **Step 4 : lancer (passe)** + suite.
- [ ] **Step 5 : commit** — `git commit -m "feat(multi): branding societe (res.company) + /me bloc company"`

---

### Task 5 : frontend — application du thème (couleur + nom + logo)

**Files:** Create `frontend/js/theme.js` ; Modify `frontend/js/app.js`

Pas de test unitaire JS → `node --check` + revue + smoke local.

- [ ] **Step 1 : créer `frontend/js/theme.js`**
```javascript
// Applique le thème de la société (couleur d'accent) via les variables CSS.
function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : null;
}
export function applyTheme(company) {
  const color = company && company.color;
  const r = document.documentElement;
  if (!color) { // repli : thème par défaut (ne rien forcer)
    r.style.removeProperty("--aqua-dark"); r.style.removeProperty("--aqua"); r.style.removeProperty("--aqua-soft");
    return;
  }
  r.style.setProperty("--aqua-dark", color);
  r.style.setProperty("--aqua", color);
  const rgb = hexToRgb(color);
  if (rgb) r.style.setProperty("--aqua-soft", `rgba(${rgb[0]},${rgb[1]},${rgb[2]},.12)`);
}
```

- [ ] **Step 2 : brancher dans `app.js`**
  - Importer : `import { applyTheme } from "./theme.js";`
  - Au boot (après `profile.set` / quand on monte l'app), appeler `applyTheme((profile.get()||{}).company)`. Mettre l'appel **au début de `mountApp`** : `applyTheme((profile.get()||{}).company);`
  - En-tête (`mountApp`, lignes ~76-77) : remplacer le bloc marque par le **logo + nom de la société** :
    ```javascript
    const co = (me && me.company) || {};
    const brand = co.logo
      ? `<img class="brand-logo" src="${co.logo}" alt="">`
      : `<span class="brand-mark">${icon("wave")}</span>`;
    const coName = co.name || "Espace équipe";
    ```
    et dans le template : `<div class="brand">${brand}<div><b>${coName.replace(/[&<>"']/g,"")}</b><span class="eyebrow">Espace équipe</span></div></div>`
  - CSS (app.css) : ajouter `.brand-logo { height: 30px; width: auto; border-radius: 7px; display:block; }`

- [ ] **Step 3 : vérifs** — `node --check frontend/js/theme.js && node --check frontend/js/app.js`. Smoke local (après lancement) : un profil avec `company.color` → accents à la bonne couleur ; logo+nom de la société dans l'en-tête ; sans `company` → look actuel.
- [ ] **Step 4 : commit** — `git add frontend/js/theme.js frontend/js/app.js frontend/css/app.css && git commit -m "feat(multi): theme frontend par societe (couleur + logo + nom)"`

---

### Task 6 : seed multi-société

**Files:** Modify `backend/seed_employees.py` ; Test `backend/tests/test_multi_company.py`

**Interfaces:** `seed_employees.py` accepte `--companies 5,4` (défaut `5`). Pour chaque société, `odoo.list_employees(company_id)` (Task 2) → `db.upsert_employee(..., company_id=cid)`.

- [ ] **Step 1 : test** — fonction `companies_arg("5,4") -> [5,4]` ; (test léger d'unité sur le parsing + que le seed appelle `list_employees(cid)` par société et `upsert_employee` avec le bon `company_id` — mocks `odoo.list_employees`/`db.upsert_employee`).
- [ ] **Step 2 : lancer (échoue)**.
- [ ] **Step 3 : implémenter** — argparse `--companies` (CSV d'ints, défaut `[5]`) ; boucle sur les sociétés ; passer `company_id` à `list_employees` et `upsert_employee`.
- [ ] **Step 4 : lancer (passe)** + suite.
- [ ] **Step 5 : commit** — `git commit -m "feat(multi): seed multi-societe (--companies) + company_id stocke"`

---

### Task 7 : Supabase — `theme_color` + lignes par société (config/infra)

**Files:** SQL appliqué via l'API Management Supabase (PAT). Pas de code app.

- [ ] **Step 1 : migration SQL** (SQL editor / Management API) :
```sql
alter table public.app_rh_company_config add column if not exists theme_color text;
-- défauts (à ajuster) : SP bleu actuel + couleurs des autres sociétés
update public.app_rh_company_config set theme_color = '#0c5e68' where company_id = 5 and theme_color is null;
-- EP (4), SER (6), HC, HS : insérer/activer lignes + couleur lors de l'onboarding (Task post-déploiement)
```
- [ ] **Step 2 : vérif** — `select company_id, theme_color from app_rh_company_config;`
- (Onboarding par société = runbook après déploiement : activer la ligne `app_rh_company_config` (enabled_tabs + theme_color) + `seed_employees.py --companies <id>`.)

---

## Self-Review
**Couverture spec :** société par employé → T1/T2/T3 ; onglets par société (déjà câblés) → T3 (bonne société au gate) ; thème (logo/nom/couleur) → T4 (backend) + T5 (frontend) ; seed multi-société → T6 ; theme_color Supabase → T7 ; non-régression SP → repli `settings.company_id`/`#0c5e68` partout. ✓
**Placeholders :** le gros refactor odoo.py (T1/T2) est décrit par **pattern + liste exhaustive de sites (file:line)** — transformation précise, pas un TODO. Le défaut `company_id=None → settings.company_id` garde le fichier cohérent entre T1 et T2.
**Cohérence types :** `_company_domain(company_id)`, `employee_company_id(hr_id)`, `company_branding(cid)`, `company_theme_color(cid)`, `upsert_employee(...,company_id=)`, `/me.company`, `applyTheme(company)` — cohérents T1→T7.

## Hors plan (runbook post-déploiement)
Fusion `wip` → `feat/multi-company`, déploiement, puis onboarding **EP → SER → HC → HS** : activer la société dans vue.heiwa (onglets + theme_color) + `seed_employees.py --companies <id>`.
