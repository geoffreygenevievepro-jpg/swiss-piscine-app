# Design — Rapport d'intervention unifié (app SP ↔ worksheet Odoo)

**Date** : 2026-06-27
**Branche** : `wip/v2-sprint-elie`
**Statut** : design approuvé, à transformer en plan d'implémentation

## Problème

Il existe aujourd'hui **deux formulaires de rapport distincts**, avec deux endpoints et deux
modèles de données :

- **A — « Rapport d'intervention » (planning)** : `frontend/js/screens/report.js`
  → `renderReport(root, slot, onDone, opts)`. Ouvert au clic sur un créneau/tâche du Planning
  (`semaine.js`) ou sur une intervention du jour (`terrain.js` → « Démarrer l'intervention »).
  Rattaché à un `planning.slot` existant, client pré-rempli (lecture seule), chrono,
  **sans produits ni facture**. Endpoint `POST /interventions/{slot_id}/report` (via outbox, offline-safe).

- **B — Onglet « Rapport »** : `frontend/js/screens/terrain.js` → `renderForm(root)`
  (« Nouvelle intervention »). Crée un `planning.slot` de zéro, client en saisie libre/recherche,
  heures manuelles, **produits + remise + TVA → facture brouillon**. Endpoint `POST /interventions`
  (direct, pas d'offline).

**Objectif** : un **seul formulaire de rapport unifié**, adaptatif selon le contexte d'entrée,
qui soit le **miroir** du worksheet Odoo « Rapport d'intervention » (template 10) des deux côtés.

## Décisions de cadrage (verrouillées)

1. **Un seul formulaire qui s'adapte** au contexte d'entrée (slot existant vs création).
2. **Miroir = grille de champs commune** Odoo ↔ app (définie ci-dessous), écriture app → Odoo.
3. **Pièces/produits = une seule liste**, case « à facturer » optionnelle par ligne.
4. **Temps adaptatif** : chrono en live (depuis « Démarrer »), heures manuelles sinon.
5. **Équipe = `resource.resource` (hybride)** : picker sur les ressources planning, `resource_id`
   principal du slot = 1re ressource, équipe complète en worksheet.
6. **Approche** : front unifié maintenant + helper backend **additif** coordonné (warn avant
   chaque edit dans `odoo.py`, le fichier de la session multi-société).

## Architecture

`report.js` devient LE module de rapport unique : `renderReport(root, ctx)`. Le `ctx` décrit
l'entrée :

| Entrée | `ctx` | Client | Temps |
|---|---|---|---|
| Clic créneau/tâche dans Planning (`semaine.js`) | `{ slot }` | pré-rempli, **verrouillé** | **manuel, pré-rempli du slot** |
| Intervention du jour → « Démarrer » (`terrain.js`) | `{ slot, autoStart:true }` | pré-rempli, verrouillé | **chrono** |
| « + Nouvelle intervention » / raccourci accueil | `{ create:true }` | **éditable** (recherche/libre) | **manuel** (date+début+fin) |

- `terrain.js renderForm` (form B) est **supprimé** ; ses capacités (client éditable, produits,
  statut, heures manuelles) sont absorbées par le **mode `create`** de la form unifiée.
- `terrain.js` reste la **coquille** de l'onglet (liste du jour + bascule Jour/Semaine) ;
  tous ses chemins ouvrent `renderReport`.
- Résultat : Planning, onglet Rapport et raccourci accueil ouvrent **le même formulaire**.

## Formulaire unifié — sections

Miroir des 11 champs worksheet + extras. Champs conditionnels selon le mode, un seul rendu.

1. **Client** — carte verrouillée (mode `slot`) **ou** recherche Odoo / texte libre (mode `create`).
2. **Type d'intervention** (chips) → *Type d'intervention*.
3. **Statut** terminée / à terminer (toujours).
4. **Équipe sur le chantier** (multi, ressources Odoo) → *Équipe sur le chantier* (noms).
5. **Temps** — chrono (live) **ou** Date+Début+Fin (manuel) → *Temps d'intervention · Durée (h) · Horaire*.
6. **Tâches réalisées** (notes) → *Tâches réalisées*.
7. **Matériel utilisé** → *Matériel utilisé*.
8. **Pièces / produits** — une liste ; par ligne : nom (recherche Odoo/libre), qté, prix optionnel,
   case **« à facturer »**. Toutes les lignes → *Pièces utilisées* (texte) ; lignes cochées →
   **facture brouillon** (remise/TVA globales).
9. **Tags** (multi) → *Tags*.
10. **Prochaine action** + échéance → *Prochaine action*.
11. **Remarques** 🆕 (textarea) → champ *Remarques* d'Odoo, aujourd'hui jamais alimenté.
12. **Photos** (caméra/galerie) → pièces jointes.
13. **Signature client** → `worksheet_signature` / `worksheet_signed_by`.

## Envoi & offline

| Mode | Endpoint | Offline | Facture |
|---|---|---|---|
| `slot` | `POST /interventions/{slot_id}/report` via **outbox** | ✅ oui | 🆕 lignes cochées → facture |
| `create` | `POST /interventions` (direct) | ❌ online requis | ✅ déjà en place |

**Frontière offline** : rapport sur intervention déjà planifiée = offline-safe (cas terrain réel).
Création d'un chantier de zéro (client + slot + facture) = online requis (chevauchement,
création client, facture non fiables hors-ligne).

## Équipe = `resource.resource` (hybride)

- Picker = **ressources planning SP** (resource.resource, company 5), valeur = `resource_id`
  (+ résolution `employee_id` pour timesheet/worksheet).
- **Mode `create`** : `slot.resource_id` = 1re ressource sélectionnée ; équipe complète (noms) → worksheet.
- **Mode `slot`** : on **ne réassigne pas** le créneau planifié (garde son `resource_id` d'origine) ;
  équipe complète → worksheet. *(Choix réversible : on pourra écraser le `resource_id` en mode slot
  si souhaité plus tard.)*

## Modifs backend (toutes additives — warn avant chaque edit dans `odoo.py`)

1. **`list_resources()`** (nouvelle fonction) — ressources planning SP + mapping employé ;
   exposée par un **nouvel endpoint `GET /resources`** (l'existant `/employees` est laissé
   intact pour ne rien casser ; le formulaire de rapport consomme `/resources`).
2. **`submit_report`** — nouvelle **branche** : lignes « à facturer » + `slot.partner_id` →
   appelle le helper **existant** `create_draft_invoice` (`odoo.py:587`). Rien de réécrit.
3. **`Report`** (pydantic, `routers/interventions.py`) — champs ajoutés : `products[]`, `discount`,
   `vat_rate`, `status`, `remarques`, `resource_ids`.
4. **`create_intervention`** — pose `slot.resource_id` = 1re ressource (petite ligne).
5. **`_fill_worksheet`** — mappe *Remarques* ← `report['remarques']` (1 ligne).

Zéro suppression, zéro modif de la config multi-société. Coordination avec la session
`feat/multi-company` avant tout commit backend.

## Miroir worksheet — mapping final (template 10 « Rapport d'intervention »)

| # | Champ Odoo (worksheet) | Type | Source app (unifiée) |
|---|---|---|---|
| 1 | Type d'intervention | char | Type (chips) |
| 2 | Temps d'intervention | datetime | début du créneau |
| 3 | Durée (h) | float | chrono ou (fin − début) |
| 4 | Horaire | char | « HH:MM – HH:MM » |
| 5 | Équipe sur le chantier | char | noms des ressources sélectionnées |
| 6 | Tâches réalisées | text | notes |
| 7 | Matériel utilisé | text | matériel |
| 8 | Pièces utilisées | text | noms de toutes les lignes pièces/produits |
| 9 | Tags | char | tags |
| 10 | Prochaine action | char | prochaine action (+ échéance) |
| 11 | Remarques | text | 🆕 remarques |
| + | `worksheet_signature` / `worksheet_signed_by` | — | signature client |
| + | *(pièces jointes)* | — | photos |
| + | facture brouillon (`account.move`) | — | lignes cochées « à facturer » |

Avant : 10/11 champs alimentés (*Remarques* vide). Après : 11/11.

## Tests

- **pytest** (depuis `backend/`) : nouveau cas `submit_report` avec lignes facturables → facture
  brouillon ; *Remarques* rempli ; ressources. Les 28+ tests existants restent verts.
- **node --check** sur le JS modifié.
- **Parité manuelle** : rapport depuis Planning vs création depuis l'onglet → **worksheet
  identique** champ par champ ; facture brouillon générée quand des lignes sont cochées.

## Hors périmètre (YAGNI)

- Pas de relecture/édition d'un rapport existant depuis Odoo (round-trip) — écriture seule.
- Pas de création de chantier en offline.
- Pas de réassignation du `resource_id` en mode slot (réversible plus tard).
- Pas de modif de la config/logique multi-société.

## Déploiement

Front : bump `frontend/sw.js` (v46 → v47), rsync frontend, pas de restart.
Backend (modifs additives) : rsync code + `sudo systemctl restart swiss-piscine-app`, **après
coordination** avec la session multi-société. Push via le compte SwissPiscine.
