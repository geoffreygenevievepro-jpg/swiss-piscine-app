# Rapport d'intervention unifié — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fusionner les deux formulaires de rapport (planning `report.js` + onglet `terrain.js renderForm`) en un seul formulaire adaptatif, miroir du worksheet Odoo « Rapport d'intervention » (template 10).

**Architecture:** `report.js` → `renderReport(root, ctx)` devient la form unique : `ctx={slot}` (planning, client verrouillé) ou `ctx={create:true}` (nouveau chantier, client éditable). Submit : slot → outbox `POST /interventions/{slot_id}/report` ; create → `POST /interventions`. Backend : 5 ajouts **additifs** dans `app/odoo.py` / `routers/interventions.py`.

**Tech Stack:** Frontend PWA vanilla JS (vérif `node --check`, pas de framework de test JS). Backend FastAPI + pytest (`backend/.venv/bin/python -m pytest`). Odoo SaaS 19.2 via XML-RPC. Connexion Odoo mockée dans les tests (`monkeypatch.setattr(odoo, "get_client"/"get_write_client", ...)`).

## Global Constraints

- Branche unique : `wip/v2-sprint-elie`. NE PAS toucher au multi-société.
- ⚠️ Toute modif de `backend/app/odoo.py` et `backend/app/config.py` = zone de la session `feat/multi-company` → **prévenir l'utilisateur avant de committer** chaque tâche backend (tâches 1-3).
- Modifs backend **uniquement additives** : nouvelles fonctions, nouveaux champs optionnels, nouvelles branches. Zéro suppression, zéro renommage de l'existant.
- Frontend : à chaque changement, bumper `frontend/sw.js` (`sp-app-shell-v46` → `v47`).
- Vérif systématique : `node --check` sur tout JS modifié ; `backend/.venv/bin/python -m pytest` depuis `backend/` (les 28+ tests existants restent verts).
- Push : `git push "https://x-access-token:$(gh auth token --user SwissPiscine)@github.com/geoffreygenevievepro-jpg/swiss-piscine-app.git" wip/v2-sprint-elie:wip/v2-sprint-elie`.
- Déploiement (séparé, hors plan) : rsync + `sudo systemctl restart swiss-piscine-app` pour le backend, après coordination.
- Worker_ids (ids `hr.employee`) restent le vecteur du worksheet « Équipe » / timesheet (inchangé). `resource_ids` (ids `resource.resource`) servent UNIQUEMENT à poser `slot.resource_id` en mode create.

## File Structure

| Fichier | Responsabilité | Action |
|---|---|---|
| `backend/app/odoo.py` | `list_resources()`, branche facture dans `submit_report`, Remarques dans `_fill_worksheet`, `resource_id` + filtre facturable dans `create_intervention` | Modifier |
| `backend/app/routers/interventions.py` | Endpoint `GET /resources`, champs `Report` (products/discount/vat_rate/status/remarques), passage `resource_ids`/`remarques` à `create_intervention` | Modifier |
| `backend/tests/test_interventions_report.py` | Tests des ajouts backend | Créer |
| `frontend/js/screens/report.js` | `renderReport(root, ctx)` unifié : client conditionnel, temps adaptatif, pièces/produits facturables, équipe ressources, remarques, statut, routage submit | Modifier |
| `frontend/js/screens/terrain.js` | Coquille onglet ; supprime `renderForm` ; `renderJour`/détail/« nouvelle » ouvrent `renderReport` | Modifier |
| `frontend/js/screens/semaine.js` | Clic créneau → `renderReport({slot})` (déjà le cas, vérifier signature) | Vérifier/Modifier |
| `frontend/js/screens/accueil.js` | Raccourci « Mon intervention » : intent `new` ouvre le mode create | Vérifier |
| `frontend/sw.js` | Bump version cache | Modifier |

---

## Task 1: Backend — `list_resources()` + `GET /resources` ⚠️ coordination odoo.py

**Files:**
- Modify: `backend/app/odoo.py` (ajouter `list_resources` près de `list_employees`)
- Modify: `backend/app/routers/interventions.py` (nouvel endpoint)
- Test: `backend/tests/test_interventions_report.py` (créer)

**Interfaces:**
- Produces: `odoo.list_resources() -> list[dict]` chaque item `{"resource_id": int, "employee_id": int|None, "name": str}`.
- Produces: route `GET /resources` → même structure (auth `get_current_employee`).

- [ ] **Step 1: Écrire le test (échoue)**

Créer `backend/tests/test_interventions_report.py` :

```python
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
import app.odoo as odoo
from app.main import app
from app.deps import get_current_employee

client = TestClient(app)


def test_list_resources_maps_resource_to_employee(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.return_value = [
        {"id": 7, "name": "Alex", "employee_id": [3, "Alex"]},
        {"id": 8, "name": "Loïc", "employee_id": False},
    ]
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    out = odoo.list_resources()
    assert out == [
        {"resource_id": 7, "employee_id": 3, "name": "Alex"},
        {"resource_id": 8, "employee_id": None, "name": "Loïc"},
    ]


def test_resources_endpoint(monkeypatch):
    monkeypatch.setattr(odoo, "list_resources",
                        lambda: [{"resource_id": 7, "employee_id": 3, "name": "Alex"}])
    app.dependency_overrides[get_current_employee] = lambda: {"hr_employee_id": 3, "name": "Alex"}
    r = client.get("/resources")
    app.dependency_overrides.clear()
    assert r.status_code == 200
    assert r.json() == [{"resource_id": 7, "employee_id": 3, "name": "Alex"}]
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interventions_report.py -v`
Expected: FAIL (`AttributeError: module 'app.odoo' has no attribute 'list_resources'`).

- [ ] **Step 3: Implémenter `list_resources` dans `app/odoo.py`**

Ajouter (juste après la fonction `list_employees`) :

