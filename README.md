# FabRun

[![Checks](https://github.com/Fabienhncgithub/fabrun/actions/workflows/security.yml/badge.svg)](https://github.com/Fabienhncgithub/fabrun/actions/workflows/security.yml)

FabRun est un tableau de bord personnel pour analyser ses activités Strava, suivre sa charge d’entraînement et estimer ses performances en course à pied.

Le projet réunit une API ASP.NET Core et une interface React. L’authentification Strava utilise OAuth 2.0 et les jetons restent dans des cookies sécurisés non accessibles au JavaScript du navigateur.

## Choix et limites

Le projet répond à mon besoin de réunir mes activités et mes repères
d’entraînement dans une seule interface. L’API isole les appels Strava des
calculs ; les préférences et résultats calculés restent sur le serveur.

Le déploiement actuel vise un usage personnel sur une seule instance. Le
stockage JSON local et ses verrous ne constituent pas un stockage distribué.
Une version multi-instance demanderait une base partagée et une coordination
des accès. Les prévisions de course et recommandations sont des estimations.

Les données Strava sont privées : le dépôt contient le code, pas un compte de
démonstration donnant accès aux activités personnelles.

## Fonctionnalités

- synchronisation du profil et des activités Strava ;
- indicateurs de volume, allure, fréquence cardiaque et dénivelé ;
- comparaison des statistiques annuelles ;
- suivi de la charge d’entraînement et de la récupération ;
- calendrier annuel des jours courus, consultable sur l’année en cours et la précédente ;
- estimation des performances sur 5 km, 10 km, semi-marathon et marathon ;
- calcul des meilleurs efforts à partir des flux et segments Strava ;
- objectifs de course multiples avec date, compte à rebours et temps estimé ;
- recommandations pour la prochaine séance ;
- plan hebdomadaire adaptatif : kilomètres réalisés importés, volume restant
  redistribué sans rattrapage brutal et reprise périostite avec jours de repos ;
- export des séances au format TCX v2 pour les appareils et applications compatibles ;
- suivi facultatif du sommeil par import HealthKit ;
- suivi précis de chaque paire de chaussures à partir de l’équipement associé
  aux activités Strava, avec seuil de remplacement personnalisé, allure d’usure
  récente et date de remplacement projetée ;
- recherche et filtrage des activités, identification de la paire utilisée et
  export CSV de la vue courante ;
- poids Strava utilisé automatiquement pour les estimations de dépense énergétique ;
- préférences athlète, objectifs et réglages des chaussures conservés côté serveur ;
- thème clair/sombre mémorisé et interface installable sur l’écran d’accueil ;
- navigation visuelle vers les fonctions principales et aides de lecture
  contextuelles dans les cartes complexes.

## Architecture

```text
strava-front/                 Interface React et TypeScript
  src/components/             Cartes, navigation et en-tête
  src/styles/                 Styles répartis par fonction
Controllers/                 Endpoints HTTP de l’API
Services/                    Calculs et logique métier
Infrastructure/External/    Communication avec Strava
Infrastructure/Persistence/ Stockage local des données calculées
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
- une application créée dans les paramètres API Strava ;
- des certificats HTTPS locaux pour le développement.

## Configuration locale

### API

Les informations sensibles peuvent être enregistrées avec les secrets utilisateur .NET :

```bash
dotnet user-secrets set STRAVA_CLIENT_ID "votre-identifiant"
dotnet user-secrets set STRAVA_CLIENT_SECRET "votre-secret"
dotnet user-secrets set FABRUN_ACCESS_PASSWORD "un-mot-de-passe-long-et-unique"
dotnet user-secrets set FABRUN_SESSION_VERSION "une-valeur-aleatoire-distincte"
dotnet user-secrets set BASE_URL "https://localhost:3001"
dotnet user-secrets set WEB_ORIGIN "https://localhost:5173"
```

La configuration HTTPS et les origines autorisées pour le développement se trouvent dans `appsettings.Development.json`.

Dans la configuration de l’application Strava, le callback local doit correspondre à :

```text
https://localhost:3001/oauth/callback
```

Lancer ensuite l’API :

```bash
dotnet run
```

L’API écoute par défaut sur `https://localhost:3001`.

### Interface

Créer ou adapter `strava-front/.env` :

```dotenv
VITE_API_BASE=https://localhost:3001
```

Installer les dépendances et démarrer le serveur de développement :

```bash
cd strava-front
npm ci
npm run dev
```

L’interface est alors disponible sur `https://localhost:5173`.

## Authentification

L’accès se déroule en deux étapes :

1. saisie du mot de passe privé FabRun ;
2. autorisation de l’application auprès de Strava.

La session FabRun et le jeton Strava sont enregistrés dans des cookies `HttpOnly`, `Secure` et `SameSite=Lax`. Le cookie Strava contient le jeton d’accès et le jeton de rafraîchissement, chiffrés et authentifiés avec les clés Data Protection de l’API ; `StravaTokenService` renouvelle le jeton d’accès automatiquement avant son expiration, donc la connexion Strava reste active tant que l’app est rouverte au moins une fois toutes les ~90 jours, sans repasser par l’écran d’autorisation Strava. Les endpoints métier nécessitent une session FabRun valide et les requêtes qui modifient des données sont protégées contre les attaques CSRF.

## Endpoints principaux

| Méthode | Route | Description |
| --- | --- | --- |
| `GET` | `/access/status` | État de la session FabRun |
| `GET` | `/access/csrf` | Création d’un jeton CSRF |
| `POST` | `/access/login` | Ouverture de la session privée |
| `POST` | `/access/logout` | Fermeture de la session |
| `GET` | `/auth/login` | Début de l’autorisation Strava |
| `GET` | `/auth/status` | État de la connexion Strava |
| `GET` | `/api/dashboard` | Données principales du tableau de bord |
| `GET` | `/api/activities` | Activités récentes |
| `GET` | `/api/kpis` | Indicateurs d’entraînement |
| `GET` | `/api/profile` | Profil et chaussures |
| `GET` | `/api/predictions/running` | Estimations de performance |
| `POST` | `/api/health/sleep` | Import de sessions de sommeil |
| `GET` | `/api/health/sleep/summary` | Synthèse des nuits enregistrées |
| `GET` | `/api/settings` | Préférences athlète (périostite, objectifs et chaussures) |
| `PUT` | `/api/settings` | Mise à jour des préférences athlète |

Le bouton de rafraîchissement du dashboard contourne volontairement le cache
court de l’API pour relire Strava. Les chargements automatiques conservent ce
cache afin de limiter la latence et la consommation du quota Strava.

## Tests et vérifications

Exécuter les tests de l’API :

```bash
dotnet test FabRun.Api.sln
```

Vérifier l’interface :

```bash
cd strava-front
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

La page **Entraînement** croise Strava, Garmin, l’objectif de course et la météo
pour dire quoi courir, à quelle allure et quand. Tout est calculé dans le
navigateur ([strava-front/src/utils/coach.ts](strava-front/src/utils/coach.ts)),
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

Garmin complète Strava dans la page **Récupération** : sommeil mesuré sur 30 jours,
score et phases de sommeil, HRV nocturne et moyenne hebdomadaire, fréquence
cardiaque au repos, stress, Body Battery, calories brûlées et poids. Les mesures
absentes restent indisponibles. Les activités continuent à provenir de Strava,
sans doublons.

Garmin est la source de référence pour l’énergie :

- **Calories journalières** : total, actives et repos (métabolisme de base)
  issus des résumés quotidiens Garmin, sur toute la journée. Elles sont affichées
  dans un tableau avec la moyenne par jour. La journée en cours est partielle et
  exclue des moyennes.
- **Calories par activité** : valeur fournie par la montre via Strava. FabRun ne
  fait jamais la moyenne de deux sources. Son estimation (Keytel ou MET) ne sert
  que lorsqu’aucune valeur mesurée n’existe.
- **Poids** : la dernière pesée Garmin (sur 180 jours) remplace le poids du
  profil Strava dans ces estimations. L’API Garmin renvoie le poids en grammes,
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
des 365 derniers jours, rapprochés des activités Strava dans la page Activités.
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
et CSRF habituelles. Aucun doublon d’activité n’est créé : les listes Strava
restent la référence. Le rapprochement exige un même sport, un départ à moins
de 2 minutes, une distance à moins de 3 % (tolérance minimale 100 m) et une durée
à moins de 10 % (tolérance minimale 60 s). Les cas ambigus ne sont pas associés.
Les effets absents restent indisponibles ; la valeur zéro est conservée.
