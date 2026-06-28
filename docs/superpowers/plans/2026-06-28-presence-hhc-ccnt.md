# Refonte écran Présence HHC (vue CCNT cohérente) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner aux employés HHC, dans l'onglet Présence, une vue CCNT cohérente (arcs + décompte + calendrier alimentés par un seul calcul), avec fériés perçus/à rattraper et solde d'heures — sans impacter les autres sociétés.

**Architecture :** Le backend `odoo.ccnt_year` (déjà existant, gaté HHC via `/attendance/ccnt`) est enrichi de deux blocs — `arcs` (jour/mois/année réalisé/dû) et `decompte.feries` (perçus/à rattraper). Le frontend `ccnt.js` rend la vue enrichie ; `pointer.js` masque, pour HHC uniquement, les anciens blocs contradictoires (arcs `hours_overview`, soldes natifs) et garde le timbrage.

**Tech Stack :** Python 3.12 / FastAPI (backend, lecture Odoo via JSON-RPC) ; JavaScript vanilla ES modules (PWA, sans build) ; pytest ; `node --check` (pas de tests JS unitaires — convention du repo).

## Global Constraints

- **HHC uniquement** : toute modification frontend est gatée `me.company.id === 1` ; l'endpoint renvoie `{enabled:false}` hors HHC. EP/SP/HC/HS/SER ne bougent pas.
- **Odoo = source de vérité** ; ~1 % d'écart avec les fiches manuelles accepté.
- **À jour au jour J** : aucun cumul/dû ne projette le futur (borne = aujourd'hui).
- **Ne jamais modifier les heures timbrées** ni les horaires.
- **Théorique par période de contrat** (`hr.version`) ; cumul, pas de filtre.
- Vacances : jours **calendaires**, base **28 j/an** pro-rata.
- Fériés à rattraper = férié tombé un **jour travaillé** (timbrage > 0 ce jour).
- Mobile-first, couleurs sobres « Hôtel de la Poste ».
- Tests pytest lancés depuis `backend/` : `.venv/bin/python -m pytest tests/ -q` (suite verte = 80).

## File Structure

- `backend/app/odoo.py` — ajoute 2 helpers purs (`_feries_split`, `_theo_sum`) et enrichit `ccnt_year` (blocs `arcs` + `decompte.feries`). Pas de nouveau fichier.
- `backend/tests/test_ccnt.py` — ajoute les tests des helpers purs.
- `frontend/js/screens/ccnt.js` — rend les arcs, le solde d'heures, le décompte enrichi (fériés perçus/à rattraper, restant + détail). Styles inclus (déjà le cas).
- `frontend/js/screens/pointer.js` — gate HHC : masque les anciens blocs (arcs `hours_overview`, soldes), garde le timbrage, rend la vue CCNT.
- `frontend/sw.js` — bump de version du cache à chaque changement frontend.

---

### Task 1 : Backend — fériés perçus / à rattraper

**Files:**
- Modify: `backend/app/odoo.py` (ajout helper `_feries_split` près de `_ccnt_leave_cat` ; appel dans `ccnt_year`, bloc `if not hourly`)
- Test: `backend/tests/test_ccnt.py`

**Interfaces:**
- Produces: `_feries_split(ferie_dates: list[str], worked_dates: set[str]) -> dict` → `{"percus": int, "a_rattraper": int}`. Ajoute `decompte["feries"] = {"percus", "a_rattraper"}` à la sortie de `ccnt_year` (uniquement quand `decompte` n'est pas None).

- [ ] **Step 1 : Test qui échoue** — dans `backend/tests/test_ccnt.py`, ajouter :

```python
def test_feries_split():
    # 4 fériés ; 1 tombe un jour travaillé -> à rattraper ; 3 perçus
    feries = ["2026-01-01", "2026-03-19", "2026-05-14", "2026-06-04"]
    worked = {"2026-03-19", "2026-06-10"}  # 03-19 est un férié travaillé
    assert odoo._feries_split(feries, worked) == {"percus": 3, "a_rattraper": 1}
    assert odoo._feries_split([], set()) == {"percus": 0, "a_rattraper": 0}
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ccnt.py::test_feries_split -q`
Expected: FAIL — `AttributeError: module 'app.odoo' has no attribute '_feries_split'`

- [ ] **Step 3 : Implémenter le helper** — dans `backend/app/odoo.py`, juste après la fonction `_ccnt_leave_cat` :

```python
def _feries_split(ferie_dates: list[str], worked_dates: set[str]) -> dict:
    """Fériés perçus vs à rattraper : un férié tombé un jour TRAVAILLÉ (timbrage > 0)
    est dû en compensatoire (à rattraper) ; sinon il est perçu (jour de congé reçu)."""
    a_rattraper = sum(1 for d in ferie_dates if d in worked_dates)
    return {"percus": len(ferie_dates) - a_rattraper, "a_rattraper": a_rattraper}
```

- [ ] **Step 4 : Brancher dans `ccnt_year`** — dans le bloc `if not hourly:` de `ccnt_year`, APRÈS le calcul de `worked_d`/`worked_h` et AVANT la construction du dict `decompte`, ajouter le calcul ; puis ajouter la clé `"feries"` au dict `decompte`. Le `cutoff`, `holiday_days`, `worked_by_day` existent déjà dans la portée :

```python
        # fériés perçus / à rattraper (à ce jour)
        ferie_dates_td = [iso for iso in holiday_days if date.fromisoformat(iso) <= cutoff]
        worked_dates_td = {iso for iso, h in worked_by_day.items()
                           if h > 0 and date.fromisoformat(iso) <= cutoff}
        feries = _feries_split(ferie_dates_td, worked_dates_td)
```

Et dans le dict `decompte = {...}`, ajouter la ligne :

```python
            "feries": feries,
```

- [ ] **Step 5 : Vérifier le passage + non-régression**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`
Expected: PASS (81 tests : 80 + le nouveau)

- [ ] **Step 6 : Commit**

```bash
git add backend/app/odoo.py backend/tests/test_ccnt.py
git commit -m "feat(ccnt): feries percus/a rattraper dans le decompte"
```

---

### Task 2 : Backend — arcs jour / mois / année (calcul CCNT)

**Files:**
- Modify: `backend/app/odoo.py` (helper `_theo_sum` ; refactor du théorique par période pour l'utiliser ; ajout du bloc `arcs` au retour de `ccnt_year`)
- Test: `backend/tests/test_ccnt.py`

**Interfaces:**
- Produces: `_theo_sum(segments: list[tuple[float, float]]) -> float` → `sum(net_days / 7 * weekly)`. Ajoute au retour de `ccnt_year` la clé `"arcs"` (None si `hourly`, sinon `{"jour": {...}, "mois": {...}, "annee": {...}}`, chaque sous-dict = `{"fait": float, "du": float}`).

- [ ] **Step 1 : Test qui échoue** — ajouter dans `backend/tests/test_ccnt.py` :

```python
def test_theo_sum():
    # (jours nets, hebdo) : 160 j à 42h + 59 j à 25.2h
    assert odoo._theo_sum([(160, 42)]) == 960.0
    assert round(odoo._theo_sum([(37, 33.6), (59, 25.2)]), 1) == 390.0
    assert odoo._theo_sum([]) == 0.0
```

- [ ] **Step 2 : Vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ccnt.py::test_theo_sum -q`
Expected: FAIL — `AttributeError: ... has no attribute '_theo_sum'`

- [ ] **Step 3 : Helper pur** — dans `backend/app/odoo.py`, après `_feries_split` :

```python
def _theo_sum(segments: list) -> float:
    """Heures théoriques = somme, sur des segments (jours_nets, hebdo), de jours_nets/7 × hebdo."""
    return sum(net / 7 * weekly for net, weekly in segments)
```

- [ ] **Step 4 : Refactor du théorique par période pour utiliser `_theo_sum` + collecter les segments du mois en cours.** Dans `ccnt_year`, bloc `if not hourly:`, la boucle `for v in vers:` construit déjà `theo_du`/`repos_dus`/`periodes`. La remplacer pour accumuler des segments (année et mois courant). Remplacer le corps de la boucle et le calcul agrégé par :

```python
        cur_month = cutoff.month
        m0 = date(year, cur_month, 1)
        seg_annee, seg_mois = [], []
        for v in vers:
            if not v.get("resource_calendar_id"):
                continue
            try:
                vs = datetime.fromisoformat(str(v["date_start"])[:10]).date() if v.get("date_start") else y0
                ve = datetime.fromisoformat(str(v["date_end"])[:10]).date() if v.get("date_end") else cutoff
            except (ValueError, TypeError):
                continue
            ps, pe = max(vs, y0), min(ve, cutoff)
            if ps > pe:
                continue
            pw = cal_h.get(v["resource_calendar_id"][0], 0.0)
            pdays = (pe - ps).days + 1
            pabs = sum(1 for iso, cat in leave_by_day.items() if cat in absc and ps <= date.fromisoformat(iso) <= pe)
            seg_annee.append((max(pdays - pabs, 0), pw))
            presence += pdays
            periodes.append({"du": str(ps), "au": str(pe), "pct": round(pw / 42 * 100) if pw else 0})
            # portion de cette période dans le mois en cours (pour l'arc mois)
            ms, me = max(ps, m0), pe  # pe <= cutoff (donc <= fin du mois courant côté futur)
            if me >= ms and ms.month == cur_month:
                mdays = (me - ms).days + 1
                mabs = sum(1 for iso, cat in leave_by_day.items() if cat in absc and ms <= date.fromisoformat(iso) <= me)
                seg_mois.append((max(mdays - mabs, 0), pw))
        if seg_annee:
            theo_du = _theo_sum(seg_annee)
            repos_dus = _theo_sum([(n, 2) for n, _ in seg_annee])
```

Garder tel quel le repli `if not periodes:` (pas de versions) déjà présent juste après.

- [ ] **Step 5 : Construire le bloc `arcs`** — toujours dans `if not hourly:`, APRÈS le dict `decompte` et AVANT le `return`, ajouter :

```python
        cur_weekly = (seg_annee[-1][1] if seg_annee else weekly)  # hebdo de la dernière période
        today_iso = cutoff.isoformat()
        arcs = {
            "jour": {"fait": round(worked_by_day.get(today_iso, 0.0), 1), "du": round(cur_weekly / 5, 1)},
            "mois": {"fait": months[cutoff.month - 1]["hours"], "du": round(_theo_sum(seg_mois), 1)},
            "annee": {"fait": decompte["heures"]["fait"], "du": decompte["heures"]["du"]},
        }
```

Initialiser `arcs = None` au début du bloc décompte (à côté de `decompte = None`) ; et l'ajouter au dict de retour final.

- [ ] **Step 6 : Ajouter `arcs` au retour** — modifier le `return` de `ccnt_year` pour inclure `"arcs": arcs` (déclarer `arcs = None` AVANT le `if not hourly:`, comme `decompte = None`) :

```python
    decompte = None
    arcs = None
    if not hourly:
        ...
    return {
        "year": year, "hourly": hourly, "weekly": round(weekly, 1),
        "worked_total": round(sum(worked_by_day.values()), 1),
        "worked_days": sum(1 for h in worked_by_day.values() if h > 0),
        "months": months, "calendar": calendar, "decompte": decompte, "arcs": arcs,
    }
```

- [ ] **Step 7 : Vérifier**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`
Expected: PASS (82 tests). Vérif manuelle optionnelle contre une employée réelle : `arcs["annee"]` doit égaler `decompte["heures"]`.

- [ ] **Step 8 : Commit**

```bash
git add backend/app/odoo.py backend/tests/test_ccnt.py
git commit -m "feat(ccnt): arcs jour/mois/annee (calcul CCNT) + helper _theo_sum"
```

---

### Task 3 : Frontend — vue « au % » enrichie (arcs + solde + décompte)

**Files:**
- Modify: `frontend/js/screens/ccnt.js`
- Modify: `frontend/sw.js` (bump version)

**Interfaces:**
- Consumes: `/attendance/ccnt` renvoie désormais `data.arcs` (`{jour,mois,annee}` chacun `{fait,du}`) et `data.decompte.feries` (`{percus,a_rattraper}`), en plus de l'existant (`decompte.heures{fait,du}`, `vacances{pris,droit}`, `repos{pris,dus}`, `jours_travailles`, `periodes`).
- Produces: rendu de la section « Ma CCNT » pour les employés au % (decompte présent) : arcs SVG + solde d'heures + décompte « restant ».

- [ ] **Step 1 : Helper jauge SVG** — dans `frontend/js/screens/ccnt.js`, ajouter en haut (après `f1`) :

```javascript
function gauge(a, label) {
  const fait = a.fait || 0, du = a.du || 0;
  const pct = du ? Math.min(100, Math.round(fait / du * 100)) : 0;
  const off = Math.round(138 - pct / 100 * 138);
  return `<div class="ccg"><svg viewBox="0 0 100 56" style="width:92px">
    <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round"/>
    <path d="M6 50 A44 44 0 0 1 94 50" fill="none" stroke="var(--aqua-dark)" stroke-width="9" stroke-linecap="round" stroke-dasharray="138" stroke-dashoffset="${off}"/></svg>
    <div class="ccgv">${pct}%</div><div class="ccgl">${label}<br><b>${f1(fait)}/${f1(du)} h</b></div></div>`;
}
```

- [ ] **Step 2 : Construire le résumé « au % »** — dans `renderCcnt`, remplacer le bloc `if (dec) { ... }` (la branche « employé AU % ») par la version enrichie : arcs + solde + décompte « restant ». `data.arcs` et `dec.feries` sont disponibles.

```javascript
  if (dec) {  // employé AU % : arcs CCNT + solde + décompte restant
    const a = data.arcs || { jour: {}, mois: {}, annee: dec.heures };
    const solde = (dec.heures.fait || 0) - (dec.heures.du || 0);
    const soldeTxt = solde > 0 ? `<span class="pos">+${f1(solde)} h à récupérer</span>`
      : solde < 0 ? `<span class="neg">${f1(-solde)} h de retard</span>` : "à l'équilibre";
    const vacRest = (dec.vacances.droit || 0) - (dec.vacances.pris || 0);
    const reposRest = (dec.repos.dus || 0) - (dec.repos.pris || 0);
    const fer = dec.feries || { percus: 0, a_rattraper: 0 };
    const pers = dec.periodes || [];
    const contrat = pers.length === 1 ? `Contrat ${pers[0].pct}%`
      : pers.length > 1 ? `Contrat ${pers.map((p) => p.pct + "%").join(" puis ")}` : "";
    summary = `
      <div class="ccnt-arcs">${gauge(a.jour, "Jour")}${gauge(a.mois, "Mois")}${gauge(a.annee, "Année")}</div>
      <div class="ccnt-solde"><span>Solde d'heures ${data.year}</span>${soldeTxt}</div>
      <table class="ccnt-dec">
        <tr><td>Vacances<small>restantes cette année</small></td><td class="n">${f1(vacRest)} <small>j · ${f1(dec.vacances.pris)} sur ${f1(dec.vacances.droit)}</small></td></tr>
        <tr><td>Jours de repos<small>à prendre</small></td><td class="n">${f1(reposRest)} <small>j · ${f1(dec.repos.pris)} sur ${f1(dec.repos.dus)}</small></td></tr>
        <tr><td>Jours fériés<small>perçus / à rattraper</small></td><td class="n">${fer.percus} / ${fer.a_rattraper}</td></tr>
        <tr><td>Maladie<small>indemnisée 80% dès le 4e jour</small></td><td class="n">${count("mal")} <small>j</small></td></tr>
        <tr><td>Jours travaillés</td><td class="n">${dec.jours_travailles}</td></tr>
      </table>
      ${contrat ? `<div class="ccnt-contrat">${contrat}</div>` : ""}`;
  }
```

- [ ] **Step 3 : Styles** — dans `injectStyle()` de `ccnt.js`, ajouter les règles des arcs et du solde (les autres `.ccnt-*` existent déjà) :

```javascript
   .ccnt-arcs{display:flex;gap:6px;background:var(--white);border:1px solid var(--line);border-radius:14px;padding:12px 4px;margin-bottom:10px}
   .ccg{flex:1;text-align:center}.ccgv{font-size:1.1rem;font-weight:800;color:var(--navy);margin-top:-20px}
   .ccgl{font-size:.6rem;color:var(--muted);margin-top:2px}.ccgl b{color:var(--ink);font-size:.64rem}
   .ccnt-solde{display:flex;justify-content:space-between;align-items:center;background:var(--white);border:1px solid var(--line);border-radius:12px;padding:11px 14px;margin-bottom:12px;font-size:.85rem}
   .ccnt-solde .pos{color:#1f7a4d;font-weight:800}.ccnt-solde .neg{color:var(--danger);font-weight:800}
   .ccnt-dec td.n small{font-weight:600}
```

- [ ] **Step 4 : Vérifier la syntaxe**

Run: `node --check frontend/js/screens/ccnt.js`
Expected: aucune sortie (OK)

- [ ] **Step 5 : Bump du service worker**

Modifier `frontend/sw.js` ligne 3 : incrémenter la version (ex. `sp-app-shell-vNN` → `vNN+1`).

- [ ] **Step 6 : Commit**

```bash
git add frontend/js/screens/ccnt.js frontend/sw.js
git commit -m "feat(ccnt): vue au % enrichie (arcs CCNT + solde + decompte restant + feries)"
```

---

### Task 4 : Frontend — Présence HHC : masquer les anciens blocs

**Files:**
- Modify: `frontend/js/screens/pointer.js`
- Modify: `frontend/sw.js` (bump version)

**Interfaces:**
- Consumes: `profile.get().company.id` (déjà utilisé pour appeler `renderCcnt`). `pointer.js` importe déjà `profile` et `renderCcnt`.
- Produces: pour HHC (`company.id === 1`), l'écran Présence n'affiche QUE le timbrage + la section CCNT (les anciens blocs arcs/soldes sont masqués). Hors HHC, l'écran est inchangé.

- [ ] **Step 1 : Repérer le rendu** — `pointer.js` construit l'écran via `draw(root, status, summary, balances, today, days, overview)` puis ajoute la section CCNT pour HHC. Lire `draw()` pour identifier les blocs « arcs » (`overview`/demi-jauges) et « soldes » (`balances`) dans le HTML qu'elle génère.

- [ ] **Step 2 : Gater l'affichage des anciens blocs** — dans `draw()`, entourer le HTML des blocs « arcs » (overview/jauges) et « soldes congés » (balances) d'une condition HHC. Au début de `draw`, ajouter :

```javascript
  const isHHC = ((profile.get() || {}).company || {}).id === 1;
```

Puis, pour chaque bloc à masquer, n'insérer son HTML que si `!isHHC` (ex. `${!isHHC ? blocArcsHtml : ""}` et `${!isHHC ? blocSoldesHtml : ""}`). **Ne pas toucher** au bloc timbrage ni à la bande des jours (gardés pour tous). La section CCNT (ajoutée après `draw`) reste gatée HHC comme aujourd'hui.

- [ ] **Step 3 : Vérifier la syntaxe**

Run: `node --check frontend/js/screens/pointer.js`
Expected: aucune sortie (OK)

- [ ] **Step 4 : Vérification manuelle (post-déploiement)** — en nav privé : un compte HHC au % (`claviens`) → Présence = timbrage + arcs CCNT + décompte (un seul jeu de chiffres) ; un compte non-HHC (ex. SP) → Présence inchangée.

- [ ] **Step 5 : Bump du service worker** — incrémenter `frontend/sw.js`.

- [ ] **Step 6 : Commit**

```bash
git add frontend/js/screens/pointer.js frontend/sw.js
git commit -m "feat(presence): masquer les anciens blocs (arcs/soldes) pour HHC — vue CCNT unique"
```

---

## Déploiement (après les 4 tâches)

1. Suite verte : `cd backend && .venv/bin/python -m pytest tests/ -q`.
2. `node --check` sur les 2 fichiers JS modifiés.
3. Fusion dans `wip/v2-sprint-elie`, rsync code-only vers le VPS (exclure `.venv`, `data`, `.env`, `.secret_key`, `*.log`), `sudo systemctl restart swiss-piscine-app`.
4. Smoke : SW servi à la nouvelle version, `/attendance/ccnt` répond, vérif manuelle Task 4 Step 4.

## Self-Review (vérifié)

- **Couverture spec :** arcs (Task 2), fériés perçus/à rattraper (Task 1), solde d'heures + décompte restant + maladie + jours travaillés (Task 3), masquage anciens blocs gaté HHC + timbrage gardé (Task 4), graphe/calendrier (déjà présents, inchangés). Variante extra : inchangée (decompte/arcs = None → la branche « à l'heure » de `ccnt.js` s'applique). ✓
- **Placeholders :** aucun ; tout le code est fourni.
- **Cohérence des types :** `arcs.{jour,mois,annee}.{fait,du}`, `decompte.feries.{percus,a_rattraper}`, `_theo_sum(list[(net,weekly)])`, `_feries_split(list[str], set[str])` — utilisés de façon identique entre backend (Tasks 1-2) et frontend (Task 3).