```python
def list_resources() -> list[dict]:
    """Ressources planning de la société (resource.resource human), mappées à l'employé.

    Sert au picker « Équipe sur le chantier » : on garde resource_id (planning) ET
    employee_id (worksheet/timesheet)."""
    ro = get_client()
    rows = ro.execute_kw(
        "resource.resource", "search_read",
        [[["company_id", "=", settings.company_id], ["resource_type", "=", "user"]]],
        {"fields": ["id", "name", "employee_id"]})
    out = []
    for r in rows:
        emp = r.get("employee_id")
        out.append({"resource_id": r["id"],
                    "employee_id": emp[0] if emp else None,
                    "name": r["name"]})
    return out
```

- [ ] **Step 4: Ajouter l'endpoint dans `routers/interventions.py`**

Après la route `@router.get("/employees")` :

```python
@router.get("/resources")
def resources(emp=Depends(get_current_employee)):
    """Ressources planning (company 5) pour le picker « Équipe sur le chantier »."""
    return odoo.list_resources()
```

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interventions_report.py -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Non-régression**

Run: `cd backend && .venv/bin/python -m pytest`
Expected: tous verts (28+).

- [ ] **Step 7: ⚠️ Prévenir l'utilisateur (modif odoo.py) puis commit**

```bash
git add backend/app/odoo.py backend/app/routers/interventions.py backend/tests/test_interventions_report.py
git commit -m "feat(api): list_resources() + GET /resources (picker equipe = resource.resource)"
```

---

## Task 2: Backend — `Report` enrichi + branche facture dans `submit_report` ⚠️ coordination odoo.py

**Files:**
- Modify: `backend/app/routers/interventions.py` (modèle `Report`)
- Modify: `backend/app/odoo.py` (`submit_report` : branche facture)
- Test: `backend/tests/test_interventions_report.py`

**Interfaces:**
- Consumes: `odoo.create_draft_invoice(partner_id:int, products:list[dict], discount:float=0.0, origin:str|None=None) -> int` (existant, `odoo.py:587`).
- Produces: `submit_report(...)` renvoie en plus `"invoice": bool`, `"invoice_id": int|None`.
- Produces: `Report` accepte `products: list[ProductLine]`, `discount: float`, `vat_rate: float`, `status: str|None`, `remarques: str|None`, `resource_ids: list[int]`. (`parts`, `worker_ids` déjà présents.)

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `backend/tests/test_interventions_report.py` :

```python
def test_submit_report_invoices_billable_lines(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.return_value = [{
        "task_id": False, "project_id": False, "partner_id": [42, "Client"],
        "name": "Chantier X", "start_datetime": "2026-06-27 06:00:00", "employee_ids": [],
    }]
    rw = MagicMock()
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: rw)
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    seen = {}

    def fake_invoice(partner_id, products, discount=0.0, origin=None):
        seen["partner_id"] = partner_id
        seen["products"] = products
        return 999

    monkeypatch.setattr(odoo, "create_draft_invoice", fake_invoice)
    report = {
        "type": "Entretien", "parts": ["Filtre", "Vis"], "discount": 0,
        "products": [
            {"name": "Filtre", "qty": 1, "price": 80.0, "billable": True},
            {"name": "Vis", "qty": 10, "price": None, "billable": False},
        ],
    }
    res = odoo.submit_report(1, "Alex", 5, report)
    assert res["invoice"] is True
    assert res["invoice_id"] == 999
    assert seen["partner_id"] == 42
    assert [p["name"] for p in seen["products"]] == ["Filtre"]  # seulement la ligne facturable


def test_submit_report_no_invoice_without_billable(monkeypatch):
    ro = MagicMock()
    ro.execute_kw.return_value = [{
        "task_id": False, "project_id": False, "partner_id": [42, "Client"],
        "name": "X", "start_datetime": "2026-06-27 06:00:00", "employee_ids": [],
    }]
    monkeypatch.setattr(odoo, "get_client", lambda: ro)
    monkeypatch.setattr(odoo, "get_write_client", lambda: MagicMock())
    monkeypatch.setattr(odoo, "_fill_worksheet", lambda *a, **k: None)
    monkeypatch.setattr(odoo, "create_draft_invoice",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("ne doit pas facturer")))
    res = odoo.submit_report(1, "Alex", 5, {"type": "Entretien", "products": []})
    assert res["invoice"] is False
    assert res["invoice_id"] is None
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interventions_report.py -k submit_report -v`
Expected: FAIL (`KeyError: 'invoice'`).

- [ ] **Step 3: Ajouter les champs au modèle `Report`**

Dans `routers/interventions.py`, classe `Report`, ajouter après `worker_ids` :

```python
    products: list[ProductLine] = []     # lignes pièces/produits (billable = facturable)
    discount: float = 0.0                # remise globale % (facture)
    vat_rate: float = 8.1                # TVA % (affichage)
    status: str | None = None            # done | todo
    remarques: str | None = None         # champ libre worksheet « Remarques »
    resource_ids: list[int] = []         # resource.resource (réservé, non utilisé en mode slot)
```

Et ajouter le champ `billable` à `ProductLine` :

```python
    billable: bool = False               # ligne à facturer (sinon : pièce worksheet seule)
```

- [ ] **Step 4: Ajouter la branche facture dans `submit_report`**

Dans `app/odoo.py`, dans `submit_report`, juste avant le `return {...}` final, insérer :

```python
    # Facture brouillon — lignes « à facturer » du rapport (additif). Le partner vient du créneau.
    invoice_id = None
    billable = [p for p in (report.get("products") or []) if p.get("billable")]
    if billable and slot.get("partner_id"):
        try:
            invoice_id = create_draft_invoice(
                slot["partner_id"][0], billable,
                discount=float(report.get("discount") or 0.0),
                origin=slot.get("name") or report.get("type"))
            rw.execute_kw("planning.slot", "message_post", [[slot_id]],
                          {"body": "<p><strong>Facture brouillon créée</strong> — à vérifier et valider par le bureau.</p>"})
        except Exception:
            invoice_id = None
```

