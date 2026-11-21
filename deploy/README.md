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

## 3. Créer la clé Garmin

Créer une clé personnelle sur <https://connect.garmin.com/app/settings/personalApiToken>.
Toutes les activités viennent de Garmin : sans clé, seule l’archive importée s’affiche.

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
GARMIN_PERSONAL_API_KEY=cle-personnelle-garmin
```

La clé Garmin reste côté serveur et n’est jamais envoyée au navigateur. Elle est
obligatoire en production.

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

### Importer l’historique Strava et les chaussures

L’archive des séances antérieures à la montre (`strava-archive.json`) et le registre
des chaussures (`shoes.json`) sont produits une fois, en local. Les copier dans le
volume de données avant le premier lancement de cette version :

```bash
# Depuis le poste local
scp Data/strava-archive.json Data/shoes.json vps:~/fabrun-import/

# Sur le VPS, depuis fabrun/deploy
docker compose --env-file .env.production -f compose.yaml stop api
docker run --rm -v deploy_fabrun-data:/data -v ~/fabrun-import:/import:ro alpine:3.20 \
  sh -c 'cp /import/strava-archive.json /import/shoes.json /data/ \
    && chown 1654:1654 /data/strava-archive.json /data/shoes.json \
    && chmod 600 /data/strava-archive.json /data/shoes.json'
docker compose --env-file .env.production -f compose.yaml up -d api
rm -r ~/fabrun-import
```

Les préférences, le sommeil et les meilleurs efforts déjà présents dans le volume
restent valables : ils sont rattachés au même identifiant que l’archive.

Si FabRun utilisait déjà les volumes Caddy avec une ancienne image lancée en tant que `root`, corriger une seule fois leur propriétaire avant le redémarrage :

```bash
docker run --rm --user 0 --entrypoint chown \
  -v deploy_caddy-data:/data \
  -v deploy_caddy-config:/config \
  caddy:2.10.2-alpine -R 10001:10001 /data /config
```

Cette migration permet ensuite à Caddy de fonctionner avec l’utilisateur non privilégié `fabrun`.

## Sites hébergés à côté de FabRun

Le conteneur Caddy de FabRun sert aussi de reverse proxy aux autres projets du VPS. Il importe
chaque fichier `deploy/sites/*.caddy` et rejoint le réseau Docker `photography-edge`, à créer
une seule fois :

```bash
docker network create photography-edge
```

Chaque projet publie lui-même son fichier dans `deploy/sites/` puis recharge Caddy ; ces
fichiers ne sont pas versionnés ici. Un redéploiement de FabRun conserve donc les autres sites,
sans fichier d'override à ne pas oublier.

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
