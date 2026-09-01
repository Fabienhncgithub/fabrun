# FabRun — Algorithmes et transparence

Ce document décrit, de manière simple, les algorithmes utilisés dans chaque module visible du dashboard FabRun. Objectif : comprendre d’où viennent les chiffres, quelles hypothèses sont faites, et leurs limites.

## Sources de données
- **Strava** : activités, profil, chaussures (gears).
- **Apple Health / HealthKit** : sommeil (via l’API FabRun).

## Modules

### 1) KPIs Course (module “KPIs”)
**Fichiers**
- `Services/StravaAnalytics.cs` (`ComputeKpis`)
- `strava-front/src/components/KpisCard.tsx`

**Données utilisées**
- Activités Strava de type : `Run`, `TrailRun`, `VirtualRun`.
- Pour “Depuis toujours” : **toutes** les activités disponibles.
- Pour “Année en cours” / “Année précédente” : activités dont la date est dans l’année civile correspondante.

**Calculs**
- `totalKm` = somme des distances (km) des runs.
- `avgPacePerKm` = `totalSec / totalKm`, formaté en `mm:ss/km`.
- `longestKm` = plus longue distance (km).
- La tuile “AC Ratio” de cette carte n’est **pas** recalculée par période : elle
  affiche le même chiffre que le module Charge d’entraînement (section 2), qui
  est la seule implémentation de ce calcul dans l’app. Un ACR est par nature
  une photo de l’instant présent ; le refaire par année civile n’aurait pas de
  sens (et une première version de FabRun avait bien deux implémentations
  divergentes ici — km4/12 en semaines ISO côté backend, 7j/28j glissants côté
  frontend — d’où la fusion).

**Limites**
- Les activités non-run sont ignorées.

---

### 2) Charge d’entraînement (module “Training Load”)
**Fichiers**
- `strava-front/src/utils/trainingLoad.ts` (`computeTrainingLoad` — seule implémentation de l’ACR dans l’app)
- `strava-front/src/components/TrainingLoadCard.tsx`
- `strava-front/src/components/KpisCard.tsx` (tuile “Charge actuelle”, même calcul)

**Données utilisées**
- Activités Strava des 28 derniers jours, **runs uniquement**.

**Calculs**
- On construit une fenêtre de 28 jours (jour par jour).
- `Acute 7j` = somme des 7 derniers jours.
- `Chronic 28j` = moyenne hebdo sur 28 jours = `(somme 28 jours) / 4`.
- `ACR` = `Acute 7j / Chronic 28j` (si `Chronic > 0`).
- `Km max aujourd’hui` =  
  `ACR_LIMIT * Chronic_28j - (Acute_7j - km_du_jour)`  
  avec `ACR_LIMIT = 1.3`.

**Zone de risque**
- Vert si `ACR <= 1.3`
- Orange si `ACR <= 1.5`
- Rouge si `ACR > 1.5`
- Sinon “Données insuffisantes”

**Limites**
- Méthode simplifiée (pas de pondération par intensité).
- Dépend fortement des 28 derniers jours.

---

### 3) Évolution de forme (module “Form Trend”)
**Fichiers**
- `strava-front/src/components/FormTrendCard.tsx`

**Données utilisées**
- Runs comparables des 12 derniers mois (4-20 km, 25-110 min) pour les
  tendances BPM/efficacité.
- Toutes les activités pour le score de forme du jour.

**Calculs**
- Tendance 12 mois : BPM moyen et “économie de course” (vitesse / BPM) par
  mois calendaire, sur les runs comparables avec FC valide (80-210 bpm).
- Score de forme (0-100), base 50, puis ajustements :
  - Ratio de charge (voir section 2 - même `computeTrainingLoad`, pas un
    recalcul local) : +22 si 0.8-1.2, +12 si 0.6-0.8/1.2-1.35, +4 si
    0.45-0.6/1.35-1.5, -8 sinon.
  - +4 si repos complet la veille ; -6 si séance intense (>=14 km ou >=90
    min) dans les 48h.
  - Sommeil (si connecté) : jusqu’à +18 si moyenne 7j >= 7h30, -10 si < 6h ;
    petits bonus/malus sur la tendance 7j vs 30j et la dernière nuit.