Puis modifier le `return` final pour ajouter les deux clés :

```python
    return {"ok": True, "model": model, "res_id": rid,
            "attachments": len(att_ids), "timesheet": timesheet_ok,
            "activity": activity_ok, "tags": tags_applied, "worksheet": worksheet_ok,
            "invoice": bool(invoice_id), "invoice_id": invoice_id}
```

- [ ] **Step 5: Lancer, vérifier le succès**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interventions_report.py -v`
Expected: PASS (4 tests cumulés).

- [ ] **Step 6: Non-régression**

Run: `cd backend && .venv/bin/python -m pytest`
Expected: tous verts.

- [ ] **Step 7: ⚠️ Prévenir l'utilisateur puis commit**

```bash
git add backend/app/odoo.py backend/app/routers/interventions.py backend/tests/test_interventions_report.py
git commit -m "feat(api): submit_report facture les lignes billable + champs Report enrichis"
```

---

## Task 3: Backend — Remarques worksheet + resource_id & filtre facturable dans `create_intervention` ⚠️ coordination odoo.py

**Files:**
- Modify: `backend/app/odoo.py` (`_fill_worksheet`, `create_intervention`)
- Modify: `backend/app/routers/interventions.py` (passage `resource_ids`/`remarques`)
- Test: `backend/tests/test_interventions_report.py`

**Interfaces:**
- Produces: `_fill_worksheet` mappe la propriété « Remarques » ← `report["remarques"]`.
- Produces: `create_intervention(..., resource_ids=None, remarques=None)` pose `slot.resource_id = resource_ids[0]` et ne facture que les lignes `billable`.

- [ ] **Step 1: Écrire le test (échoue)**

Ajouter à `backend/tests/test_interventions_report.py` :

```python
def test_fill_worksheet_maps_remarques(monkeypatch):
    rw = MagicMock()
    ro = MagicMock()
    # _intervention_ws_template_id → 10 ; relecture des propriétés
    monkeypatch.setattr(odoo, "_intervention_ws_template_id", lambda ro_: 10)
    ro.execute_kw.return_value = [{"worksheet_properties": [
        {"string": "Remarques", "type": "text", "value": False},
        {"string": "Type d'intervention", "type": "char", "value": False},
    ]}]
    odoo._fill_worksheet(ro, rw, 5, {"start_datetime": False, "partner_id": False},
                         {"remarques": "RAS, tout ok", "type": "Entretien"})
    # dernier write = worksheet_properties avec Remarques rempli
    last = rw.execute_kw.call_args_list[-1]
    props = last.args[2]["worksheet_properties"]
    rem = next(p for p in props if p["string"] == "Remarques")
    assert rem["value"] == "RAS, tout ok"
```

- [ ] **Step 2: Lancer, vérifier l'échec**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interventions_report.py -k remarques -v`
Expected: FAIL (Remarques reste `False`).

- [ ] **Step 3: Mapper Remarques dans `_fill_worksheet`**

Dans `app/odoo.py`, dictionnaire `by_label` de `_fill_worksheet`, ajouter une entrée après `"Prochaine action"` :

```python
        "Prochaine action": na_lbl,
        "Remarques": report.get("remarques"),
```

- [ ] **Step 4: `resource_id` + filtre facturable dans `create_intervention`**

Dans `app/odoo.py`, signature de `create_intervention`, ajouter deux kwargs à la fin :

```python
                        next_action_date: str | None = None, schedule: str | None = None,
                        resource_ids: list[int] | None = None, remarques: str | None = None) -> dict:
```

Dans le `vals` du `planning.slot` (après `"name": label,`), ajouter :

```python
    rids = [int(r) for r in (resource_ids or [])]
    if rids:
        vals["resource_id"] = rids[0]
```

Dans `report_like`, ajouter la clé remarques (après `"signature": signature,`) :

```python
            "remarques": remarques,
```

Remplacer la détection `billable` (tag-driven) par le filtre par ligne :

```python
    # --- Facturation : facture client BROUILLON pour les lignes « à facturer » ---
    invoice_id = None
    bill_lines = [p for p in (products or []) if p.get("billable")]
    if bill_lines:
        bill_partner = partner_id
        if not bill_partner and client_name:
            try:
                bill_partner = create_partner(client_name)
                rw.execute_kw("planning.slot", "write", [[slot_id], {"partner_id": bill_partner}])
            except Exception:
                bill_partner = None
        if bill_partner:
            try:
                invoice_id = create_draft_invoice(bill_partner, bill_lines, discount, origin=label)
                rw.execute_kw("planning.slot", "message_post", [[slot_id]],
                              {"body": "<p><strong>Facture brouillon créée</strong> — à vérifier et valider par le bureau.</p>"})
            except Exception:
                invoice_id = None
```

- [ ] **Step 5: Passer `resource_ids`/`remarques` depuis le routeur**

Dans `routers/interventions.py`, classe `NewIntervention`, ajouter (après `next_action_date`) :

```python
    resource_ids: list[int] = []
    remarques: str | None = None
```

Et dans l'appel `odoo.create_intervention(...)` du endpoint `create`, ajouter les deux arguments (après `schedule=...`) :

```python
            schedule=f"{body.start_time} – {body.end_time}",
            resource_ids=body.resource_ids, remarques=body.remarques,
```

S'assurer que `ProductLine` (Task 2) a bien `billable: bool = False` aussi pour `NewIntervention.products` (même classe, déjà fait).

- [ ] **Step 6: Lancer, vérifier le succès + non-régression**

Run: `cd backend && .venv/bin/python -m pytest`
Expected: tous verts (5 nouveaux + 28 existants).

- [ ] **Step 7: ⚠️ Prévenir l'utilisateur puis commit**

