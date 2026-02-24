# FabRun — Algorithmes et transparence

Ce document décrit, de manière simple, les algorithmes utilisés dans chaque module visible du dashboard FabRun. Objectif : comprendre d’où viennent les chiffres, quelles hypothèses sont faites, et leurs limites.

## Sources de données
- **Strava** : activités, profil, chaussures (gears).
- **Apple Health / HealthKit** : sommeil (via l’API FabRun).

## Modules

### 1) KPIs Course (module “KPIs”)
**Fichiers**
- `Services/StravaService.cs` (`ComputeKpis`)
- `strava-front/src/components/KpisCard.tsx`

**Données utilisées**
- Activités Strava de type : `Run`, `TrailRun`, `VirtualRun`.
- Pour “Depuis toujours” : **toutes** les activités disponibles.
- Pour “Année en cours” : activités dont la date est dans l’année civile courante.

**Calculs**
- `totalKm` = somme des distances (km) des runs.
- `avgPacePerKm` = `totalSec / totalKm`, formaté en `mm:ss/km`.
- `bestPacePerKm` = min des allures par run (`moving_time / km`).
- `longestKm` = plus longue distance (km).
- **AC Ratio (dans le bloc KPIs)**  
  - `km4` = somme des km des **4 dernières semaines** (ISO week).
  - `km12` = somme des km des **12 dernières semaines** (ISO week).
  - `ACR` = `(km4/4) / (km12/12)` si `km12 > 0`, sinon 0.

**Limites**
- Les semaines sont calculées en **ISO week** (peut différer d’un calendrier simple).
- Les activités non-run sont ignorées.

---

### 2) Charge d’entraînement (module “Training Load”)
**Fichiers**
- `strava-front/src/components/TrainingLoadCard.tsx`

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

### 3) Tableau d’activités (module “Activities Table”)
**Fichiers**
- `strava-front/src/components/ActivitiesTable.tsx`

**Affichages**
- Distance, allure (pace), durée, calories.

**Calories**
- Si Strava fournit `calories` ou `kilojoules`, on affiche la valeur.
- Sinon : estimation via MET (intensité moyenne standard).
  - MET basé sur sport + vitesse moyenne pour la course.
  - Calories actives ≈ `(MET - 1) * poids(kg) * durée(h)`.

**Limites**
- MET = approximation ; ne remplace pas un capteur cardio.
- Si le poids n’est pas connu, l’estimation n’est pas affichée.

---

### 4) Chaussures (module “Gears / Shoes”)
**Fichiers**
- `strava-front/src/components/ShoeUsageCard.tsx`

**Données utilisées**
- `distance` (mètres) ou `converted_distance` (km) de Strava.

**Calculs**
- `km` = distance convertie en kilomètres.
- Tri par kilométrage décroissant.
- Détection de marque via le nom (heuristique simple).
- Usure :
  - Vert si `km < 400`
  - Orange si `400 <= km < 800`
  - Rouge si `km >= 800`

**Limites**
- Seuils d’usure fixes (non personnalisés).
- Détection de marque basée sur le texte du nom.

---

### 5) Sommeil (module “Sommeil”)
**Fichiers**
- `Services/HealthSleepService.cs`
- `Controllers/HealthSleepController.cs`
- `strava-front/src/components/KpisCard.tsx`

**Données utilisées**
- Sessions envoyées via `POST /api/health/sleep`.
  - Champs : `startUtc`, `endUtc`, `source`.

**Calculs**
- Durée d’une session = `endUtc - startUtc` (minutes).
- `Dernière nuit` = durée de la session la plus récente.
- `Moy. 7 jours` = moyenne des durées des sessions dont `endUtc` est dans les 7 derniers jours.
- `Moy. 30 jours` = idem sur 30 jours.

**Stockage**
- Fichier local JSON : `Data/health-sleep.json`.
- Conservation max : 400 sessions par athlète.

**Limites**
- Pas d’analyse fine des stades de sommeil (juste durée).
- Dépend des données envoyées par l’app iOS.

---

### 6) Performance Predictions (module “Estimations actuelles”)
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

## Remarques générales
- Toutes les valeurs sont **des estimations** ou des agrégats simples.
- Les modules ne remplacent pas un suivi médical.
- Les algorithmes sont volontairement transparents et simples à vérifier.
