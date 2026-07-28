# FabRun

FabRun est un tableau de bord personnel pour analyser ses activités Strava, suivre sa charge d’entraînement et estimer ses performances en course à pied.

Le projet réunit une API ASP.NET Core et une interface React. L’authentification Strava utilise OAuth 2.0 et les jetons restent dans des cookies sécurisés non accessibles au JavaScript du navigateur.

## Fonctionnalités

- synchronisation du profil et des activités Strava ;
- indicateurs de volume, allure, fréquence cardiaque et dénivelé ;
- comparaison des statistiques annuelles ;
- suivi de la charge d’entraînement et de la récupération ;
- estimation des performances sur 5 km, 10 km, semi-marathon et marathon ;
- calcul des meilleurs efforts à partir des flux et segments Strava ;
- recommandations pour la prochaine séance ;
- export des séances au format TCX ;
- suivi facultatif du sommeil ;
- suivi de l’utilisation des chaussures.

## Architecture

```text
strava-front/                 Interface React et TypeScript
Controllers/                 Endpoints HTTP de l’API
Services/                    Calculs et logique métier
Infrastructure/External/    Communication avec Strava
Infrastructure/Persistence/ Stockage local des données calculées
Models/                      Modèles de données
Security/                    Noms et configuration des cookies
FabRun.Api.Tests/            Tests unitaires
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

La session FabRun et le jeton Strava sont enregistrés dans des cookies `HttpOnly`, `Secure` et `SameSite=Lax`. Le jeton Strava est chiffré et authentifié avec les clés Data Protection de l’API. Les endpoints métier nécessitent une session FabRun valide et les requêtes qui modifient des données sont protégées contre les attaques CSRF.

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

## Tests et vérifications

Exécuter les tests de l’API :

```bash
dotnet test FabRun.Api.sln
```

Vérifier l’interface :

```bash
cd strava-front
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