```bash
git add backend/app/odoo.py backend/app/routers/interventions.py backend/tests/test_interventions_report.py
git commit -m "feat(api): worksheet Remarques + resource_id slot + facturation par ligne billable"
```

---

## Task 4: Frontend — `renderReport(root, ctx)` unifié (rendu)

**Files:**
- Modify: `frontend/js/screens/report.js`

**Interfaces:**
- Consumes: `GET /resources` (Task 1), `GET /products/search`, `GET /report-types`, `GET /report-tags`.
- Produces: `renderReport(root, ctx)` où `ctx = { slot?, create?, autoStart?, onDone? }`. En mode `create`, `slot` est synthétique `{ id:null, label:"Nouvelle intervention", partner_id:null }`.

- [ ] **Step 1: Adapter la signature et le contexte**

Dans `report.js`, remplacer l'en-tête de `renderReport` :

```javascript
export async function renderReport(root, ctx = {}) {
  const create = !!ctx.create;
  const slot = ctx.slot || { id: null, label: create ? "Nouvelle intervention" : "Intervention", partner_id: null };
  const onDone = ctx.onDone || (() => {});
  const opts = { autoStart: !!ctx.autoStart };

  let types = [];
  try { types = await api("/report-types"); } catch { types = []; }
  let tags = [];
  try { tags = await api("/report-tags"); } catch { tags = []; }
  if (!tags.length) tags = [{ id: 67, name: "à facturer" }, { id: 80, name: "SAV SP" }, { id: 81, name: "SAV client" }];
  let resources = [];
  try { resources = await api("/resources"); } catch {}

  const meEmp = (profile.get() || {}).hr_employee_id || null;
  const slotWorkers = Array.isArray(slot.employee_ids) ? slot.employee_ids.map(Number) : [];
  const state = {
    type: null, photos: [], start: null, end: null, timer: null, products: [], tags: [], next: "rien",
    status: null, signed: false,
    workers: slotWorkers.length ? [...slotWorkers] : (meEmp ? [meEmp] : []),  // employee_ids
    resources: [],                                                            // resource_ids (mode create)
  };
```

(Le reste du corps est modifié dans les steps suivants ; les anciens appels `api("/employees")` et la variable `employees`/`meId` sont remplacés par `resources`/`meEmp`.)

- [ ] **Step 2: Client conditionnel + statut + remarques dans le HTML**

Dans le template `root.innerHTML`, remplacer le bloc d'en-tête (titre + `clientCard`) par un rendu conditionnel client, et insérer Statut tout en haut :

```javascript
    <button class="btn secondary" id="r-back" style="width:auto;min-height:40px;margin-bottom:14px">‹ Annuler</button>
    <h2 style="margin-top:0">Rapport d'intervention</h2>
    ${create ? "" : `<p style="color:var(--muted);margin:.2rem 0 16px">${escapeHtml(slot.label || "Intervention")}</p>`}
    ${create ? clientEditable() : clientCard(slot)}
    <p class="form-error" id="r-error"></p>

    <div class="card"><strong>Statut <span style="color:var(--danger)">*</span></strong>
      <div id="r-status" style="display:flex;gap:10px;margin-top:10px">
        <button type="button" class="chip" data-status="done" style="flex:1;min-height:50px;justify-content:center">${icon("check", "icon-sm")} Tâche terminée</button>
        <button type="button" class="chip" data-status="todo" style="flex:1;min-height:50px;justify-content:center">${icon("alert", "icon-sm")} Tâche à terminer</button>
      </div></div>
```

Ajouter une carte « Remarques » juste avant la carte Signature :

```javascript
    <div class="field"><label>Remarques</label>
      <textarea id="r-remarques" rows="2" placeholder="Remarque libre (interne)…"
        style="width:100%;border:1px solid var(--line);border-radius:12px;padding:12px;font-size:1rem"></textarea></div>
```

- [ ] **Step 3: Ajouter le helper `clientEditable()` + handlers client (mode create)**

En bas de `report.js` (à côté de `clientCard`), ajouter :

```javascript
// Saisie client (mode create) : recherche Odoo, texte libre accepté.
function clientEditable() {
  return `<div class="card"><strong>Client <span style="color:var(--danger)">*</span></strong>
    <input id="r-client" type="text" autocomplete="off" placeholder="Nom du client (recherche Odoo ou libre)…"
      style="width:100%;min-height:46px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font-size:1rem;margin-top:8px" />
    <div id="r-client-results"></div><input type="hidden" id="r-partner-id" />
    <div style="display:flex;gap:10px;margin-top:10px">
      <div class="field" style="flex:1;margin:0"><label>Date</label><input id="r-date" type="date" required /></div>
      <div class="field" style="flex:1;margin:0"><label>Début</label><input id="r-start-t" type="time" value="08:00" required /></div>
      <div class="field" style="flex:1;margin:0"><label>Fin</label><input id="r-end-t" type="time" value="10:00" required /></div>
    </div>
    <div style="font-size:.74rem;color:var(--muted);margin-top:4px">Client non trouvé = accepté en texte libre (créé seulement si facturation).</div>
  </div>`;
}
```

Dans le corps de `renderReport`, après le wiring existant, ajouter le handler de recherche client (mode create uniquement) :

