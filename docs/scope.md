# App Équipe Swiss Piscine — Document de cadrage (scope)

> Application mobile (PWA) pour les équipes terrain de Swiss Piscine, connectée à Odoo.
> Objectif : remplacer l'usage direct d'Odoo (trop complexe pour les techniciens) par une
> interface ultra-simple, robuste et sécurisée. Rédigé le 2026-06-23.

---

## 1. Objectifs & utilisateurs

**Deux volets dans une seule app :**
- **RH** : timbrage des heures, congés / maladie, consultation fiches de salaire & certifications.
- **Terrain** : planning de la semaine, interventions du jour, rapport d'intervention lié au
  chantier, infos client (adresse, contact).

**Utilisateurs : 7 employés company_id=5**
| Employé | Rôle | Compte Odoo (user_id) |
|---|---|---|
| Agostini Claudio | Responsable technique | 191 |
| Agostini Roberto | Technicien | 192 |
| Bertrand Loïc | Aide technicien | 193 |
| Arnaud Sapin | Technicien | — (aucun) |
| Perretta Roberto | Technicien | — (aucun) |
| Niyongira Fanny | Employée de commerce | 13 |
| Elie Alexandre | Direction | — (aucun) |

→ 3 employés n'ont pas de compte Odoo : **l'auth maison mappée sur `hr.employee` évite de payer
des sièges Odoo supplémentaires.**

---

## 2. Décisions actées (validées avec Geoffrey le 2026-06-23)

1. **Type d'app : PWA** (web installable, pas d'app store, mode hors-ligne, un seul code).
2. **MVP : RH + Terrain en parallèle**.
3. **Auth maison** : login + PIN par employé, mappé sur `hr.employee` (pas de siège Odoo payant).

---

## 3. Mapping fonctionnel → Odoo

Tous les modules nécessaires sont **déjà installés** (Odoo Enterprise, vérifié le 2026-06-23).

| Fonction app | Modèle Odoo | Champs / méthode clés | Sens |
|---|---|---|---|
| Timbrage entrée/sortie | `hr.attendance` | `employee_id`, `check_in`, `check_out` | écriture |
| Pointage projet (rentabilité) | `account.analytic.line` (timesheet) | `task_id`, `unit_amount`, `employee_id` | écriture |
| Demande congé / maladie | `hr.leave` | `holiday_status_id`, `date_from`, `date_to` | écriture |
| Solde de congés | `hr.leave.allocation` + soldes calculés | `number_of_days` | lecture |
| Fiche de salaire | `hr.payslip` (+ PDF `ir.attachment`) | `payslip_run_id`, PDF | lecture |
| Certifications / compétences | `hr.skill`, `hr.resume.line` | — | lecture |
| Planning de la semaine | `planning.slot` | `start_datetime`, `resource_id` | lecture |
| Interventions du jour | `project.task` | `partner_id`, `date_deadline`, `stage_id` | lecture / écriture |
| Rapport d'intervention | `project.task` + `ir.attachment` (photos) | worksheet, notes, signature | écriture |
| Chantier | `project.project` | `partner_id` | lecture |
| Infos client | `res.partner` | `street`, `city`, `phone`, `mobile` | lecture |

**Non installé** : `industry_fsm` (Field Service). Pas nécessaire — `project` + `planning`
couvrent le besoin. À réévaluer seulement si on veut les worksheets natifs Odoo.

**Règle métier** : le technicien ne facture jamais. Il saisit temps + matériel ; le bureau
(Fanny / Geoffrey) facture dans Odoo.

---

## 4. Architecture technique

```
┌─────────────────────────────┐      HTTPS / JWT       ┌──────────────────────────┐
│   PWA (téléphone technicien) │ ───────────────────▶  │  API terrain (VPS)        │
│   - Service Worker (offline) │ ◀───────────────────  │  FastAPI, port 3011       │
│   - IndexedDB (file de sync) │                        │  - auth maison (PIN/JWT)  │
│   - 4 onglets                │                        │  - SQLite (users, tokens) │
└─────────────────────────────┘                        │  - réutilise odoo_client  │
                                                        └────────────┬─────────────┘
                                                          clé API Odoo (côté serveur)
                                                                     ▼
                                                        ┌──────────────────────────┐
                                                        │  Odoo heiwa.odoo.com      │
                                                        │  company_id=5 (JSON-RPC)  │
                                                        └──────────────────────────┘
```

**Principes :**
- La clé API Odoo **ne quitte jamais le serveur**. Le téléphone ne parle qu'à l'API terrain.
- L'API terrain **réutilise `odoo_client.py`** (déjà robuste : audit log, gestion erreurs).
- **Offline-first** : toute action (pointage, rapport) est d'abord écrite dans IndexedDB, puis
  poussée vers l'API quand le réseau revient. Badge + compteur de sync explicites (jamais de
  synchro silencieuse).
- Hébergement : nouveau sous-domaine `app.swiss-piscine.ch` (ou `equipe.swiss-piscine.ch`),
  nginx + Let's Encrypt, nouveau service PM2 pour FastAPI, intégré au `deploy.sh` existant.

