# Design — Bandeau d'anniversaire sur l'accueil

**Date** : 2026-06-27
**Branche** : `wip/v2-sprint-elie`
**Statut** : design approuvé, à transformer en plan d'implémentation

## Problème / objectif

Le jour de l'anniversaire d'un employé Swiss Piscine, l'app doit afficher, sur le tableau de bord d'accueil :
- pour la personne concernée : un message « Joyeux anniversaire [Prénom] ! » ;
- pour les autres : « Aujourd'hui, [Prénom] fête son anniversaire » (pour qu'ils puissent le souhaiter).

Visibilité immédiate à l'ouverture de l'app, sans clic.

## Décisions de cadrage (verrouillées)

1. **Placement** : un bandeau festif en haut du dashboard d'accueil. Pas de notification cloche, pas de page dédiée.
2. **Source de données** : `hr.employee.birthday` (company 5), lu via le compte de service Odoo.
3. **Sans toucher `odoo.py` ni `config.py`** (zone de la session `feat/multi-company`) : la lecture Odoo vit dans un nouveau router dédié qui réutilise les helpers EXISTANTS `odoo.list_employees()` et `odoo.get_client()`.
4. **Vie privée** : on ne renvoie ni l'année de naissance ni l'âge. Uniquement le prénom (et l'id employé technique).
5. **Jour J uniquement** (comparaison jour+mois en Europe/Zurich).

## Architecture

### Backend — nouveau router (additif, zéro modif `odoo.py`)

Fichier : `backend/app/routers/birthdays.py`

```
GET /birthdays/today  →  list[BirthdayOut]
BirthdayOut = { "employee_id": int, "first_name": str, "is_me": bool }
```

Logique :
1. `emps = odoo.list_employees()` (existant) → `[{id, name}, ...]` des employés company 5.
2. Lecture des dates : `odoo.get_client().execute_kw("hr.employee", "read", [[e["id"] for e in emps]], {"fields": ["name", "birthday"]})`.
   (Appel direct dans le router ; `odoo.py` n'est pas modifié.)
3. « Aujourd'hui » = date courante en `Europe/Zurich` (via `zoneinfo.ZoneInfo`). Filtrer les employés dont `birthday` est renseigné ET `(birthday.month, birthday.day) == (today.month, today.day)`.
   - Cas 29 février : si l'année courante n'est pas bissextile, le 29/02 est célébré le 28/02 (règle simple, documentée). *(YAGNI : on peut aussi l'ignorer ; voir Hors périmètre — choix retenu : célébrer le 28/02 les années non bissextiles.)*
4. `is_me` = `employee_id == emp["hr_employee_id"]` de l'employé courant.
5. Renvoie la liste (vide si aucun anniversaire).

Le `birthday` d'Odoo est une chaîne `"YYYY-MM-DD"` ; parser avec `datetime.strptime(..., "%Y-%m-%d").date()` en ignorant les valeurs `False`/vides.

Enregistrement : `app.include_router(birthdays.router)` dans `backend/app/main.py` (ni `odoo.py` ni `config.py`).

Auth : endpoint protégé par `Depends(get_current_employee)` (comme les autres).

### Frontend — bandeau accueil

Fichier : `frontend/js/screens/accueil.js`

- Ajouter `api("/birthdays/today").catch(() => [])` au `Promise.all` du `render`.
- Nouvelle fonction `birthdayBanner(list)` rendue **en première position** du dashboard (avant `messageBanner`), uniquement si `list.length`.
- Contenu :
  - Si un élément a `is_me === true` → ligne « Joyeux anniversaire [Prénom] ! » (chaleureuse, adressée à l'utilisateur).
  - Pour chaque élément `is_me === false` → ligne « Aujourd'hui, [Prénom] fête son anniversaire ».
  - Si les deux coexistent : le message « à toi » d'abord, puis les collègues.
- Style : carte au dégradé festif, cohérente avec les cartes existantes (réutilise les classes/variables CSS du dashboard). Icône SVG (pas d'émoji, charte « icônes au trait, zéro émoji »).

### Icône

Fichier : `frontend/js/icons.js` — ajouter un symbole SVG `i-gift` (cadeau) au trait, viewBox `0 0 24 24`, cohérent avec le style des icônes existantes. Utilisé par le bandeau via `icon("gift")`.

## Flux de données / cas limites

| Cas | Comportement |
|---|---|
| Aucun anniversaire aujourd'hui | `[]` → pas de bandeau |
| `birthday` non renseigné | employé ignoré |
| Plusieurs anniversaires le même jour | toutes les lignes affichées |
| C'est l'anniversaire de l'utilisateur courant | message « Joyeux anniversaire » + collègues éventuels |
| Odoo indisponible | `/birthdays/today` échoue → `.catch(()=>[])` → pas de bandeau (dégradation propre) |
| 29/02 année non bissextile | célébré le 28/02 |

## Tests

**Backend (pytest, `backend/tests/test_birthdays.py`)** — mock Odoo via `monkeypatch.setattr(odoo, "list_employees", ...)` et `monkeypatch.setattr(odoo, "get_client", lambda: MagicMock(...))` :
- un employé dont le jour+mois = aujourd'hui → présent dans la sortie, `is_me` correct, AUCUN champ d'âge/année.
- un employé dont l'anniversaire est un autre jour → absent.
- un employé sans `birthday` (`False`) → absent, pas d'exception.
- aucun anniversaire → `[]`.
- l'employé courant fête son anniversaire → `is_me == True` sur sa ligne.

**Frontend** : `node --check js/screens/accueil.js` + `node --check js/icons.js` ; test manuel (forcer une date d'anniversaire à aujourd'hui dans Odoo pour un employé test, vérifier le bandeau et la variante « c'est toi »).

## Déploiement

- Backend : rsync code + `sudo systemctl restart swiss-piscine-app`. **N'implique PAS `odoo.py`** → pas de coordination multi-société requise (nouveau fichier router + 1 ligne dans `main.py`).
- Frontend : bump `frontend/sw.js` (v47 → v48), rsync frontend.
- Push via le compte SwissPiscine sur `wip/v2-sprint-elie`.

## Hors périmètre (YAGNI)

- Pas d'anniversaires « à venir » (uniquement le jour J).
- Pas de bouton « souhaiter » ni d'interaction.
- Pas de notification cloche.
- Pas de bandeau dismissible.
- Pas d'affichage de l'âge.