```javascript
  if (create) {
    const todayISO = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}-${String(n.getDate()).padStart(2,"0")}`; };
    const cdate = root.querySelector("#r-date"); if (cdate) cdate.value = todayISO();
    const ci = root.querySelector("#r-client"), cres = root.querySelector("#r-client-results"), cpid = root.querySelector("#r-partner-id");
    let ctmr = null;
    ci.addEventListener("input", () => {
      cpid.value = ""; clearTimeout(ctmr);
      const q = ci.value.trim(); if (q.length < 2) { cres.innerHTML = ""; return; }
      ctmr = setTimeout(async () => {
        try {
          const list = await api(`/partners/search?q=${encodeURIComponent(q)}`);
          cres.innerHTML = list.map(p => `<div class="card" data-pid="${p.id}" data-name="${escapeHtml(p.name)}" style="cursor:pointer;padding:10px;margin:6px 0"><strong>${escapeHtml(p.name)}</strong><span style="color:var(--muted);font-size:.8rem"> ${escapeHtml(p.city || "")}</span></div>`).join("");
        } catch { cres.innerHTML = ""; }
      }, 300);
    });
    cres.addEventListener("click", (e) => {
      const c = e.target.closest("[data-pid]");
      if (c) { cpid.value = c.dataset.pid; ci.value = c.dataset.name; cres.innerHTML = ""; }
    });
  }
```

- [ ] **Step 4: Vérifier la syntaxe**

Run: `cd frontend && node --check js/screens/report.js`
Expected: pas d'erreur (sortie vide).

- [ ] **Step 5: Commit**

```bash
git add frontend/js/screens/report.js
git commit -m "feat(report): renderReport(ctx) unifie - client conditionnel, statut, remarques"
```

---

## Task 5: Frontend — Équipe = ressources + temps adaptatif + pièces/produits facturables

**Files:**
- Modify: `frontend/js/screens/report.js`

**Interfaces:**
- Consumes: `state.resources` (resource_ids), `state.workers` (employee_ids), `resources` (liste `/resources`).
- Produces: payload partiel `{ worker_ids, resource_ids, parts, products, status, remarques, schedule, hours }`.

- [ ] **Step 1: Picker Équipe sur ressources**

Remplacer le bloc « Équipe sur le chantier » (les chips `data-worker`) par un rendu sur `resources`, valeur = resource_id, avec employee_id en data :

```javascript
    <div class="card">
      <strong>Équipe sur le chantier</strong>
      <div style="font-size:.74rem;color:var(--muted);margin-top:2px">Qui a travaillé sur ce chantier ?</div>
      <div id="r-workers" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
        ${resources.map(r => `<button type="button" class="chip${state.workers.includes(r.employee_id) ? " active" : ""}" data-rid="${r.resource_id}" data-eid="${r.employee_id ?? ""}">${escapeHtml(r.name)}</button>`).join("") || `<span style="color:var(--muted);font-size:.85rem">Liste indisponible</span>`}
      </div>
    </div>
```

Remplacer le handler `#r-workers` :

```javascript
  const workersWrap = root.querySelector("#r-workers");
  workersWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rid]"); if (!b) return;
    const rid = Number(b.dataset.rid);
    const eid = b.dataset.eid ? Number(b.dataset.eid) : null;
    const on = b.classList.toggle("active");
    const setOf = (arr, v) => { const i = arr.indexOf(v); if (on && i < 0) arr.push(v); if (!on && i >= 0) arr.splice(i, 1); };
    setOf(state.resources, rid);
    if (eid != null) setOf(state.workers, eid);
  });
```

