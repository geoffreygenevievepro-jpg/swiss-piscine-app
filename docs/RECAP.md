# Swiss Piscine — App équipe terrain · Récapitulatif complet

> Document de synthèse pour solliciter des idées d'amélioration.
> État au 2026-06-24. Repo : `swiss-piscine-app` (privé).

---

## 1. Contexte & objectif

**Swiss Piscine Sàrl** est une PME suisse d'installation de piscines (**7 employés**, dont **5 techniciens terrain**). Elle utilise **Odoo** (instance `heiwa.odoo.com`, multi-société, `company_id=5`) pour la gestion (CRM, planning, RH, paie).

**Problème** : Odoo est trop complexe pour les techniciens sur le terrain.

**Objectif** : une **app mobile (PWA) simple, robuste et sécurisée**, connectée à Odoo, qui expose seulement ce dont l'équipe a besoin au quotidien. Deux volets :
- **RH** : timbrage des heures, congés/maladie, fiches de salaire.
- **Terrain** : planning du jour, interventions, rapports liés au chantier, infos client.

**Référence/inspiration** : **Tipee** (logiciel RH suisse que l'entreprise utilise déjà) pour l'UX.

---

## 2. Architecture technique

```
PWA (téléphone)  ──HTTPS/JWT──►  API FastAPI (VPS)  ──JSON-RPC──►  Odoo (company_id=5)
- JS vanilla (sans build)        - auth maison PIN/JWT             - heiwa.odoo.com
- Service Worker (offline)       - SQLite (comptes)
- IndexedDB (file d'envoi)       - réutilise odoo_client.py
```

- **Frontend** : **PWA sans build**, JavaScript vanilla (ES modules), installable, **mode hors-ligne** (service worker + IndexedDB). Pas de framework (Node non installé sur le poste). 4 onglets.
- **Backend** : **FastAPI** (Python), réutilise un client Odoo JSON-RPC (`odoo_client.py`) vendoré. **Auth maison** : login + PIN (hashé PBKDF2), **JWT** (access 15 min + refresh rotatif), comptes en **SQLite** mappés sur `hr.employee` (→ pas de siège Odoo payant ; marche même pour les 3 techniciens sans compte Odoo).
- **Hébergement prévu** : VPS Infomaniak (nginx + PM2 + Let's Encrypt), sous-domaine `app.swiss-piscine.ch`. **⚠️ Pas encore déployé** (dev en local : backend `uvicorn:8000`, front `http.server:8080`).
- **Sécurité** : clé API Odoo uniquement côté serveur ; cloisonnement par employé ; rôle `manager` pour la validation ; verrouillage anti-bruteforce ; HTTPS en prod.

---

## 3. Intégration Odoo (mapping données → modules natifs)

| Fonction app | Module / modèle Odoo | Sens |
|---|---|---|
| Timbrage entrée/sortie (+ géoloc) | `hr.attendance` (`check_in/out`, `in/out_latitude/longitude`) | écriture |
| Résumé d'heures (réalisé/dû/solde) | `hr.attendance.worked_hours` + `resource.calendar` (42,5 h/sem) | lecture |
| Pointage projet (rentabilité) | `account.analytic.line` (timesheet) | écriture |
| Interventions planifiées | `planning.slot` (module Planning) — filtré par `employee_ids` | lecture / création |
| Rapport d'intervention | note `message_post` sur `project.task` + `ir.attachment` (photos/signature) | écriture |
| Soldes congés | `hr.work.entry.type.virtual_remaining_leaves` (contexte employé) | lecture |
| Demande de congé | `hr.leave` (`work_entry_type_id`, `request_date_from/to`) | écriture |
| Validation manager | `hr.leave.action_approve` / `action_refuse` | écriture |
| Fiches de salaire | `hr.payslip` (`net_wage`) + PDF en `ir.attachment` | lecture |
| Absences équipe / grille | `hr.leave` validés | lecture |
| Profil (avatar, taux, parcours) | `hr.employee` (`image_256`, `resource_calendar_id`, `hr.resume.line`) | lecture |

**Notes Odoo 19 importantes** : le « type de congé » n'est plus `hr.leave.type` (supprimé) mais `hr.work.entry.type` ; `res.partner` n'a plus de champ `mobile` ; `planning.slot` utilise `employee_ids` (m2m). Le module **Field Service n'est pas installé** → le rapport vit dans le chatter d'une `project.task` (log, pas de données structurées/filtrables).

---

## 4. Fonctionnalités par onglet

### 🧰 Terrain
- **Sélecteur de jour** (flèches + datepicker, défaut = aujourd'hui).
- Liste des **interventions planifiées** du jour (horaire, client, statut couleur).
- **Détail** d'une intervention (client, adresse, boutons Appeler / Itinéraire).
- **Créer une intervention** : type (menu déroulant), **client obligatoire** (recherche Odoo), date, début/fin, description, **photos**.
- **Rapport d'intervention** (depuis le détail) : type, chrono Démarrer/Terminer, notes, matériel, **photos**, **signature tactile** → remonte dans Odoo. **File hors-ligne** (IndexedDB) : envoyé dès le retour du réseau, badge « X en attente ».

### 🕐 Mes heures (calqué sur Tipee)
- **Timbrage contextuel** (Start/Stop, **géoloc ponctuelle** au pointage, gestion des pauses via Reprendre, détail des pointages du jour).
- **Navigation par période** : Jour / Semaine / Mois (flèches ‹ ›).
- **Deux demi-jauges** : Solde de travail (réalisé − dû) et Vacances (jours restants).
- **Tableau jour par jour** : Date · Réalisé · À faire · Solde.
- **Mes congés** (liste + demande sur liste de types curée avec icônes).

### 👤 Moi
- Profil (avatar, taux d'activité, contact).
- **Validation manager** (rôle `manager`) : « À valider » → approuver/refuser les congés de l'équipe en un clic.
- Fiches de salaire (liste + téléchargement PDF).
- Parcours & compétences.

### 📅 Semaine
- Planning de la semaine (navigable) jour par jour.
- **Grille équipe** : qui travaille / est absent chaque jour.

---

## 5. Robustesse & sécurité (déjà en place)

- **Offline-first** : rapports mis en file (IndexedDB) et rejoués à la reconnexion ; lecture en cache du dernier état (GET) ; badge de sync explicite.
- **Auth** : PIN hashé PBKDF2, JWT access court + refresh rotatif, verrouillage après 5 échecs, retour auto au login si session expirée.
- **Cloisonnement** : chaque employé n'accède qu'à ses données (filtrage serveur) ; `company_id=5` forcé ; endpoints manager protégés par rôle.
- **Vie privée** : géoloc capturée **uniquement** au moment du pointage, jamais de suivi continu.
- **Erreurs** : messages génériques côté client + log serveur (pas de fuite Odoo).

---

## 6. Design

Identité reprise du **site web Swiss Piscine** : polices **Sora + Inter**, palette **navy `#0b2e3f` / aqua `#1fa9b8` / sable `#f6f4ef`**, boutons pilule à ombre, cartes ombrées, en-tête en dégradé. Icône PWA brandée (navy + vague aqua + « SP »).

---

## 7. État actuel

- **Sprints 0→4 terminés** + lots d'amélioration UX (Tipee) + remaniement de structure.
- **Toutes les lectures Odoo testées** en conditions réelles.
- **Les écritures Odoo** (pointage, création d'intervention, rapport, demande/validation de congé) sont implémentées mais **doivent être validées par un vrai usage** (politique : pas d'écriture Odoo de test sans accord).
- **Pas encore déployé** (test en local uniquement, pas encore sur téléphone réel).

---

## 8. Ce qui reste / pistes ouvertes (idées bienvenues)

**Fonctionnel (demandé, pas encore fait)**
- Justificatif (photo) joint à une demande de congé.
- **Calendrier d'absences** visuel (mois).
- **Notes de frais** (`hr.expense`) : photo du reçu → Odoo.
- **Vidéo** à la création d'intervention (photos OK, vidéo plus lourde).
- Login plus léché (afficher/masquer le mot de passe, multi-société comme Tipee).
- Grille équipe plus riche (cellules colorées type « HC », taux d'activité).

**Technique / production**
- **Déploiement VPS** + HTTPS, puis test mobile réel.
- **Notifications push** (Web Push / VAPID + émetteur serveur).
- En prod : **clé API Odoo dédiée** au lieu du mot de passe ; secret JWT fixe.
- **Config Odoo** : 5/7 employés n'ont **pas d'approbateur de congés** (`leave_manager_id`) → les demandes ne sont routées vers personne.

**Limites connues (candidates à amélioration)**
- **Toutes les écritures passent par un compte admin (uid 142)** → les notes/pointages apparaissent au nom de l'admin, pas du technicien réel.
- **Rapport = log chatter** (pas structuré/filtrable) ; envisager Field Service ou un modèle custom si on veut des statistiques.
- **PIN à 6 chiffres** (entropie faible, compensée par le verrouillage).
- **Heures dues** approximées (hours_per_week / 5) ; ne tient pas compte des jours fériés / contrats spécifiques.
- Pas de tests automatisés ; pas de limite de taille sur l'upload photo.

---

## 9. Historique des demandes (chronologique)

1. Cadrer + créer l'app (PWA, auth maison, RH + Terrain en parallèle).
2. Repo dédié `swiss-piscine-app` (compte perso GitHub).
3. Sprints : fondations → timbrage → interventions (Planning) → rapport offline → RH (soldes/congés/paie) → Semaine.
4. Revue qualité + corrections de robustesse (offline, session, dates).
5. Benchmark **Tipee** (captures) + alignement **Odoo Employees** → lot UX (jauges, badges, types curés, profil) + validation manager + géoloc + pauses.
6. **Design** repris du site Swiss Piscine + icône brandée.
7. **Remaniement** : « Mes heures » (résumé Tipee), Terrain par date + création enrichie.

> Demandes restantes explicites : justificatif congé, calendrier absences, **Notes de frais**, vidéo, login léché.
