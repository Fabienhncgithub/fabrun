# Interface FabRun

Interface React et TypeScript du tableau de bord FabRun.

## Développement

Copier la configuration d’exemple puis installer les dépendances :

```bash
cp .env.example .env
npm ci
npm run dev
```

Par défaut, l’interface appelle l’API locale à l’adresse `https://localhost:3001`.

## Styles

Les styles suivent les mêmes conventions que le portfolio principal :

- `src/styles/base.scss` contient les tokens, le reset et les règles d’accessibilité ;
- `src/styles/_breakpoints.scss` centralise les seuils responsive ;
- `src/App.scss` contient uniquement les styles du dashboard et de ses cartes ;
- aucune police ou feuille de style n’est chargée depuis un CDN.

## Vérifications

```bash
npm run lint
npm run build
npm audit --omit=dev
```

La configuration de production est injectée pendant la construction de l’image Docker. Les fichiers `.env` locaux ne doivent jamais être commités.