**Stack proposée** (ajustable) :
- Frontend : **Vite + React + TypeScript**, **Workbox** (PWA/service worker), **Dexie**
  (IndexedDB), design system CSS existant adapté (navy/aqua, mobile-first).
- Backend : **Python FastAPI** + `odoo_client.py`, **JWT** (access court + refresh), **SQLite**
  pour les comptes employés (login, hash PIN, role, hr_employee_id) et les refresh tokens.
- Photos des rapports → uploadées en `ir.attachment` rattachées à la `project.task`.

---

## 5. UX & navigation (issu du benchmark Tipee / Synchroteam / Kizeo / Factorial)

**Barre d'onglets en bas, 4 onglets.** Profondeur max 2 niveaux. Terrain par défaut au lancement.
Badge de sync offline toujours visible en en-tête.

```
TERRAIN (défaut) │ POINTER │ MOI │ SEMAINE
```

- **TERRAIN** → « Ma journée » : interventions du jour groupées par statut (3 max : à faire /
  en cours / terminé, code couleur gris/bleu/vert), GPS + appel client one-touch.
  → Détail intervention : infos client pré-remplies depuis Odoo + historique chantier ;
  gros bouton **Démarrer → Terminer** (Démarrer = démarre le pointage projet) ;
  rapport (worksheet figé selon type : mise en service / entretien / dépannage / hivernage),
  champs obligatoires bloquants en rouge, photos annotables, signature client, preview PDF.
- **POINTER** → gros **bouton de timbrage contextuel** (affiche Entrée OU Sortie selon l'état,
  + Pause), confirmation visuelle (nom + heures cumulées du jour). Écrit dans `hr.attendance`.
- **MOI** → jauges de soldes (heures +/-, vacances) ; mes congés + **demander un congé**
  (3 champs, solde affiché en direct, 1 validateur) ; mes documents (fiches de salaire, certifs).
- **SEMAINE** → planning de la semaine (lecture seule) + calendrier équipe (qui est absent).

**14 patterns UX retenus** : bouton de timbrage contextuel · raccourci pointage · confirmation
visuelle · jauges de solde · compteur congés avant demande · congé en 3 champs · détection des
oublis avec correction (pas de blocage) · rappels push · géoloc GPS **ponctuelle au seul moment
du timbrage** (jamais de tracking continu) · « Ma journée » par statut · bouton d'action unique
bas d'écran · sélection client → pré-remplissage Odoo · champs obligatoires bloquants + worksheets
figés · offline avec badge + compteur explicite.

---

## 6. Sécurité & robustesse

- **HTTPS** partout (Let's Encrypt). Clé API Odoo uniquement côté serveur.
- **Auth** : login + PIN (6 chiffres), hash Argon2/bcrypt en SQLite ; **JWT** access court
  (~15 min) + refresh token rotatif (patron déjà présent dans le MCP). Verrouillage après N
  échecs (rate limiting, déjà présent dans `lead-api`/MCP).
- **Cloisonnement** : chaque employé n'accède qu'à SES données (filtrage `employee_id` côté
  serveur, jamais côté client). `company_id=5` forcé en dur.
- **Audit log** (déjà dans `odoo_client.py`) sur toutes les écritures Odoo.
- **Vie privée** : pas de tracking GPS continu — position capturée uniquement à l'instant du
  pointage, et seulement si activé (argument d'adhésion de l'équipe).
- **Robustesse offline** : toute action mise en file dans IndexedDB, rejouée à la reconnexion,
  idempotence côté serveur (éviter les doublons de pointage). Tests offline sérieux (le point
  le plus délicat d'une PWA).

---

## 7. Feuille de route (phasage)

| Sprint | Contenu | Vertical slice / preuve |
|---|---|---|
| **0 — Fondations** | Structure repo, shell PWA (4 onglets), API FastAPI + auth maison (login/PIN, JWT), connexion Odoo, déploiement VPS + sous-domaine HTTPS | Login fonctionnel sur le téléphone |
| **1 — Pointer + Ma journée** | Timbrage `hr.attendance` (bouton contextuel) ; « Ma journée » (`project.task` du jour + infos client) | Les 2 usages quotidiens en ligne |
| **2 — Rapport d'intervention** | Worksheets figés, photos → `ir.attachment`, signature, Démarrer/Terminer = timer, file offline | Un rapport complet remonte dans Odoo |
| **3 — Moi (RH)** | Soldes, demande de congé (`hr.leave`), documents (fiches salaire, certifs) | Volet RH employé complet |
| **4 — Semaine + durcissement** | Planning semaine + calendrier équipe, rappels push, durcissement & tests offline | App stable, prête prod |

---

## 8. Points ouverts / à décider plus tard

- Nom & sous-domaine définitifs de l'app.
- Stockage des photos : `ir.attachment` Odoo (retenu) vs Supabase Storage (déjà provisionné).
- Badgeuse partagée au dépôt (un device, PIN par employé) — à confirmer selon l'organisation.
- Notifications push iOS (PWA limité avant iOS 16.4 ; OK au-delà).
- Validation des congés : 1 seul validateur (Geoffrey) confirmé ?
