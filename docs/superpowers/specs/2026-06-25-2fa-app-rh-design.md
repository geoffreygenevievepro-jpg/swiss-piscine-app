# Double authentification (2FA) — App RH Swiss Piscine — V1

Date : 2026-06-25
Statut : design validé, prêt pour plan d'implémentation
Repo : `geoffreygenevievepro-jpg/swiss-piscine-app`, branche `wip/v2-sprint-elie`

## Problème / Objectif

L'app RH se connecte aujourd'hui en **login + PIN** (PBKDF2, blocage anti-bruteforce après 5 essais). On veut un **second facteur** pour protéger les données RH, **pour tous les employés**, sans alourdir le quotidien (les techniciens pointent souvent).

V1 : 2FA au **premier accès depuis un nouvel appareil**, avec **méthode au choix de l'employé** (Authenticator TOTP **ou** code Email), puis **appareil de confiance** (~30 j) → ensuite login + PIN seul.

Hors V1 (suivi éventuel) : SMS de secours.

## Décisions validées
- **Tout le monde** est concerné.
- Méthodes : **TOTP** (appli authenticator) **ou Email** (code 6 chiffres), au choix de l'employé.
- **Pas d'email Odoo (`work_email` vide) → seul TOTP est proposé** (option Email masquée).
- Email = **code à 6 chiffres** (pas de lien cliquable : mauvaise UX mobile). Envoi **via Odoo** (`mail.mail`), pas de fournisseur payant.
- **Appareil de confiance** ~30 jours, commun aux deux méthodes.
- Calqué sur le pattern 2FA de vue.heiwa (TOTP + appareils de confiance).

## Parcours

### A — Activation (2FA pas encore configurée, ou nouvel appareil non fiable)
1. login + PIN OK (+ gate Supabase existant).
2. Si `twofa_enabled = false` → écran **« Configurer la double authentification »** :
   - **Authenticator** : l'app génère un secret, affiche le **QR** (`otpauth://`) + le secret en clair (repli) ; l'employé scanne, saisit un code → confirmé → `twofa_method='totp'`, secret chiffré stocké, `twofa_enabled=true`.
   - **Email** (visible seulement si `work_email` présent) : l'app envoie un **code 6 chiffres** sur le `work_email` Odoo ; l'employé le saisit → `twofa_method='email'`, `twofa_enabled=true`.
3. Proposition **« Faire confiance à cet appareil 30 jours »** → si oui, cookie appareil de confiance posé.
4. Émission des tokens (accès + refresh).

### B — Connexion courante
1. login + PIN OK (+ gate Supabase).
2. **Appareil de confiance valide ?**
   - Oui → **tokens émis directement** (zéro friction, cas quotidien).
   - Non → étape 2e facteur selon `twofa_method` :
     - `totp` → saisie du code, vérifié contre le secret.
     - `email` → envoi d'un code, saisie, vérification.
   - Succès → (option appareil de confiance) → tokens émis.

## Modèle de données (SQLite)

Sur la table `employees` (migration idempotente `CREATE TABLE IF NOT EXISTS` / `ALTER ... ADD COLUMN`) :
- `twofa_method TEXT` — `null` | `'totp'` | `'email'`
- `twofa_secret_encrypted TEXT` — secret TOTP chiffré (null pour email)
- `twofa_enabled INTEGER NOT NULL DEFAULT 0`

Nouvelle table `email_otps` :
- `id INTEGER PK`, `employee_id INTEGER`, `code_hash TEXT`, `expires_at TEXT` (ISO), `attempts INTEGER DEFAULT 0`, `created_at TEXT`. Index sur `employee_id`.

Nouvelle table `trusted_devices` :
- `id INTEGER PK`, `employee_id INTEGER`, `token_hash TEXT`, `expires_at TEXT`, `user_agent TEXT`, `created_at TEXT`. Index sur `employee_id`.

## Composants

### Backend
- **`app/twofa.py`** (logique pure + I/O isolées) :
  - TOTP via `pyotp` : `new_secret()`, `provisioning_uri(secret, login)`, `verify_totp(secret, code)`.
  - Chiffrement du secret : `cryptography` Fernet, clé dérivée du secret applicatif (`SECRET_FILE`) — `encrypt(s)`, `decrypt(s)`.
  - Codes email : `generate_code()` (6 chiffres), `hash_code`, vérification + expiration (~10 min) + `attempts` (max 5).
  - Appareil de confiance : `new_device_token()`, `hash`, validation (existe + non expiré), création/révocation.
