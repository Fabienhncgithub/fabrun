# Déployer FabRun sur un VPS OVHcloud

Architecture cible :

- `https://fabrun.fabienhance.com` : Caddy, frontend React et HTTPS automatique.
- API .NET 10 : accessible uniquement derrière Caddy.
- Accès privé : mot de passe puis cookie HTTP-only sécurisé, révocable et valable 12 heures.
- Données locales : volume Docker persistant `fabrun-data`.
- Clés de session : volume Docker persistant `fabrun-keys`, afin de conserver les cookies après un redémarrage.
- API et proxy : systèmes de fichiers en lecture seule, capacités Linux minimales et ressources plafonnées.

## 1. Commander et préparer le VPS

Un petit VPS Ubuntu ou Debian suffit. Une fois son IPv4 connue, ouvrir uniquement :

- TCP 22 pour SSH ;
- TCP 80 pour l'émission et la redirection du certificat ;
- TCP et UDP 443 pour HTTPS.

Installer Docker Engine et le plugin Docker Compose depuis les dépôts officiels Docker.

## 2. Configurer le DNS OVH

Dans la zone DNS de `fabienhance.com`, ajouter :

| Type | Sous-domaine | Cible |
| --- | --- | --- |
| A | `fabrun` | IPv4 publique du VPS |

Ajouter aussi un enregistrement AAAA seulement si le VPS possède une IPv6 publique correctement configurée.
Ne pas modifier les enregistrements MX, SPF ou DKIM utilisés par les e-mails.

## 3. Configurer Strava

Dans <https://www.strava.com/settings/api> :

- **Authorization Callback Domain** : `fabrun.fabienhance.com`
- callback utilisé par FabRun : `https://fabrun.fabienhance.com/oauth/callback`

## 4. Copier et configurer FabRun

Sur le VPS :

```bash
git clone https://github.com/Fabienhncgithub/fabrun.git
cd fabrun/deploy
cp .env.production.example .env.production
chmod 600 .env.production
```

Modifier `.env.production` :

```dotenv
FABRUN_DOMAIN=fabrun.fabienhance.com
FABRUN_ACCESS_PASSWORD=un-mot-de-passe-long-unique
FABRUN_SESSION_VERSION=une-valeur-aleatoire-distincte
STRAVA_CLIENT_ID=identifiant-strava
STRAVA_CLIENT_SECRET=secret-strava
```

Le fichier `.env.production` est ignoré par Git. Ne jamais le committer ni envoyer son contenu dans une conversation.
Le mot de passe doit contenir au moins 20 caractères et la version de session au moins 16 caractères.
Générer ces deux valeurs séparément avec un générateur cryptographiquement sûr, par exemple `openssl rand -base64 48`.

## 5. Construire et lancer

```bash
docker compose --env-file .env.production -f compose.yaml up -d --build
docker compose --env-file .env.production -f compose.yaml ps
docker compose --env-file .env.production -f compose.yaml logs -f --tail=100
```

Caddy demande automatiquement un certificat public et renouvelle celui-ci. Le DNS doit déjà pointer vers le VPS et les ports 80/443 doivent être accessibles.

Après ce durcissement, les anciens cookies Strava ne sont plus acceptés car leur contenu n'était pas chiffré par l'application. Une reconnexion Strava unique est donc attendue après le premier déploiement.

Si FabRun utilisait déjà les volumes Caddy avec une ancienne image lancée en tant que `root`, corriger une seule fois leur propriétaire avant le redémarrage :

```bash
docker run --rm --user 0 --entrypoint chown \
  -v deploy_caddy-data:/data \
  -v deploy_caddy-config:/config \
  caddy:2.10.2-alpine -R 10001:10001 /data /config
```

Cette migration permet ensuite à Caddy de fonctionner avec l’utilisateur non privilégié `fabrun`.

## 6. Mettre à jour

```bash
cd fabrun
git pull --ff-only
cd deploy
docker compose --env-file .env.production -f compose.yaml up -d --build
```

## 7. Sauvegarder les données

Les volumes `deploy_fabrun-data` et `deploy_fabrun-keys` contiennent les fichiers persistants et les clés de session. Les sauvegarder régulièrement avant toute migration ou suppression de conteneurs/volumes.
Chiffrer les sauvegardes et limiter leur lecture au compte d'administration du serveur.

Ne jamais exécuter `docker compose down -v` en production : l'option `-v` supprime les volumes et leurs données.

## 8. Révoquer toutes les sessions

Pour invalider immédiatement tous les cookies FabRun existants :

1. remplacer `FABRUN_SESSION_VERSION` par une nouvelle valeur aléatoire ;
2. redéployer les conteneurs ;
3. changer aussi `FABRUN_ACCESS_PASSWORD` si le mot de passe a pu être exposé.

## 9. Contrôles après déploiement

```bash
docker compose --env-file .env.production -f compose.yaml config
docker compose --env-file .env.production -f compose.yaml ps
curl -I https://fabrun.fabienhance.com
```

Vérifier que seuls les ports 22, 80 et 443 sont publiés par le serveur et que le service `api` ne possède aucun port hôte.
