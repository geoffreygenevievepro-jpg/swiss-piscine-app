# App RH multi-société — design (approche A)

Date : 2026-06-27
Statut : design validé, prêt pour plan d'implémentation
Repo : `geoffreygenevievepro-jpg/swiss-piscine-app`, branche `feat/multi-company` (worktree `~/swiss-piscine-multicompany`)

## Problème / Objectif

L'app RH/Terrain est aujourd'hui **branchée en dur sur Swiss Piscine** (`settings.company_id = 5`). On veut **une seule app** qui serve **plusieurs sociétés du groupe Heiwa** (Elie Paysage, Swiss Elite Rénovation, Heiwa Cleaning, Heiwa Solution, … + Swiss Piscine), chacune avec **ses onglets activés** et **son identité visuelle** (nom, logo, couleur) — sans dupliquer l'app.

**Approche A** : un seul code, un seul déploiement. À la connexion, l'app lit la **société de l'employé** dans Odoo et s'adapte (données, onglets, thème). Mêmes fonctionnalités pour toutes ; on **active/désactive** par société (mécanisme déjà en place, Lot 2).

## Décisions validées
- Une seule app, **société dérivée par employé** (`hr.employee.company_id` d'Odoo).
- **Onglets par société** : déjà câblés via `app_rh_company_config.enabled_tabs` (vue.heiwa) → `effective_tabs` → menu. Rien à recoder.
- **Thème par société** : logo tiré d'**Odoo** (`res.company.logo`), nom de la société, **couleur d'accent** réglable dans vue.heiwa.
- **Seed piloté** par les sociétés activées dans vue.heiwa.
- Fonctionnalités **trop spécifiques SP** (Rapport « Je fais » → fiche de chantier/facture, template worksheet id 10) restent des **onglets SP-only** : les autres sociétés ne les activent pas. Le refactor « société par employé » porte sur les écrans **universels** (pointage, congés, planning, mes heures, notes de frais, documents, annonce, vue admin).

## Architecture

### 1. Société par employé (backend)
- **SQLite** : ajouter `company_id INTEGER` à la table `employees` (rempli au seed depuis Odoo). Migration idempotente (`ALTER TABLE ... ADD COLUMN`).
- **Résolution** : la société d'un employé = `emp["company_id"]` (depuis sa ligne SQLite). Helper de repli `odoo.employee_company_id(hr_id)` (déjà présent) si absent.
- **Dé-câblage de `settings.company_id`** : les helpers `odoo.py` qui scopent par société (`_company_domain()`, filtres `company_id=5`, `employee_company_id`, recherche client…) prennent la **société de l'employé** en paramètre au lieu du réglage global. `settings.company_id` ne sert plus que de **valeur de repli** (défaut SP) si une société est introuvable.
- **`/me` et `access_decision`** : utilisent `emp["company_id"]` (et non `settings.company_id`). `access_decision(hr_employee_id, emp_company_id)` → les bons `effective_tabs` selon la société.

### 2. Onglets par société (déjà en place)
`app_rh_company_config.enabled_tabs` (réglé dans l'onglet App RH Group de vue.heiwa) pilote le menu via `supabase_access` + `navScreens()`. Pour onboarder une société : créer/activer sa ligne de config. **Aucun code.**

### 3. Thème par société
- **Backend** : nouveau helper `odoo.company_branding(company_id) -> {id, name, logo}` :
  - `name` = `res.company.name` ;
  - `logo` = `res.company.logo` (base64 PNG) → renvoyé en data URL. Mis en cache (le cache lecture Odoo TTL 20 s s'applique déjà).
- **Couleur** : champ `theme_color TEXT` ajouté à `app_rh_company_config` (lu côté app via Supabase). **V1** : la valeur est posée **directement dans Supabase** (migration + valeurs par défaut par société : EP vert, SER, HC, HS, SP bleu actuel `#0c5e68`). Le **sélecteur de couleur dans vue.heiwa** (App RH Group) est un **suivi** (hors de ce plan) — pour ne pas coupler ce chantier au repo vue.heiwa.
- **`/me`** renvoie `company: { id, name, logo, color }`.
- **Frontend** : au montage, l'app applique le thème de la société de l'employé :
  - **couleur** : surcharge des variables CSS d'accent (`--aqua-dark`, etc.) avec `company.color` ;
  - **logo** : affiché dans l'en-tête (remplace/complète le libellé) ;
  - **nom** : titre/en-tête.
  - Repli : si pas de thème → look actuel (neutre).

### 4. Seed multi-société
- `seed_employees.py` : prend en argument la **liste des `company_id`** à seeder (ex. `--companies 5,4`), défaut **5** (rétro-compat SP). Pour chaque société, seede ses employés Odoo, stockés avec leur `company_id`, `role` (heuristique job_title actuelle), `login` slugifié, PIN (référence Odoo `hr.employee.pin`).
- Idempotent (upsert par `hr_employee_id`).
- Onboarder une société = l'activer dans vue.heiwa + relancer le seed pour elle.

## Déploiement / rollout (phasé)
1. **Socle** (sections 1, 3, 4) construit + testé **en local** sur `feat/multi-company` (worktree isolé, pas de déploiement prod).
2. **Réconciliation** avec `wip/v2-sprint-elie` (tweaks de la session parallèle) → **fusion**.
3. **Déploiement** : l'app devient multi-société. **SP n'est plus codée en dur mais reste une société** → comportement SP inchangé (sa config = onglets actuels, couleur bleue actuelle).
4. **Onboarding société par société** (config, peu de code) : **EP** d'abord (activer dans vue.heiwa + couleur + seed EP), valider, puis **SER, HC, HS**.

## Hors périmètre
- Features **métier nouvelles** par société (paysagisme, rénovation…) — l'utilisateur a choisi « mêmes features, on active/désactive ».
- Employés multi-sociétés (un même humain dans 2 sociétés) : chaque `hr.employee` = un login = une société ; cas multi traité plus tard si besoin.
- Upload de logos custom : on utilise les logos Odoo existants.
- Refactor des features SP-spécifiques (Rapport→facture) : restent SP-only.

## Tests
- Résolution société : un employé EP → `company_id` EP ; helpers Odoo scopés EP (pas SP).
- `access_decision` par société → `effective_tabs` corrects.
- `company_branding` → name/logo de la bonne société ; couleur depuis la config.
- Seed multi-société : employés de 2 sociétés seedés avec le bon `company_id`.
- Non-régression SP : avec sa config, SP voit ses onglets actuels + thème bleu.
- `/me` renvoie le bloc `company` complet.