- **`app/routers/twofa.py`** (gardé par un **token pré-auth** court, pas le JWT complet) :
  - `GET /2fa/status` — méthode courante, `can_email` (work_email présent), `enabled`.
  - `POST /2fa/setup/totp/start` → `{ secret, otpauth_uri }`.
  - `POST /2fa/setup/totp/confirm` `{ code }` → active TOTP.
  - `POST /2fa/setup/email/start` → envoie un code (si `work_email`).
  - `POST /2fa/setup/email/confirm` `{ code }` → active Email.
  - `POST /2fa/verify` `{ code, trust_device? }` → vérifie le 2e facteur, pose le cookie appareil de confiance si demandé, renvoie les tokens.
  - `POST /2fa/email/resend` — renvoi de code (anti-abus).
- **`app/routers/auth.py`** — `login()` modifié : après PIN + gate Supabase, **avant `_issue_tokens`** (≈ ligne 88) :
  - si appareil de confiance valide → `_issue_tokens` (inchangé) ;
  - sinon si `twofa_enabled` → renvoie `{"twofa_required": true, "pending_token": <jwt court>, "method": <…>, "can_email": <bool>}` (statut 200, pas de tokens d'accès) ;
  - sinon (2FA pas encore configurée) → `{"twofa_setup_required": true, "pending_token": …, "can_email": …}`.
- **`app/odoo.py`** — helper `send_email(to, subject, body_html) -> bool` via `mail.mail` (create + `send`). Best-effort (retourne False si échec, sans bloquer).
- **Token pré-auth** : JWT `type="pre2fa"`, courte durée (~5 min), porte `sub` (employee_id). `deps.py` : dépendance `get_pre2fa_employee` qui n'accepte que ce type.

### Frontend
- **`frontend/js/screens/twofa.js`** (nouvel écran) : sous-vues *setup* (choix méthode, QR pour TOTP, bouton « envoyer le code » pour Email — Email masqué si `!can_email`) et *verify* (saisie code + case « faire confiance à cet appareil »).
- **`frontend/js/screens/login.js`** : après login, si la réponse contient `twofa_required` / `twofa_setup_required`, stocke le `pending_token` et bascule vers l'écran 2FA au lieu d'aller au dashboard.
- **`frontend/js/api.js`** : gérer l'en-tête du `pending_token` pour les appels `/2fa/*`.

## Sécurité & garde-fous
- Secret TOTP **chiffré au repos** (Fernet).
- Codes email : **6 chiffres**, **expiration ~10 min**, **max 5 tentatives**, **anti-renvoi** (1 / 60 s, **max 5 / heure**).
- Appareil de confiance : token **aléatoire 32o**, **stocké haché**, cookie **HttpOnly + Secure + SameSite=Lax**, **30 j**, révocable (table).
- `pending_token` ne donne accès **qu'aux endpoints `/2fa/*`** (jamais aux données).
- Anti-bruteforce sur la vérif 2FA (réutilise/parallèle au mécanisme PIN).
- Le **gate Supabase** existant reste **avant** la 2FA (accès coupé = pas de 2FA inutile).

## Tests (pytest)
- `verify_totp` (code valide/invalide/fenêtre), `provisioning_uri` bien formé.
- Code email : génération, hash, expiration, max tentatives, anti-renvoi.
- Appareil de confiance : création, validité, expiration, révocation.
- `login()` : appareil de confiance valide → tokens ; sinon → `twofa_required` ; 2FA non configurée → `twofa_setup_required`.
- `can_email=false` si `work_email` vide → option Email indisponible.

## Hors périmètre (V1)
- SMS de secours.
- 2FA conditionnelle par rôle (ici : tout le monde).
- Réinitialisation 2FA en self-service (l'employé seul). **V1** : en cas de perte (téléphone perdu / plus d'email), un **admin** réinitialise la 2FA de l'employé — efface `twofa_enabled`/`twofa_method`/`twofa_secret_encrypted` + ses appareils de confiance → l'employé reconfigure au login suivant. Endpoint admin `POST /admin/employees/{id}/reset-2fa` (gardé `role=='admin'`).

## Dépendances ajoutées
- `pyotp` (TOTP), `cryptography` (Fernet) — dans `requirements.txt`.
