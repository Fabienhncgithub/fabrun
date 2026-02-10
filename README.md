# FabRun.Api

## Backend
1. Configurer les variables:
   - `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`
   - `FrontendOrigin` si besoin (dans `appsettings.Development.json`)
2. Lancer:
```bash
dotnet run
```

## Frontend
1. Dans `strava-front/.env`, définir:
   - `VITE_API_BASE=https://fabrun.test:3001` (ou votre URL API)
2. Lancer:
```bash
cd strava-front
npm install
npm run dev
```

## Endpoints utiles
- `GET /api/activities` (Authorization: Bearer ...)
- `GET /api/kpis` (Authorization: Bearer ...)
- `GET /api/profile` (Authorization: Bearer ...)
- `GET /api/predict` (Authorization: Bearer ...)