(Initialiser `state.resources` depuis le slot si présent : laisser vide par défaut — l'utilisateur (re)sélectionne ; les employee_ids pré-cochés restent via `state.workers`.)

- [ ] **Step 2: Temps adaptatif (chrono live / manuel sinon)**

Remplacer la carte « Temps d'intervention » par un rendu conditionnel :

```javascript
    ${opts.autoStart ? `
    <div class="card" style="text-align:center">
      <strong>Temps d'intervention</strong>
      <div id="r-clock" style="font-size:2rem;font-weight:700;margin:.3rem 0">00:00:00</div>
      <button class="btn" id="r-timer" style="width:auto;padding:0 22px">${icon("play", "icon-sm")} Démarrer</button>
    </div>` : (create ? "" : `
    <div class="card"><strong>Horaire</strong>
      <div style="display:flex;gap:10px;margin-top:10px">
        <div class="field" style="flex:1;margin:0"><label>Début</label><input id="r-start-t" type="time" value="${hm(slot.start_datetime) || "08:00"}" /></div>
        <div class="field" style="flex:1;margin:0"><label>Fin</label><input id="r-end-t" type="time" value="${hm(slot.end_datetime) || "10:00"}" /></div>
      </div></div>`)}
```

Ajouter le helper `hm` en haut de `report.js` (sous les imports) s'il n'existe pas :

```javascript
const hm = (dt) => (dt ? String(dt).slice(11, 16) : "");
```

Garder le bloc timer existant mais le rendre conditionnel (ne s'exécute que si `#r-timer` présent) :

```javascript
  const timerBtn = root.querySelector("#r-timer");
  if (timerBtn) {
    const clockEl = root.querySelector("#r-clock");
    function startChrono() {
      if (state.start) return;
      state.start = Date.now();
      timerBtn.innerHTML = `${icon("stop", "icon-sm")} Terminer`;
      timerBtn.style.background = "var(--danger)";
      state.timer = setInterval(() => { clockEl.textContent = fmtClock(Math.floor((Date.now() - state.start) / 1000)); }, 1000);
    }
    function stopChrono() {
      if (!state.start || state.end) return;
      state.end = Date.now();
      clearInterval(state.timer); state.timer = null;
      timerBtn.innerHTML = `${icon("check", "icon-sm")} Temps enregistré`;
      timerBtn.disabled = true;
    }
    timerBtn.addEventListener("click", () => { if (!state.start) startChrono(); else stopChrono(); });
    if (opts.autoStart) startChrono();
  }
```

- [ ] **Step 3: Remplacer « Pièces utilisées » par la liste pièces/produits facturables**

Remplacer toute la carte « Pièces utilisées » (et son JS `renderParts`/`addPart`) par une liste de lignes produits avec case « à facturer » + remise/TVA globales :

```javascript
    <div class="card">
      <strong>Pièces / produits</strong>
      <div id="r-plines" style="margin:10px 0"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:flex-end">
        <div style="flex:1 1 100%;position:relative">
          <input id="rp-name" type="text" autocomplete="off" placeholder="Pièce/produit (recherche Odoo ou libre)…" style="width:100%;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 10px;font-size:.95rem">
          <div id="rp-results"></div>
        </div>
        <input id="rp-qty" type="number" min="0" step="any" value="1" aria-label="Quantité" style="width:62px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;text-align:center">
        <input id="rp-price" type="number" min="0" step="any" placeholder="Prix" aria-label="Prix" style="width:84px;min-height:44px;border:1px solid var(--line);border-radius:10px;padding:0 8px;text-align:right">
        <label style="display:flex;align-items:center;gap:4px;font-size:.8rem;color:var(--muted)"><input id="rp-bill" type="checkbox" style="width:18px;height:18px;accent-color:var(--aqua-dark)">à facturer</label>
        <button type="button" class="btn" id="rp-add" style="width:auto;min-height:44px;padding:0 16px">${icon("plus")}</button>
      </div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <label style="flex:1;font-size:.8rem;color:var(--muted)">Remise %<input id="rp-disc" type="number" min="0" step="any" value="0" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin-top:4px"></label>
        <label style="flex:1;font-size:.8rem;color:var(--muted)">TVA %<input id="rp-vat" type="number" min="0" step="any" value="8.1" style="width:100%;min-height:40px;border:1px solid var(--line);border-radius:10px;padding:0 8px;margin-top:4px"></label>
      </div>
      <div id="rp-totals" style="margin-top:10px"></div>
    </div>
```

JS associé (placer là où était la logique « parts ») :

```javascript
  const fmtCHF = (n) => n.toLocaleString("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pName = root.querySelector("#rp-name"), pQty = root.querySelector("#rp-qty"), pPrice = root.querySelector("#rp-price");
  const pBill = root.querySelector("#rp-bill"), pResults = root.querySelector("#rp-results");
  const pLines = root.querySelector("#r-plines"), pTotals = root.querySelector("#rp-totals");
  const pDisc = root.querySelector("#rp-disc"), pVat = root.querySelector("#rp-vat");
  let selPid = null;
  function renderProducts() {
    pLines.innerHTML = state.products.length
      ? state.products.map((p, i) => {
          const lt = (Number(p.qty) || 0) * (Number(p.price) || 0);
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-top:1px solid var(--line)">
            <span style="flex:1;min-width:0">${escapeHtml(p.name)}${p.billable ? ` <span class="chip active" style="padding:1px 6px;font-size:.7rem">à facturer</span>` : ""}<span style="color:var(--muted);font-size:.8rem"> · ${Number(p.qty) || 0} × ${p.price != null ? fmtCHF(Number(p.price)) : "—"}</span></span>
            <button type="button" data-rmp="${i}" style="border:0;background:none;cursor:pointer;color:var(--muted);display:flex">${icon("x", "icon-sm")}</button>
          </div>`;
        }).join("")
      : `<p style="color:var(--muted);margin:0;font-size:.86rem">Aucune pièce ajoutée.</p>`;
    const bill = state.products.filter(p => p.billable);
    const subtotal = bill.reduce((s, p) => s + (Number(p.qty) || 0) * (Number(p.price) || 0), 0);
    const disc = Number(pDisc.value) || 0, vat = Number(pVat.value) || 0;
    const discAmt = subtotal * disc / 100, after = subtotal - discAmt, vatAmt = after * vat / 100, total = after + vatAmt;
    const line = (l, v, strong) => `<div style="display:flex;justify-content:space-between;${strong ? "font-weight:700;font-size:1.05rem;margin-top:4px;color:var(--navy)" : "color:var(--muted);font-size:.88rem"}"><span>${l}</span><span>${fmtCHF(v)} CHF</span></div>`;
    pTotals.innerHTML = bill.length ? line("Sous-total à facturer", subtotal) + (disc ? line(`Remise ${disc}%`, -discAmt) : "") + line(`TVA ${vat}%`, vatAmt) + line("Total", total, true) : "";
  }
  pDisc.addEventListener("input", renderProducts);
  pVat.addEventListener("input", renderProducts);
  root.querySelector("#rp-add").addEventListener("click", () => {
    const name = pName.value.trim(); if (!name) return;
    state.products.push({ name, qty: Number(pQty.value) || 1, price: pPrice.value !== "" ? Number(pPrice.value) : null, product_id: selPid, billable: pBill.checked });
    pName.value = ""; pQty.value = "1"; pPrice.value = ""; pBill.checked = false; pResults.innerHTML = ""; selPid = null; renderProducts(); pName.focus();
  });
  pLines.addEventListener("click", (e) => { const b = e.target.closest("[data-rmp]"); if (!b) return; state.products.splice(Number(b.dataset.rmp), 1); renderProducts(); });
  let pTmr = null;
  pName.addEventListener("input", () => {
    selPid = null; clearTimeout(pTmr); const q = pName.value.trim();
    if (q.length < 2) { pResults.innerHTML = ""; return; }
    pTmr = setTimeout(async () => {
      try {
        const list = await api(`/products/search?q=${encodeURIComponent(q)}`);
        pResults.innerHTML = list.map(p => `<div class="card" data-pid="${p.id}" data-pname="${escapeHtml(p.name)}" data-pprice="${p.list_price != null ? p.list_price : ""}" style="cursor:pointer;padding:8px 10px;margin:6px 0">${escapeHtml(p.name)}${p.list_price ? `<span style="color:var(--muted);font-size:.8rem"> · ${fmtCHF(p.list_price)} CHF</span>` : ""}</div>`).join("");
      } catch { pResults.innerHTML = ""; }
    }, 300);
  });
  pResults.addEventListener("click", (e) => { const d = e.target.closest("[data-pname]"); if (!d) return; pName.value = d.dataset.pname; selPid = d.dataset.pid ? Number(d.dataset.pid) : null; if (d.dataset.pprice) pPrice.value = d.dataset.pprice; pResults.innerHTML = ""; pPrice.focus(); });
  renderProducts();
