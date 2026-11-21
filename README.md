# FabRun

[![Checks](https://github.com/Fabienhncgithub/fabrun/actions/workflows/security.yml/badge.svg)](https://github.com/Fabienhncgithub/fabrun/actions/workflows/security.yml)

FabRun est un tableau de bord personnel pour analyser ses activités Garmin, suivre sa charge d’entraînement et estimer ses performances en course à pied.

Le projet réunit une API ASP.NET Core et une interface React. Les données viennent de la Garmin Connect Personal API ; la clé reste sur le serveur et n’est jamais envoyée au navigateur.

## Choix et limites

Le projet répond à mon besoin de réunir mes activités et mes repères
d’entraînement dans une seule interface. L’API isole les appels Garmin des
calculs ; les préférences et résultats calculés restent sur le serveur.

Le déploiement actuel vise un usage personnel sur une seule instance. Le
stockage JSON local et ses verrous ne constituent pas un stockage distribué.
Une version multi-instance demanderait une base partagée et une coordination
des accès. Les prévisions de course et recommandations sont des estimations.

Les données d’entraînement sont privées : le dépôt contient le code, pas un
compte de démonstration donnant accès aux activités personnelles.

## Fonctionnalités

- synchronisation des activités Garmin, complétées par l’historique importé
  depuis Strava pour les séances antérieures à la montre ;
- indicateurs de volume, allure, fréquence cardiaque et dénivelé ;
- comparaison des statistiques annuelles ;
- suivi de la charge d’entraînement et de la récupération ;
- calendrier annuel des jours courus, consultable sur l’année en cours et la précédente ;
- estimation des performances sur 5 km, 10 km, semi-marathon et marathon ;
- calcul des meilleurs efforts à partir des fichiers FIT originaux de la montre ;
- objectifs de course multiples avec date, compte à rebours et temps estimé ;
- recommandations pour la prochaine séance ;
- plan hebdomadaire adaptatif : kilomètres réalisés importés, volume restant
  redistribué sans rattrapage brutal et reprise périostite avec jours de repos ;
- export des séances au format TCX v2 pour les appareils et applications compatibles ;
- suivi facultatif du sommeil par import HealthKit ;
- suivi précis de chaque paire de chaussures : paire par défaut attribuée aux
  nouvelles courses, changement par sortie, seuil de remplacement personnalisé,
  allure d’usure récente et date de remplacement projetée ;
- bilan ski par saison : distance, journées, vitesse max et dénivelé ;
- recherche et filtrage des activités, identification de la paire utilisée et
  export CSV de la vue courante ;
- poids Garmin utilisé automatiquement pour les estimations de dépense énergétique ;
- préférences athlète, objectifs et réglages des chaussures conservés côté serveur ;
- thème clair/sombre mémorisé et interface installable sur l’écran d’accueil ;
- navigation visuelle vers les fonctions principales et aides de lecture
  contextuelles dans les cartes complexes.

## Architecture

```text
web/                 Interface React et TypeScript
  src/components/             Cartes, navigation et en-tête
  src/styles/                 Styles répartis par fonction
Controllers/                 Endpoints HTTP de l’API
Services/                    Calculs et logique métier
Infrastructure/Persistence/ Stockage local : préférences, chaussures, archive
Models/                      Modèles de données
Security/                    Noms et configuration des cookies
FabRun.Api.Tests/            Tests unitaires et d’intégration
deploy/                      Déploiement Docker avec Caddy
docs/                        Documentation d’architecture
```

Une description plus détaillée est disponible dans [docs/architecture-schema.md](docs/architecture-schema.md).

## Prérequis

- .NET SDK 10 ;
- Node.js 22 et npm ;
- une clé Garmin Connect Personal API ;
- des certificats HTTPS locaux pour le développement.

## Configuration locale

### API

Les informations sensibles peuvent être enregistrées avec les secrets utilisateur .NET :

```bash
dotnet user-secrets set GARMIN_PERSONAL_API_KEY "votre-cle"
dotnet user-secrets set FABRUN_ACCESS_PASSWORD "un-mot-de-passe-long-et-unique"
dotnet user-secrets set FABRUN_SESSION_VERSION "une-valeur-aleatoire-distincte"
dotnet user-secrets set WEB_ORIGIN "https://localhost:5173"
```

La configuration HTTPS et les origines autorisées pour le développement se trouvent dans `appsettings.Development.json`.

Lancer ensuite l’API :

```bash
dotnet run
```

L’API écoute par défaut sur `https://localhost:3001`.

### Interface

Créer ou adapter `web/.env` :

```dotenv
VITE_API_BASE=https://localhost:3001
```

Installer les dépendances et démarrer le serveur de développement :

```bash
cd web
npm ci
npm run dev
```

L’interface est alors disponible sur `https://localhost:5173`.

## Authentification

L’accès se fait par le mot de passe privé FabRun. La session est enregistrée
dans un cookie `HttpOnly`, `Secure` et `SameSite=Lax`. Aucune autorisation
tierce n’est demandée au navigateur : l’API appelle Garmin avec la clé
personnelle du serveur. Les endpoints métier nécessitent une session FabRun
valide et les requêtes qui modifient des données sont protégées contre les
attaques CSRF.

## Endpoints principaux

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/access/status` | État de la session FabRun |
| `GET` | `/access/csrf` | Création d’un jeton CSRF |
| `POST` | `/access/login` | Ouverture de la session privée |
| `POST` | `/access/logout` | Fermeture de la session |
| `GET` | `/api/dashboard` | Données principales du tableau de bord |
| `GET` | `/api/activities` | Activités récentes |
| `GET` | `/api/kpis` | Indicateurs d’entraînement |
| `GET` | `/api/profile` | Profil et chaussures |
| `GET` | `/api/predictions/running` | Estimations de performance |
| `POST` | `/api/health/sleep` | Import de sessions de sommeil |
| `GET` | `/api/health/sleep/summary` | Synthèse des nuits enregistrées |
| `GET` | `/api/settings` | Préférences athlète (périostite, objectifs et chaussures) |
| `PUT` | `/api/settings` | Mise à jour des préférences athlète |
| `POST` | `/api/shoes` | Ajout d’une paire |
| `PUT` | `/api/shoes/default` | Paire par défaut des nouvelles courses |
| `PUT` | `/api/shoes/{id}/retired` | Retrait ou remise en service d’une paire |
| `PUT` | `/api/activities/{id}/shoe` | Chaussure d’une course |

Le bouton de rafraîchissement du dashboard contourne volontairement le cache
de 15 minutes de l’API pour relire Garmin. Les chargements automatiques
conservent ce cache afin de limiter la latence et la consommation du quota Garmin.

## Données Garmin et historique Strava

Toutes les activités viennent de Garmin Connect (`activitylist-service`), sur
tout l’historique de la montre. Les types Garmin sont convertis vers les noms
utilisés par les calculs (`running` → `Run`, `strength_training` →
`WeightTraining`, `resort_skiing` → `AlpineSki`…). Les meilleurs efforts lisent
les fichiers FIT originaux (`download-service`) des 40 courses les plus récentes.

Les séances antérieures à la première activité Garmin viennent de
`Data/strava-archive.json`, un import unique de l’ancien compte Strava. Une
séance de l’archive n’est jamais affichée si Garmin couvre déjà cette période,
ce qui évite les doublons. Cette archive porte aussi l’identifiant sous lequel
les préférences, le sommeil et les meilleurs efforts sont déjà enregistrés.

L’API Garmin n’expose pas l’équipement : les chaussures et la paire de chaque
course sont gérées par FabRun dans `Data/shoes.json`. Une nouvelle course reçoit
la paire par défaut, et ce choix est enregistré : changer la paire par défaut
ne modifie pas les courses passées. Le kilométrage d’une paire est son
kilométrage de départ plus celui des courses qui lui sont attribuées.

En production, copier `Data/strava-archive.json` et `Data/shoes.json` dans le
volume `fabrun-data` (voir [deploy/README.md](deploy/README.md)).

## Tests et vérifications

Exécuter les tests de l’API :

```bash
dotnet test FabRun.Api.sln
```

Vérifier l’interface :

```bash
cd web
npm test
npm run lint
npm run build
```

## Déploiement

Le déploiement de production repose sur Docker Compose :

- Caddy sert l’interface et gère HTTPS ;
- l’API reste accessible uniquement sur le réseau Docker privé ;
- les données calculées et les clés de session utilisent des volumes persistants ;
- les secrets sont fournis par `deploy/.env.production`.

Les instructions complètes sont disponibles dans [deploy/README.md](deploy/README.md).

## Données et secrets

Les fichiers de données, clés privées, certificats locaux et fichiers d’environnement ne doivent pas être publiés. En production, utiliser des secrets distincts, un mot de passe d’accès aléatoire, une valeur `FABRUN_SESSION_VERSION` aléatoire et des sauvegardes chiffrées des volumes persistants.

## Coach d’entraînement

La page **Entraînement** croise les activités et la récupération Garmin, l’objectif de course et la météo
pour dire quoi courir, à quelle allure et quand. Tout est calculé dans le
navigateur ([web/src/utils/coach.ts](web/src/utils/coach.ts)),
une seule fois pour la carte du jour et le plan de la semaine.

- **Allures personnalisées** : zones endurance, sortie longue, seuil, fractionné
  long et court, dérivées de l’estimation 5 km. Chaque séance est écrite en
  clair (répétitions, temps de passage, récupération) et exportée en TCX avec
  ses étapes. Sans estimation 5 km, aucune allure n’est inventée.
- **Forme du jour** : feu vert, orange ou rouge à partir de la HRV, du sommeil,
  du pouls au repos, de la Body Battery au réveil et de la charge récente.
  Orange retire l’intensité, rouge retire la course. Les kilomètres retirés ne
  sont pas rattrapés. Sans mesure Garmin datée du jour, la forme reste
  « inconnue » et le plan n’est pas modifié. Garmin est synchronisé
  automatiquement à l’ouverture si l’instantané date de la veille.
- **Plan vers l’objectif** : la prochaine course de la page Objectifs définit
  les phases (base, développement, spécifique, affûtage, semaine de course),
  comptées à rebours. Une semaine sur quatre est allégée de 20 %, l’affûtage
  réduit le volume, et la semaine de course place un déblocage, un repos la
  veille et la course. Sans objectif, le plan suit la règle des +10 %.
- **Bilan des sorties** : allure et fréquence cardiaque moyennes comparées aux
  zones. Des footings à fréquence cardiaque élevée ralentissent les allures
  d’endurance de 3 % ; l’inverse les accélère de 2 %. La dérive cardiaque
  pendant la sortie n’est pas analysée.
- **Meilleur créneau** : heure de départ la plus sèche, douce et lumineuse
  entre 6 h et 22 h, d’après les prévisions horaires Open-Meteo pour Genève.

Le mode prudent (douleur au tibia) garde la forme du jour mais désactive les
allures, l’intensité et la préparation spécifique.

## Garmin Connect Personal API

Garmin alimente aussi la page **Récupération** : sommeil mesuré sur 30 jours,
score et phases de sommeil, HRV nocturne et moyenne hebdomadaire, fréquence
cardiaque au repos, stress, Body Battery, calories brûlées et poids. Les mesures
absentes restent indisponibles.

Garmin est la source de référence pour l’énergie :

- **Calories journalières** : total, actives et repos (métabolisme de base)
  issus des résumés quotidiens Garmin, sur toute la journée. Elles sont affichées
  dans un tableau avec la moyenne par jour. La journée en cours est partielle et
  exclue des moyennes.
- **Calories par activité** : valeur fournie par la montre Garmin. FabRun ne
  fait jamais la moyenne de deux sources. Son estimation (Keytel ou MET) ne sert
  que lorsqu’aucune valeur mesurée n’existe.
- **Poids** : la dernière pesée Garmin (sur 180 jours) sert à ces estimations. L’API Garmin renvoie le poids en grammes,
  bien que le Swagger indique des kilogrammes : les deux unités sont acceptées.

1. Créer une clé sur https://connect.garmin.com/app/settings/personalApiToken.
2. En local, enregistrer `GARMIN_PERSONAL_API_KEY` avec les secrets utilisateur
   .NET (`dotnet user-secrets set GARMIN_PERSONAL_API_KEY "votre-cle"`). En
   production, ajouter cette variable à `deploy/.env.production` puis recréer
   le conteneur API selon les instructions de déploiement.
3. Ouvrir **Récupération**, puis **Synchroniser Garmin** après la synchronisation
   de la montre avec Garmin Connect.

La clé reste sur le serveur et n'est jamais renvoyée au navigateur. Le serveur
obtient un jeton Bearer et le renouvelle avant 24 heures, ou après un refus 401.
La clé personnelle doit être remplacée à son expiration chez Garmin. Cette
intégration vise le compte personnel du propriétaire de cette instance privée ;
une application destinée à plusieurs utilisateurs nécessite l'offre Business.

`GET /api/garmin/status` indique la configuration et le dernier résultat en mémoire.
`POST /api/garmin/activities` renvoie la charge et les effets aérobie et anaérobie
des 365 derniers jours, affichés avec les séances de la page Activités.
`POST /api/garmin/sync` synchronise les données avec la protection de session et
CSRF existante. Un cache de 15 minutes limite les appels. Les données Garmin ne
sont pas conservées sur disque : après un redémarrage, resynchroniser. Elles sont
utilisées par le coach d’entraînement pour la forme du jour (voir plus haut).

Contrat utilisé : [Swagger officiel Garmin](https://developer.garmin.com/gc-developer-program/personal/swagger-docs/).

Sur macOS, si AppleCrypto refuse la négociation TLS 1.3 exigée par Garmin, un
relais de développement local peut être indiqué avec `Garmin__DevelopmentRelay`
(URL HTTP loopback exclusivement). Ce réglage est ignoré en production. Le
relais doit valider le certificat HTTPS Garmin et ne jamais journaliser les
jetons. Aucun relais n'est nécessaire pour les environnements .NET prenant
en charge TLS 1.3 vers Garmin.

L’historique de récupération propose 1 jour, 7 jours, 1 mois, 4 mois, 1 an et
2 ans. `POST /api/garmin/history?period=7d` accepte `1d`, `7d`, `1m`, `4m`,
`1y` et `2y`. Le serveur charge les mesures par blocs de 31 jours, réutilisés
pendant 15 minutes entre les périodes. Les vues annuelles affichent les moyennes
mensuelles des jours renseignés. Les jours absents ne valent jamais zéro. La
vue 1 jour utilise les résumés quotidiens, sans détail intrajournalier.

Dans **Activités**, le bouton **Charger les bilans Garmin** récupère jusqu’à
1 089 séances des 365 derniers jours, avec un cache de 15 minutes. Le panneau
**Bilan Garmin** affiche la charge et les effets aérobie/anaérobie sur 5.
`POST /api/garmin/activities` expose ces résumés, avec les protections de session
et CSRF habituelles. Les séances et leurs bilans partagent le même identifiant
Garmin. Les effets absents restent indisponibles ; la valeur zéro est conservée.
