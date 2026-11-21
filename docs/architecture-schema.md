# FabRun Architecture Schema

## Mermaid Diagram

```mermaid
flowchart TD
    subgraph Frontend[Frontend - React/Vite - web/]
        App[App.tsx]
        Api[api.ts]
        UI1[ActivitiesTable]
        UI2[KpisCard / SkiCard]
        UI3[TrainingLoadCard]
        UI4[ShoeUsageCard]
        UI5[PerformancePredictionsCard]

        App --> Api
        App --> UI1
        App --> UI2
        App --> UI3
        App --> UI4
        App --> UI5
    end

    subgraph Backend[Backend - ASP.NET Core]
        Program[Program.cs\nDI + CORS + auth + rate limits]

        subgraph Controllers
            CAccess[AccessController]
            CAct[ActivitiesController]
            CShoes[ShoesController]
            CPred[PredictionsController]
            CGarmin[GarminController]
            CSleep[HealthSleepController]
        end

        subgraph Services
            SAct[ActivityService\nGarmin + archive]
            SGarmin[GarminService\nHTTP Garmin + cache 15 min]
            SFit[FitStreams\nFIT distance/time]
            SShoes[ShoeService\ndefault + per run]
            SBest[BestEffortsService]
            SSleep[HealthSleepService]
            SMath[PredictionMath]
        end

        Program --> Controllers
        CAct --> SAct
        CAct --> SSleep
        CShoes --> SShoes
        CShoes --> SAct
        CPred --> SAct
        CPred --> SBest
        CPred --> SMath
        CGarmin --> SGarmin
        CSleep --> SSleep
        SAct --> SGarmin
        SAct --> SShoes
        SBest --> SGarmin
        SGarmin --> SFit
    end

    Garmin[(Garmin Connect Personal API\npersonal.connectapi.garmin.com)]
    Archive[(Data/strava-archive.json\nread-only)]
    Shoes[(Data/shoes.json)]
    Store[(Data/best-efforts.json\nhealth-sleep.json\nathlete-settings.json)]

    Api -->|session cookie + CSRF| Controllers
    SGarmin -->|server-side key| Garmin
    SAct --> Archive
    SShoes --> Shoes
    SBest --> Store
    SSleep --> Store
```

## Files

- Mermaid source: `docs/architecture-schema.mmd`
- Markdown preview: `docs/architecture-schema.md`

## Export to PNG/SVG

- Open `docs/architecture-schema.mmd` in Mermaid Live Editor.
- Export as SVG or PNG.