```

- [ ] **Step 4: Handler statut**

Ajouter le handler du statut (avec les autres handlers de chips) :

```javascript
  const statusWrap = root.querySelector("#r-status");
  statusWrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    state.status = b.dataset.status;
    statusWrap.querySelectorAll(".chip").forEach(c => c.classList.toggle("active", c === b));
  });
```

- [ ] **Step 5: Vérifier la syntaxe**

Run: `cd frontend && node --check js/screens/report.js`
Expected: pas d'erreur.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/screens/report.js
git commit -m "feat(report): equipe=ressources, temps adaptatif, liste pieces/produits facturables"
```

---

## Task 6: Frontend — Routage du submit (slot → outbox ; create → /interventions)

**Files:**
- Modify: `frontend/js/screens/report.js`

**Interfaces:**
- Consumes: `enqueue(slot_id, payload)` + `sync()` (outbox), `api("/interventions", {method:"POST", body})`.
- Produces: rapport envoyé via le bon endpoint selon `create`.

- [ ] **Step 1: Réécrire le handler `#r-submit`**

Remplacer le handler submit existant par :

```javascript
  const err = root.querySelector("#r-error");
  const submit = root.querySelector("#r-submit");
  submit.addEventListener("click", async () => {
    err.textContent = "";
    if (!state.type) { err.textContent = "Choisis un type d'intervention."; return; }
    if (!state.status) { err.textContent = "Choisis le statut de la tâche."; return; }
    const photos = state.photos.filter(Boolean);
    if (photos.length < 2) { err.textContent = "Ajoute au moins 2 photos."; return; }

    const parts = state.products.map(p => p.name).filter(Boolean);
    const billable = state.products.filter(p => p.billable);
    const remarques = root.querySelector("#r-remarques").value.trim() || null;
    const notes = root.querySelector("#r-notes").value.trim() || null;
    const materials = root.querySelector("#r-materials").value.trim() || null;
    const discount = Number(root.querySelector("#rp-disc").value) || 0;
    const vat = Number(root.querySelector("#rp-vat").value) || 8.1;
    const signCv = root.querySelector("#r-sign");
    const signature = state.signed ? signCv.toDataURL("image/png") : null;
    const nextWhen = root.querySelector("#r-next-when");
    const next_action = state.next === "rien" ? null : state.next;
    const next_action_date = (state.next !== "rien" && nextWhen && nextWhen.value) ? nextWhen.value : null;

    submit.disabled = true; submit.innerHTML = `<span class="spinner"></span>`;
    try {
      if (create) {
        const cname = root.querySelector("#r-client").value.trim();
        if (!cname) { throw new Error("Indique un client (nom libre accepté)."); }
        const pid = root.querySelector("#r-partner-id").value;
        const body = {
          type: state.type, name: notes || "", materials,
          date: root.querySelector("#r-date").value,
          start_time: root.querySelector("#r-start-t").value,
          end_time: root.querySelector("#r-end-t").value,
          partner_id: pid ? Number(pid) : null, client_name: cname,
          photos, products: billable, discount, vat_rate: vat,
          tag_ids: state.tags, worker_ids: state.workers, resource_ids: state.resources,
          signature, status: state.status, remarques,
          next_action, next_action_date,
        };
        const res = await api("/interventions", { method: "POST", body });
        let msg = "Intervention créée";
        if (res && res.worksheet) msg += " · fiche remplie";
        if (res && res.invoice) msg += " · facture brouillon";
        onDone(msg);
      } else {
        // schedule/hours : depuis le chrono si présent, sinon depuis les heures saisies.
        let schedule = null, hours = null;
        if (state.start && state.end) {
          schedule = `${tHM(state.start)} – ${tHM(state.end)}`;
          hours = Number(((state.end - state.start) / 3600000).toFixed(2));
        } else {
          const st = root.querySelector("#r-start-t"), en = root.querySelector("#r-end-t");
          if (st && en && st.value && en.value) {
            schedule = `${st.value} – ${en.value}`;
            const [sh, sm] = st.value.split(":").map(Number), [eh, em] = en.value.split(":").map(Number);
            const diff = (eh * 60 + em) - (sh * 60 + sm);
            if (diff > 0) hours = Number((diff / 60).toFixed(2));
          }
        }
        const payload = {
          type: state.type, notes, materials, schedule, hours, photos, signature,
          parts, products: billable, discount, vat_rate: vat,
          tag_ids: state.tags, worker_ids: state.workers, resource_ids: state.resources,
          status: state.status, remarques, next_action, next_action_date,
        };
        await enqueue(slot.id, payload);
        const remaining = await sync();
        onDone(remaining > 0
          ? "Rapport enregistré — il sera envoyé dès le retour du réseau."
          : "Rapport envoyé");
      }
    } catch (e) {
      submit.disabled = false;
      submit.innerHTML = `${icon("check", "icon-sm")} Valider le rapport`;
      err.textContent = (e && e.message) ? e.message : "Impossible d'enregistrer le rapport.";
    }
  });
```

- [ ] **Step 2: Vérifier la syntaxe**

Run: `cd frontend && node --check js/screens/report.js`
Expected: pas d'erreur.

- [ ] **Step 3: Commit**

```bash
git add frontend/js/screens/report.js
git commit -m "feat(report): routage submit unifie (slot=outbox /report, create=/interventions)"
```

---

## Task 7: Frontend — Câbler les entrées, supprimer l'ancienne form, bump SW

**Files:**
- Modify: `frontend/js/screens/terrain.js`
- Modify: `frontend/js/screens/semaine.js`
- Modify: `frontend/js/screens/accueil.js` (vérif intent `new`)
- Modify: `frontend/sw.js`

