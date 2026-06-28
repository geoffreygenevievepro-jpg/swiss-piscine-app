# Refonte de l'écran « Présence » pour HHC (vue CCNT cohérente) — Design

**Date :** 2026-06-28
**Périmètre :** Heiwa Hospitality Concept (HHC, `company_id = 1`) **uniquement**. Aucune autre société n'est impactée.

## Objectif

Donner aux employés HHC, dans l'onglet **Présence**, **une seule vue cohérente et fidèle à la CCNT** (hôtellerie) : où j'en suis sur mes heures, mes vacances, mes repos, mes fériés, ma maladie — le tout calculé à partir d'**Odoo (source de vérité)**, à jour au jour J (jamais le futur).

## Problème actuel

L'écran Présence (partagé entre toutes les sociétés) cumule, pour un employé HHC, **plusieurs systèmes de calcul qui se contredisent** :
- **Arcs** (jour/mois/année) : calcul « contrat % + jours ouvrés ».
- **Soldes de congés** : calcul Odoo natif (vacances en jours ouvrés).
- **Section « Ma CCNT »** (déjà livrée) : calcul CCNT (jours calendaires, théorique par période de contrat).

Résultat : **3 chiffres d'heures sup différents** et **2 soldes de vacances différents** sur le même écran.

## Principe directeur

**Un seul moteur de calcul CCNT** (`odoo.ccnt_year`, déjà en place) alimente **tout** l'écran pour HHC : les arcs, le décompte et le calendrier sont des vues du **même** calcul. Règle CCNT déterministe ; ~1 % d'écart avec les fiches manuelles assumé (Odoo = vérité). **On ne touche jamais aux heures timbrées.**

## Deux variantes selon le type d'employé

Détection : un employé est **à l'heure (extra)** si son calendrier de travail contient « Extra » ou a `hours_per_week = 0` ; sinon il est **au %** (horaire fixe). Déjà implémenté dans `ccnt_year` (`hourly`).

### A. Employé au % (horaire fixe)
Ordre des sections dans Présence :
1. **Timbrer** — bouton Entrer/Sortir + statut du jour + bande des jours récents *(conservé tel quel)*.
2. **Mes heures CCNT** — 3 arcs **Jour / Mois / Année** (réalisé vs dû), alimentés par le calcul CCNT.
   - **Année** : réalisé (timbrage cumulé à ce jour) / dû (théorique cumulé à ce jour, **par période de contrat**).
   - **Mois** : réalisé du mois / dû du mois en cours (à ce jour).
   - **Jour** : réalisé d'aujourd'hui / dû quotidien (hebdo ÷ 5).
   - **Solde d'heures** mis en avant : « **+X h à récupérer/indemniser** » (positif) ou « **X h de retard** » (négatif).
3. **Mon décompte CCNT** — le « restant » en gros, le « X sur Y » en petit :
   - **Vacances** : `droit − pris` jours **restants** *(pris / droit annuel base 28 j, pro-rata)*. Vacances comptées en **jours calendaires** (déplie les plages de congé).
   - **Jours de repos** : `dus − pris` **à prendre** *(pris / dus, art. 16 = 2 j/sem)*. (Repos pris = inféré : présence − travaillé − absences − fériés ; approximatif.)
   - **Jours fériés** : **perçus / à rattraper**. À rattraper = férié tombé un jour **travaillé** (attendance > 0 ce jour) → compensatoire dû. Perçu = férié non travaillé.
   - **Maladie** : nombre de jours + rappel statique « indemnisée à 80 % dès le 4e jour (assurance CCNT) ».
   - **Jours travaillés** : nombre (information).
4. **Heures timbrées par mois** — graphe à barres (12 mois).
5. **Mon calendrier** — grille mensuelle colorée (travail/férié/vacances/maladie) + navigation mois précédent/suivant.

### B. Employé à l'heure (extra)
1. **Timbrer** *(idem)*.
2. **Heures timbrées** (total année + par mois, graphe). **Pas d'arcs ni de décompte** (pas d'heures théoriques pour un extra).
3. **Mon calendrier** (idem).

## Données & calcul (backend)

Tout est servi par **un endpoint** (extension de l'existant `GET /attendance/ccnt`, gaté HHC, sinon `{enabled:false}`). `ccnt_year` est enrichi pour renvoyer, en plus de l'existant :
- `arcs` : `{jour, mois, annee}` chacun `{fait, du}` (le « dû » mois/jour calculé selon le même principe par période).
- `decompte.feries` : `{percus, a_rattraper}` (calcul à partir des fériés société × timbrage du jour).
- (déjà présents : `decompte.heures{fait,du}`, `vacances{pris,droit}`, `repos{pris,dus}`, `jours_travailles`, `periodes`, `maladie` via le calendrier.)

**Alignement des arcs** : pour HHC, l'écran n'utilise plus `hours_overview` (ancien calcul) ; les arcs lisent les valeurs CCNT. Pour les autres sociétés, `hours_overview` reste inchangé (l'écran Présence non-HHC ne bouge pas).

## Frontend

Modifications **gatées HHC** (`me.company.id === 1`) dans l'écran Présence (`pointer.js`) :
- On **retire/masque** les anciens blocs contradictoires (arcs `hours_overview`, soldes natifs) pour HHC.
- On **conserve** le timbrage.
- On **rend** la nouvelle vue (arcs CCNT + décompte + graphe + calendrier) via le module `ccnt.js` enrichi.
- Les sociétés non-HHC gardent l'écran Présence **inchangé**.

## Contraintes (Global Constraints)

- **HHC uniquement** : toute modification est gatée `company_id == 1`. EP, SP, HC, HS, SER : aucun changement.
- **Odoo = source de vérité** ; ~1 % d'écart avec les fiches manuelles accepté.
- **À jour au jour J** : aucun « dû » ni cumul ne projette le futur.
- **Ne jamais modifier les heures timbrées** ni les horaires des employés.
- **Théorique par période de contrat** (`hr.version`) ; cumul, pas de filtre.
- Vacances : jours **calendaires**, base **28 j/an** pro-rata.
- Mobile-first (PWA), couleurs sobres « Hôtel de la Poste ».

## Hors périmètre (V1)

- 13e salaire (art. 12) — viendra avec la phase paie.
- Maladie/IJM côté paie (codes A1, calcul 80 %) — phase paie dédiée ; ici seulement l'**affichage** des jours.
- Précision exacte des « repos pris » (Odoo n'a pas de marquage « repos » → inféré).
- Autres sociétés.

## Validation / tests

- **Fidélité** : le décompte d'un employé au % (Sara, Lisete) colle aux fiches CCNT (heures réalisé + vacances = exacts ; théorique = règle, ~1 %). Anne-Françoise valide le calcul **par période** (80 % puis 60 %).
- **Gating** : un employé non-HHC ne voit ni les changements ni l'endpoint (`enabled:false`).
- **Extras** : variante simple (Lucie) — pas d'arcs/décompte.
- Tests backend : structure du décompte + fériés perçus/à rattraper + gating société.
