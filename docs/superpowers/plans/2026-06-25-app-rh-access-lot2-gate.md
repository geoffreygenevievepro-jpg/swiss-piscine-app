# App RH Group — Lot 2 V1 (app RH) — Gate d'accès Supabase

**Goal:** L'app RH lit les droits d'accès dans Supabase (`app_rh_company_config`, `app_rh_access`) pour (a) refuser le login si l'accès est explicitement désactivé, et (b) filtrer les onglets contrôlables du menu — sans rien casser de l'existant.

**Branche:** `wip/v2-sprint-elie` (repo geoffreygenevievepro-jpg, push via compte SwissPiscine).

## Décisions (validées)
- **Fail-open** : refus du login seulement si une ligne existe ET `access_active = false`. Aucune ligne / Supabase injoignable → on laisse entrer avec **tous** les onglets contrôlables. Anti-lockout.
- **Lecture seule** : la clé de l'app est `anon` (read-only). Aucune écriture dans Supabase depuis l'app. Le seed des droits se fait depuis vue.heiwa (ou via PAT one-shot).
- **Existant intact** : `announcement.py` (le mot, lu par tous) et `admin.py` (`role=='admin'`) inchangés. Le `level` membre/manager n'est pas encore câblé aux pouvoirs (suivi).

## Contrat (Lot 1)
- Onglets contrôlables (= ids d'écrans frontend) : `terrain`, `planning`, `conges`, `notesfrais`, `documents`.
- Toujours visibles : `accueil`, `pointer`, `moi`. `admin` : gardé par le rôle in-app (`role=='admin'`).
- Résolution : `effective = (allowed_tabs ∩ company.enabled_tabs)` ; si `allowed_tabs` vide → `company.enabled_tabs` ; société = plafond. Si pas de config société → les 5 contrôlables.
- Tables lues via PostgREST :
  - `GET {url}/rest/v1/app_rh_company_config?company_id=eq.{cid}&select=enabled_tabs,active`
  - `GET {url}/rest/v1/app_rh_access?hr_employee_id=eq.{hid}&select=access_active,allowed_tabs,level`
  - headers : `apikey: {key}`, `Authorization: Bearer {key}`.

---

### Task 1 : config — champs Supabase

- Fichier : `backend/app/config.py`
- Ajouter à `Settings` (après `db_path`) :
```python
    supabase_url: str = ""
    supabase_key: str = ""
```
- `env_prefix="APP_"` → mappe `APP_SUPABASE_URL`/`APP_SUPABASE_KEY` (déjà dans `.env`).
- Vérif : `from app.config import settings; print(bool(settings.supabase_url))` → True.

### Task 2 : module `supabase_access.py` (cœur, TDD)

- Créer `backend/app/supabase_access.py` :
  - `CONTROLLABLE_TABS = ["terrain","planning","conges","notesfrais","documents"]`
  - `resolve_effective_tabs(allowed, company_enabled) -> list[str]` (pur — port du helper Lot 1).
  - `get_company_config(company_id) -> dict | None` (requests, timeout 5, retourne None sur erreur).
  - `get_employee_access(hr_employee_id) -> dict | None`.
  - `access_decision(hr_employee_id, company_id) -> dict` : retourne `{"allowed": bool, "effective_tabs": [...], "level": str|None}`. **Fail-open** : exceptions / pas de ligne → `allowed=True`, tabs = config société (ou les 5), `level=None`. Refus seulement si `access_active is False` explicite.
- Test `backend/tests/test_supabase_access.py` (pytest) sur `resolve_effective_tabs` (vide→société, intersection, ordre, clés inconnues) et `access_decision` avec `requests` mocké (monkeypatch) pour : ligne active, `access_active=false` → allowed False, exception → fail-open allowed True.

### Task 3 : gate login

- Fichier : `backend/app/routers/auth.py`, dans `login()` après la vérif PIN OK (avant `_issue_tokens`).
```python
from .. import supabase_access
...
    decision = supabase_access.access_decision(emp["hr_employee_id"], settings.company_id)
    if not decision["allowed"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Accès suspendu — contactez l'administration RH")
```
- Vérif : import app OK ; (test manuel : un login normal passe car fail-open).

### Task 4 : /me expose `effective_tabs`

- Fichier : `backend/app/routers/me.py`, dans le dict de retour ajouter :
```python
        "effective_tabs": supabase_access.access_decision(emp["hr_employee_id"], settings.company_id)["effective_tabs"],
```
- (1 seul appel ; le login en fait un autre — acceptable. Optionnel : timeout court.)

### Task 5 : frontend — filtrer les onglets contrôlables

- Fichier : `frontend/js/app.js`, `navScreens()`.
- Toujours montrer `accueil/pointer/moi` ; `admin` si `role==='admin'` ; les 5 contrôlables seulement si présents dans `me.effective_tabs`. Si `effective_tabs` absent (vieux cache) → montrer tous (fail-open).
```javascript
function navScreens() {
  const me = profile.get() || {};
  const role = me.role;
  const eff = me.effective_tabs;             // array | undefined
  const CONTROLLABLE = ["terrain","planning","conges","notesfrais","documents"];
  return SCREENS.filter(s => {
    if (s.id === "admin") return role === "admin";
    if (CONTROLLABLE.includes(s.id)) return !eff || eff.includes(s.id);  // fail-open si undefined
    return true;                               // accueil/pointer/moi/... toujours
  });
}
```
- Vérif : `node -c frontend/js/app.js` (syntaxe) si dispo, sinon revue.

### Task 6 : revue finale + commit + push

- `pytest backend/tests/` vert ; `from app.main import app` OK.
- Commit sur `wip/v2-sprint-elie`, push via compte SwissPiscine.

## Hors périmètre (suivi)
- Câbler `level` (membre/manager) aux pouvoirs in-app (le mot, etc.).
- Seed explicite des 7 employés (via vue.heiwa ou PAT).
- Variante « le mot » manager→subordonnés.