- Grade lettre A-E et statut texte dérivés du score final.

**Limites**
- Le score combine plusieurs signaux hétérogènes (charge, repos, sommeil)
  avec des poids fixes, non calibrés individuellement.
- Nécessite des runs comparables pour la tendance BPM (sinon “Pas assez de
  données”).

---

### 4) Tableau d’activités (module “Activities Table”)
**Fichiers**
- `strava-front/src/components/ActivitiesTable.tsx`

**Affichages**
- Distance, allure (pace), durée, calories et chaussure associée par Strava.
- Recherche par nom, sport ou chaussure, filtre par sport et export CSV de la
  vue filtrée.

**Calories**
- Si Strava fournit `calories` ou `kilojoules`, on affiche la valeur.
- Sinon : estimation via MET (intensité moyenne standard).
  - MET basé sur sport + vitesse moyenne pour la course.
  - Calories actives ≈ `(MET - 1) * poids(kg) * durée(h)`.
  - Pour un trail, le coût du dénivelé positif est ajouté selon l'énergie
    potentielle de la montée, avec un rendement musculaire estimé à 25 % :
    `poids(kg) * 9,80665 * D+(m) / (4 184 * 0,25)`.

**Limites**
- MET = approximation ; ne remplace pas un capteur cardio.
- Le poids vient du profil Strava. S’il n’est pas renseigné, l’estimation
  n’est pas affichée.

---

### 5) Chaussures (module “Gears / Shoes”)
**Fichiers**
- `strava-front/src/components/ShoeUsageCard.tsx`

**Données utilisées**
- `distance` (mètres) ou `converted_distance` (km) de Strava.
- `gear_id` de chaque activité Strava pour affecter les kilomètres récents à
  la bonne paire.
- Activités de course des 28 derniers jours pour mesurer le rythme propre à
  chaque paire.

**Calculs**
- `km` = distance convertie en kilomètres.
- Le seuil de remplacement est configurable par paire entre 300 et 1 500 km ;
  sa valeur initiale est 800 km.
- `usure (%) = km / seuil personnalisé * 100`.
- États : fraîche avant 50 %, normale entre 50 et 75 %, à surveiller entre
  75 et 100 %, remplacement conseillé à partir de 100 %.
- `rythme hebdomadaire de la paire = kilomètres de la paire sur 28 jours / 4`.
- Échéance projetée = kilomètres restants / rythme hebdomadaire de la paire.
- Tri au choix par usure, utilisation récente ou kilométrage total.
- Détection de marque via le nom (heuristique simple).
- Une checklist rappelle les signaux physiques complémentaires : semelle
  asymétrique, mousse tassée et apparition de douleurs ou d’instabilité.

**Limites**
- Détection de marque basée sur le texte du nom.
- Une activité sans chaussure renseignée dans Strava ne peut pas être affectée
  à une paire.
- L’échéance suppose que le rythme des 28 derniers jours reste stable.
- Le kilométrage est un indicateur : l’état physique et les sensations restent
  prioritaires et FabRun ne pose pas de diagnostic médical.

---

### 6) Sommeil (module “Sommeil”)
**Fichiers**
- `Services/HealthSleepService.cs`
- `Controllers/HealthSleepController.cs`
- `strava-front/src/components/FormTrendCard.tsx`

**Données utilisées**
- Sessions envoyées via `POST /api/health/sleep` (import HealthKit).
  - Champs : `startUtc`, `endUtc`, `source`.

**Calculs**
- Les intervalles qui se chevauchent sont fusionnés afin qu’un import provenant
  de deux sources ne compte pas deux fois la même période.
- Les segments séparés par moins de 2 heures appartiennent à la même nuit ; le
  temps éveillé entre les segments n’est pas ajouté à la durée de sommeil.