**Interfaces:**
- Consumes: `renderReport(root, ctx)` (Tasks 4-6).

- [ ] **Step 1: `semaine.js` — clic créneau → `renderReport({slot})`**

Localiser l'appel `renderReport(` (ligne ~102) et l'adapter à la nouvelle signature. Exemple :

```javascript
import { renderReport } from "./report.js";
// ...
root.querySelectorAll("[data-slot]").forEach(el =>
  el.addEventListener("click", () => {
    const slotId = Number(el.dataset.slot);
    renderReport(root, { slot: { id: slotId }, onDone: () => semaine.render(root) });
  }));
```

> Si `renderReport` a besoin du détail du slot (label/partner/heures), récupérer d'abord `await api('/interventions/'+slotId)` et passer l'objet en `slot`. Garder le comportement existant (le slot était déjà passé partiellement).

- [ ] **Step 2: `terrain.js` — détail/Démarrer + supprimer `renderForm`**

Dans `renderDetail` (lignes ~163-165), adapter les deux appels :

```javascript
  root.querySelector("#do-start").addEventListener("click", () =>
    renderReport(root, { slot: { id: slotId, label: s.label, partner_id: s.partner_id, partner: s.partner, employee_ids: s.employee_ids, start_datetime: s.start_datetime, end_datetime: s.end_datetime }, autoStart: true, onDone: back }));
```

Et l'ouverture du rapport sans autoStart (le 2e appel) sans `autoStart`.

Supprimer entièrement la fonction `renderForm(root)` (lignes ~169-442) **et** remplacer le handler du bouton « + Nouvelle intervention » (`#iv-add`, ligne ~86) par :

```javascript
  root.querySelector("#iv-add").addEventListener("click", () =>
    renderReport(root, { create: true, onDone: () => terrain.render(root) }));
```

Adapter l'intent `new` du render (ajouté précédemment) :

```javascript
  async render(root, ctx) {
    if (ctx && ctx.intent === "new") { renderReport(root, { create: true, onDone: () => terrain.render(root) }); return; }
    // ... reste inchangé (coquille jour/semaine)
```

Vérifier que `import { renderReport } from "./report.js";` est présent (déjà importé).

- [ ] **Step 3: `accueil.js` — vérifier le raccourci**

Le raccourci « Mon intervention » envoie déjà `nav("terrain", "new")` (intent `new`). Aucune modif si Step 2 gère l'intent. Vérifier visuellement.

- [ ] **Step 4: Bump SW**

Dans `frontend/sw.js`, remplacer :

```javascript
const CACHE = "sp-app-shell-v46";
```

par :

```javascript
const CACHE = "sp-app-shell-v47";
```

- [ ] **Step 5: Vérifier la syntaxe de tout le JS modifié**

Run: `cd frontend && for f in js/screens/report.js js/screens/terrain.js js/screens/semaine.js js/screens/accueil.js sw.js; do node --check "$f" && echo "OK $f"; done`
Expected: `OK` pour chaque fichier.

- [ ] **Step 6: Commit**

```bash
git add frontend/js/screens/terrain.js frontend/js/screens/semaine.js frontend/js/screens/accueil.js frontend/sw.js
git commit -m "feat(report): entrees planning/onglet/accueil ouvrent la form unifiee + bump SW v47"
```

---

## Task 8: Vérification d'intégration + parité worksheet

**Files:** aucun (vérification manuelle + déploiement coordonné).

- [ ] **Step 1: Non-régression backend complète**

Run: `cd backend && .venv/bin/python -m pytest`
Expected: tous verts.

- [ ] **Step 2: Vérif syntaxe frontend complète**

Run: `cd frontend && for f in js/screens/*.js sw.js; do node --check "$f"; done; echo "done"`
Expected: `done` sans erreur.

- [ ] **Step 3: ⚠️ Coordination + déploiement**

Prévenir l'utilisateur (modifs backend). Déployer : rsync code + `sudo systemctl restart swiss-piscine-app` ; rsync frontend. Push `wip/v2-sprint-elie` via le compte SwissPiscine.

- [ ] **Step 4: Test manuel de parité**

Sur https://app.swiss-piscine.ch :
1. Planning → clic sur un créneau → remplir le rapport (type, statut, équipe, 1 pièce non facturable + 1 produit « à facturer », 2 photos, remarques, signature) → Valider.
2. Onglet Rapport → « + Nouvelle intervention » → même saisie + client.
3. Dans Odoo (Planning → créneau → onglet Fiche de travail) : vérifier que **les 11 champs** du worksheet sont remplis **à l'identique** dans les deux cas (dont *Remarques* et *Pièces utilisées* avec les 2 lignes).
4. Vérifier qu'une **facture brouillon** (`account.move`) est créée dans les deux cas pour la ligne « à facturer ».

Expected: worksheet identique champ par champ ; facture brouillon présente ; offline OK pour le rapport depuis le planning (couper le réseau → « sera envoyé dès le retour du réseau »).

---

## Self-Review (couverture spec)

- Form unique adaptative → Tasks 4-7 ✅
- Miroir 11 champs (dont Remarques) → Task 3 step 3 + parité Task 8 ✅
- Une liste pièces/produits + « à facturer » par ligne → Task 5 step 3 ✅
- Temps adaptatif (chrono/manuel) → Task 5 step 2 + Task 6 step 1 ✅
- Équipe = resource.resource (hybride : resource_id create) → Task 1 + Task 3 step 4 + Task 5 step 1 ✅
- Facture depuis le planning → Task 2 ✅
- Frontière offline (slot=outbox, create=online) → Task 6 step 1 ✅
- Backend additif + warn → Tasks 1-3 (étapes « prévenir l'utilisateur ») ✅
- Bump SW → Task 7 step 4 ✅
- Hors périmètre (round-trip, slot resource non réassigné, multi-société) → respecté (aucune tâche ne les touche) ✅