- `Dernière nuit` = somme des segments de l’épisode le plus récent.
- `Moy. 7 jours` = moyenne des nuits terminées dans les 7 derniers jours.
- `Moy. 30 jours` = idem sur 30 jours.

**Stockage**
- Fichier local JSON : `Data/health-sleep.json`.
- Conservation max : 400 sessions par athlète.

**Limites**
- Pas d’analyse fine des stades de sommeil (juste durée).
- Dépend de la fiabilité de l’import HealthKit.

---

### 7) Performance Predictions (module “Estimations actuelles”)
**Fichiers**
- `Services/BestEffortsService.cs`
- `Controllers/PredictionsController.cs`
- `strava-front/src/components/PerformancePredictionsCard.tsx`

**Objectif**
Estimer 5K / 10K / Semi / Marathon à partir des meilleurs efforts disponibles dans les sorties Strava, avec un score de confiance.

**Best Efforts — stratégie**
Ordre des méthodes :
1. **Streams (distance + time)** : calcul précis par fenêtre glissante.
2. **Splits 1 km** : somme minimale de splits consécutifs.
3. **Fallback activité entière** : si la distance est à ±3% de la cible.

Les streams et détails sont interrogés pour au plus 40 sorties récentes afin
de respecter le quota Strava. Le fallback « activité entière », qui ne coûte
aucune requête supplémentaire, parcourt en revanche toute la fenêtre de
365 jours : une course plus ancienne n’est donc pas masquée par 40 sorties
récentes. Les meilleurs efforts retenus sont renvoyés par l’API et affichés
avec leur allure, leur méthode et un lien vers l’activité Strava.

**Distances cibles**
- 1K, 5K, 10K, 21.097K, 42.195K.

**Prédiction (Riegel)**
- Formule : `T2 = T1 * (D2/D1)^k`.
- Exposant par défaut `k = 1.06`.
- Si 5K et 10K récents existent :  
  `k = log(T10/T5) / log(10/5)` puis clamp entre `1.04` et `1.12`.

**Référence utilisée**
- Priorité : 10K récent, sinon 5K, sinon Semi, sinon 1K.
- Fenêtre “récente” : 180 jours.

**Confiance**
Score base 50 puis :
- +25 si effort <= 42 jours
- +10 si distance de référence >= 10K
- +10 si méthode streams
- +5 si calibration 5K+10K
- -20 si effort > 180 jours

**Limites**
- Dépend du volume de données Strava et de la disponibilité des streams.
- Les pauses longues peuvent biaiser les temps si les streams sont trop irréguliers.

---

### 8) Objectifs course (module “Goal Race”)
**Fichiers**
- `Controllers/AthleteSettingsController.cs`, `Services/AthleteSettingsService.cs`
- `strava-front/src/components/GoalRaceCard.tsx`

**Objectif**
Afficher, pour chaque course cible définie librement par l’athlète (nom, distance, date), un compte à rebours et une estimation du temps actuel. Plusieurs objectifs peuvent coexister (ex: course A + course B), triés par date la plus proche.

**Calculs, par objectif**
- `Jours restants` = date cible − date du jour (jours calendaires).
- `Estimation actuelle` = même formule de Riegel que la section 7
  (`T2 = T1 * (D2/D1)^k`), appliquée à la distance de l’objectif plutôt
  qu’aux seules distances 5K/10K/Semi/Marathon précalculées côté serveur.
  `T1`, `D1` et `k` viennent de la référence et de l’exposant déjà calculés
  par `/api/predictions/running` (donc partagés par tous les objectifs).

**Stockage**
- Fichier local JSON : `Data/athlete-settings.json` (même mécanisme que le
  module Sommeil), avec le mode périostite et les seuils de remplacement des
  chaussures. `PUT /api/settings`
  reçoit toujours la liste complète voulue ; un objectif sans identifiant
  reçoit un nouvel identifiant côté serveur, un objectif existant garde le
  sien (ajout/édition/suppression sont tous exprimés par la liste envoyée).

**Limites**
- Une référence de plus de 180 jours reste utilisable, mais sa confiance est
  abaissée et l’estimation doit être interprétée avec prudence.
- Maximum 8 objectifs simultanés.

---

### 9) Plan hebdomadaire adaptatif
**Fichiers**
- `strava-front/src/components/WeeklyTrainingPlanCard.tsx`
- `strava-front/src/utils/trainingPlan.ts`
- `strava-front/src/utils/trainingLoad.ts`

**Adaptation à la semaine réelle**
- Chaque sortie de la semaine est associée à son jour et remplace la distance
  initialement prévue par la distance réellement importée depuis Strava.
- Au moins trois sorties sur les 28 derniers jours sont nécessaires avant de
  générer un plan ciblé.
- La cible normale ne possède pas de plancher kilométrique artificiel. Elle est
  plafonnée au plus grand entre le volume déjà réalisé sur 7 jours et une
  progression de 10 % sur la base hebdomadaire des 28 derniers jours.
- Sous 12 km, le plan reste limité à trois sorties faciles sans séance intense
  imposée.
- `reste au plafond = max(0, cible hebdomadaire - kilomètres réalisés)`.
- Le reste est réparti uniquement entre les séances encore à venir, en
  conservant un plafond par séance. Si la semaine est trop avancée, une partie
  reste volontairement non planifiée au lieu d’être concentrée sur le week-end.
- Une séance passée sans activité est marquée « non faite » ; son volume n’est
  jamais reporté intégralement sur une seule séance.
- L’export TCX hebdomadaire ne contient que les séances futures recalculées.

**Mode reprise périostite**
- Le plafond courant reste basé sur la semaine précédente, avec une hausse
  maximale de 10 %, et demeure une limite plutôt qu’un objectif obligatoire.
- Deux sorties sont proposées sous 6 km hebdomadaires, trois au-delà.
- Les jours futurs sont réorganisés pour conserver au moins un jour complet
  sans course entre deux sorties, y compris après une sortie imprévue.
- La proposition S+1 part des kilomètres déjà réalisés plus les kilomètres
  encore réellement planifiés. Elle ne part plus du plafond théorique si la
  semaine ne peut pas être terminée sans concentrer la charge.
- Fractionné, tempo, côtes et sortie longue restent désactivés dans ce mode.

**Lecture visuelle**
- La barre distingue kilomètres faits, kilomètres futurs recalculés et marge
  laissée libre.
- Chaque journée expose un état explicite : fait, non fait, à faire ou repos.
- La cible, le détail du calcul et la projection des semaines suivantes sont
  séparés visuellement pour éviter de confondre limite et prescription.

**Limites**
- Le plan dépend de la qualité et de la fraîcheur de la synchronisation Strava.
- Le signal de douleur reste déclaré manuellement et ne constitue pas un
  diagnostic médical.

---

### 10) Export des séances TCX
**Fichiers**
- `strava-front/src/utils/workoutExport.ts`
- `strava-front/src/components/NextSessionCard.tsx`
- `strava-front/src/components/WeeklyTrainingPlanCard.tsx`

**Format**
- Document `TrainingCenterDatabase` conforme au schéma TCX v2.
- Étapes par temps (`Time_t`) ou par distance (`Distance_t`).
- Échauffement, bloc principal, récupérations et retour au calme sont exportés
  comme étapes séparées.
- Pour les séances à distance annoncée, échauffement et retour au calme sont
  inclus dans cette distance : un export de 5 km totalise exactement 5 km.
- Le plan hebdomadaire peut regrouper plusieurs séances dans un document.

**Limites**
- L’import de séances planifiées dépend de l’appareil ou de l’application cible ;
  le fichier n’est pas présenté comme une activité déjà réalisée.

---

## Remarques générales
- Toutes les valeurs sont **des estimations** ou des agrégats simples.
- Les modules ne remplacent pas un suivi médical.
- Les algorithmes sont volontairement transparents et simples à vérifier.
