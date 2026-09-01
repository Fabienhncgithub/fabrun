import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchAccessStatus,
  fetchStravaStatus,
  fetchDashboard,
  fetchRunningPredictions,
  fetchAthleteSettings,
  updateAthleteSettings,
  loginWithPassword,
  logoutAccess,
  ApiRequestError,
  type Activity,
  type AthleteSettings,
  type AthleteSettingsInput,
  type GoalRaceInput,
  type Kpis,
  type PredictionResponse,
  type Profile,
  type SleepSummary,
} from "./api";
import ActivitiesTable from "./components/ActivitiesTable";
import KpisCard from "./components/KpisCard";
import TrainingLoadCard from "./components/TrainingLoadCard";
import FormTrendCard from "./components/FormTrendCard";
import ShoeUsageCard from "./components/ShoeUsageCard";
import PerformancePredictionsCard from "./components/PerformancePredictionsCard";
import GoalRaceCard from "./components/GoalRaceCard";
import WeeklyKmChartCard from "./components/WeeklyKmChartCard";
import YearHeatmapCard from "./components/YearHeatmapCard";
import AcrAlertBanner from "./components/AcrAlertBanner";
import NextSessionCard from "./components/NextSessionCard";
import WeeklyTrainingPlanCard from "./components/WeeklyTrainingPlanCard";
import WeeklyEnergyCard from "./components/WeeklyEnergyCard";
import CardErrorBoundary from "./components/CardErrorBoundary";
import DashboardSkeleton from "./components/DashboardSkeleton";
import AthleteProfileSettingsCard from "./components/AthleteProfileSettingsCard";
import EmptyState from "./components/EmptyState";
import { applyTheme, resolveInitialTheme, type Theme } from "./utils/theme";
import "./App.scss";

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  const dark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={dark ? "Activer le thème clair" : "Activer le thème sombre"}
      title={dark ? "Thème clair" : "Thème sombre"}
    >
      <span aria-hidden>{dark ? "☀" : "☾"}</span>
      <span>{dark ? "Clair" : "Sombre"}</span>
    </button>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const initialLoadDoneRef = useRef(false);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [heatmapRows, setHeatmapRows] = useState<Activity[] | null>(null);
  const [kpisAllTime, setKpisAllTime] = useState<Kpis | null>(null);
  const [kpisCurrentYear, setKpisCurrentYear] = useState<Kpis | null>(null);
  const [kpisPreviousYear, setKpisPreviousYear] = useState<Kpis | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sleepSummary, setSleepSummary] = useState<SleepSummary | null>(null);
  const [predictions, setPredictions] = useState<PredictionResponse | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState<boolean | null>(null);
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  // Server-backed (Data/athlete-settings.json) rather than localStorage, so
  // the shin-pain mode and goal race follow the athlete across devices.
  const [athleteSettings, setAthleteSettings] = useState<AthleteSettings | null>(null);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [athleteSettingsError, setAthleteSettingsError] = useState<string | null>(null);
  const hasShinPain = athleteSettings?.hasShinPain ?? false;
  const shoePreferences = athleteSettings?.shoePreferences ?? [];
  const ageYears = athleteSettings?.ageYears ?? null;
  const sex = athleteSettings?.sex ?? null;
  const calorieProfile = { ageYears, sex };
  const effectiveWeightKg = profile?.weight;

  useEffect(() => applyTheme(theme), [theme]);

  const clearDashboardState = useCallback(() => {
    initialLoadDoneRef.current = false;
    setRows(null);
    setHeatmapRows(null);
    setKpisAllTime(null);
    setKpisCurrentYear(null);
    setKpisPreviousYear(null);
    setProfile(null);
    setSleepSummary(null);
    setPredictions(null);
    setAthleteSettings(null);
    setLastUpdatedAt(null);
  }, []);

  const handleRequestError = useCallback((error: unknown) => {
    if (error instanceof ApiRequestError && error.code === "ACCESS_SESSION_EXPIRED") {
      clearDashboardState();
      setAccessAuthenticated(false);
    } else if (error instanceof ApiRequestError && error.code === "STRAVA_CONNECTION_EXPIRED") {
      initialLoadDoneRef.current = false;
      setStravaConnected(false);
    }
  }, [clearDashboardState]);

  const saveSettings = async (next: AthleteSettingsInput): Promise<boolean> => {
    try {
      setSettingsSaving(true);
      setAthleteSettings(await updateAthleteSettings(next));
      setAthleteSettingsError(null);
      return true;
    } catch (error: unknown) {
      handleRequestError(error);
      const message = errorMessage(error, "Enregistrement des préférences impossible.");
      setAthleteSettingsError(message);
      setErr(message);
      return false;
    } finally {
      setSettingsSaving(false);
    }
  };

  const updateShinPain = (value: boolean): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain: value,
      goalRaces: athleteSettings.goalRaces,
      shoePreferences,
      ageYears,
      sex,
    });
  };

  const goalRaces = athleteSettings?.goalRaces ?? [];

  const addGoalRace = (draft: GoalRaceInput): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain,
      goalRaces: [...goalRaces, draft],
      shoePreferences,
      ageYears,
      sex,
    });
  };

  const updateGoalRace = (id: string, draft: GoalRaceInput): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain,
      goalRaces: goalRaces.map((race) => (race.id === id ? { ...draft, id } : race)),
      shoePreferences,
      ageYears,
      sex,
    });
  };

  const deleteGoalRace = (id: string): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain,
      goalRaces: goalRaces.filter((race) => race.id !== id),
      shoePreferences,
      ageYears,
      sex,
    });
  };

  const updateShoeRetirement = (gearId: string, retirementKm: number): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain,
      goalRaces,
      shoePreferences: [
        ...shoePreferences.filter((preference) => preference.gearId !== gearId),
        { gearId, retirementKm, brand: shoePreferences.find((p) => p.gearId === gearId)?.brand ?? null },
      ],
      ageYears,
      sex,
    });
  };

  const updateShoeBrand = (gearId: string, brand: string | null): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({
      hasShinPain,
      goalRaces,
      shoePreferences: [
        ...shoePreferences.filter((preference) => preference.gearId !== gearId),
        {
          gearId,
          retirementKm:
            shoePreferences.find((p) => p.gearId === gearId)?.retirementKm ?? 800,
          brand,
        },
      ],
      ageYears,
      sex,
    });
  };

  const updateCalorieProfile = (
    nextAgeYears: number | null,
    nextSex: "male" | "female" | null
  ): Promise<boolean> => {
    if (!athleteSettings) return Promise.resolve(false);
    return saveSettings({ hasShinPain, goalRaces, shoePreferences, ageYears: nextAgeYears, sex: nextSex });
  };

  const reloadAthleteSettings = async () => {
    try {
      setSettingsLoading(true);
      setAthleteSettingsError(null);
      setAthleteSettings(await fetchAthleteSettings());
    } catch (error: unknown) {
      handleRequestError(error);
      setAthleteSettingsError(errorMessage(error, "Chargement des préférences impossible."));
    } finally {
      setSettingsLoading(false);
    }
  };

  const login = () => {
    const front = encodeURIComponent(window.location.origin);
    location.href = `${API}/auth/login?front=${front}`;
  };

  const submitAccess = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setAccessLoading(true);
      setAccessError(null);
      await loginWithPassword(accessPassword);
      setAccessPassword("");
      initialLoadDoneRef.current = false;
      setStravaConnected(await fetchStravaStatus());
      setAccessAuthenticated(true);
    } catch (error: unknown) {
      setAccessError(errorMessage(error, "Connexion impossible."));
    } finally {
      setAccessLoading(false);
    }
  };

  const disconnectAccess = async () => {
    try {
      setAccessLoading(true);
      await logoutAccess();
      clearDashboardState();
      setStravaConnected(false);
      setAccessAuthenticated(false);
    } catch (error: unknown) {
      setErr(errorMessage(error, "Fermeture de la session impossible."));
    } finally {
      setAccessLoading(false);
    }
  };

  const loadAll = useCallback(async (refresh = false) => {
    try {
      setLoading(true);
      setSettingsLoading(true);
      setErr(null);
      const data = await fetchDashboard(refresh);
      setRows(data.activities ?? null);
      setHeatmapRows(data.heatmapActivities ?? data.activities ?? null);
      setKpisAllTime(data.kpis ?? null);
      setKpisCurrentYear(data.kpisCurrentYear ?? data.kpis ?? null);
      setKpisPreviousYear(data.kpisPreviousYear ?? null);
      setProfile(data.profile ?? null);
      setSleepSummary(data.sleep ?? null);
      setPredictionsLoading(true);
      setAthleteSettingsError(null);
      const [predictionResult, settingsResult] = await Promise.allSettled([
        fetchRunningPredictions(refresh),
        fetchAthleteSettings(),
      ]);

      if (predictionResult.status === "fulfilled") {
        setPredictions(predictionResult.value ?? null);
      } else {
        handleRequestError(predictionResult.reason);
        if (predictionResult.reason instanceof ApiRequestError) setErr(predictionResult.reason.message);
      }

      if (settingsResult.status === "fulfilled") {
        setAthleteSettings(settingsResult.value);
      } else {
        handleRequestError(settingsResult.reason);
        const message = errorMessage(settingsResult.reason, "Chargement des préférences impossible.");
        setAthleteSettingsError(message);
        setErr(message);
      }
      setPredictionsLoading(false);
      setSettingsLoading(false);
      setLastUpdatedAt(new Date());
    } catch (error: unknown) {
      handleRequestError(error);
      if (error instanceof ApiRequestError && error.code === "ACCESS_SESSION_EXPIRED") {
        setAccessAuthenticated(false);
        return;
      }
      // Keep the last successful dashboard visible if a manual refresh fails.
      // On the first load rows is already null and the retry state below is shown.
      setErr(errorMessage(error, "Chargement impossible."));
    } finally {
      setLoading(false);
      setSettingsLoading(false);
    }
  }, [handleRequestError]);

  const settingsFallback = (
    <EmptyState
      title={settingsLoading ? "Chargement des préférences…" : "Préférences indisponibles"}
      message={
        athleteSettingsError
          ? "Les données enregistrées ont été conservées. Réessaie avant de modifier ce profil."
          : "Les préférences athlète sont en cours de chargement."
      }
      action={
        athleteSettingsError ? (
          <button className="btn btn-secondary" type="button" onClick={reloadAthleteSettings} disabled={settingsLoading}>
            Réessayer
          </button>
        ) : undefined
      }
    />
  );

  useEffect(() => {
    fetchAccessStatus()
      .then(async (authenticated) => {
        setAccessAuthenticated(authenticated);
        setStravaConnected(authenticated ? await fetchStravaStatus() : false);
      })
      .catch(() => setAccessAuthenticated(false));
  }, []);

  useEffect(() => {
    if (!accessAuthenticated || !stravaConnected || initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    loadAll();
  }, [accessAuthenticated, stravaConnected, loadAll]);

  if (accessAuthenticated == null) {
    return (
      <div className="access-shell">
        <div className="access-card">
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          <div className="access-brand">FabRun</div><p>Vérification de la session…</p>
        </div>
      </div>
    );
  }

  if (!accessAuthenticated) {
    return (
      <div className="access-shell">
        <form className="access-card" onSubmit={submitAccess}>
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          <div className="access-brand">FabRun</div>
          <h1>Accès privé</h1>
          <p>Entre le mot de passe pour ouvrir ton dashboard d'entraînement.</p>
          <label htmlFor="fabrun-password">Mot de passe</label>
          <input
            id="fabrun-password"
            type="password"
            autoComplete="current-password"
            value={accessPassword}
            onChange={(event) => setAccessPassword(event.target.value)}
            autoFocus
            required
          />
          {accessError && <div className="alert">{accessError}</div>}
          <button className="btn" type="submit" disabled={accessLoading}>
            {accessLoading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-title">FabRun</div>
          <div className="brand-sub">Dashboard d'entraînement</div>
        </div>
        <div className="topbar-actions">
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          {!stravaConnected ? (
            <button className="btn" onClick={login}>
              Se connecter avec Strava
            </button>
          ) : (
            <>
              <span className="chip">Strava connecté</span>
              {lastUpdatedAt && (
                <span className="topbar-last-sync" role="status">
                  Synchro {lastUpdatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              <button className="btn" onClick={() => loadAll(true)} disabled={loading}>
                {loading ? "Chargement..." : "Rafraîchir"}
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={disconnectAccess} disabled={accessLoading}>
            {accessLoading ? "Déconnexion…" : "Tout déconnecter"}
          </button>
        </div>
      </header>

      <main className="main">
        {err && (
          <div className="alert">
            <div>Erreur: {err}</div>
          </div>
        )}

        {!stravaConnected ? (
          <section className="panel">
            <p>Connecte Strava pour charger tes activités.</p>
            <button className="btn" onClick={login}>
              Se connecter avec Strava
            </button>
          </section>
        ) : (
          <>
            {rows && (
              <CardErrorBoundary title="Alerte charge d'entraînement">
                <AcrAlertBanner rows={rows} />
              </CardErrorBoundary>
            )}

            <nav className="dashboard-nav" aria-label="Accès rapide aux fonctions">
              <a href="#plan-semaine"><span>01</span><strong>Semaine</strong><small>Km à faire, plan adaptatif</small></a>
              <a href="#aujourdhui"><span>02</span><strong>Aujourd'hui</strong><small>Charge et douleur</small></a>
              <a href="#recuperation"><span>03</span><strong>Récupération</strong><small>Sommeil et forme</small></a>
              <a href="#activites"><span>04</span><strong>Activités</strong><small>Recherche et export</small></a>
              <a href="#objectifs"><span>05</span><strong>Objectifs</strong><small>Courses et temps</small></a>
              <a href="#chaussures"><span>06</span><strong>Chaussures</strong><small>Usure par paire</small></a>
            </nav>

            {loading && !rows ? (
              <DashboardSkeleton />
            ) : !rows ? (
              <section className="panel">
                <EmptyState
                  icon="↻"
                  title="Dashboard indisponible"
                  message="Les données n'ont pas pu être chargées. La connexion est conservée."
                  action={
                    <button className="btn" type="button" onClick={() => loadAll()}>
                      Réessayer
                    </button>
                  }
                />
              </section>
            ) : (
              <>
                {/* First thing shown: what to run, right now - the primary reason to open the app. */}
                <section className="panel">
                  <CardErrorBoundary title="Prochaine séance">
                    {rows && (
                      <NextSessionCard rows={rows} predictions={predictions} hasShinPain={hasShinPain} />
                    )}
                  </CardErrorBoundary>
                </section>

                <section className="panel" id="plan-semaine">
                  <CardErrorBoundary title="Plan de la semaine">
                    {rows && (
                      <WeeklyTrainingPlanCard
                        rows={rows}
                        predictions={predictions}
                        hasShinPain={hasShinPain}
                      />
                    )}
                  </CardErrorBoundary>
                </section>

                <section className="panel">
                  <CardErrorBoundary title="Charge de course">
                    {rows && <WeeklyKmChartCard rows={rows} />}
                  </CardErrorBoundary>
                </section>

                <CardErrorBoundary title="Activité de l'année">
                  {(heatmapRows ?? rows) && <YearHeatmapCard rows={heatmapRows ?? rows ?? []} />}
                </CardErrorBoundary>

                <section className="panel" id="aujourdhui">
                  <CardErrorBoundary title="Charge d'entraînement">
                    {rows && (
                      <TrainingLoadCard
                        rows={rows}
                        hasShinPain={hasShinPain}
                        onShinPainChange={updateShinPain}
                        settingsSaving={settingsSaving || athleteSettings == null}
                      />
                    )}
                  </CardErrorBoundary>
                </section>

                <section className="panel" id="recuperation">
                  <CardErrorBoundary title="Évolution de forme">
                    {rows && <FormTrendCard rows={rows} sleep={sleepSummary} />}
                  </CardErrorBoundary>
                </section>

                <section className="panel">
                  <CardErrorBoundary title="Énergie et activité">
                    {rows && (
                      <WeeklyEnergyCard rows={rows} athleteWeightKg={effectiveWeightKg} calorieProfile={calorieProfile} />
                    )}
                  </CardErrorBoundary>
                </section>

                <section className="panel">
                  <CardErrorBoundary title="Profil de calcul">
                    {athleteSettings ? (
                      <AthleteProfileSettingsCard
                        key={`${ageYears ?? "none"}-${sex ?? "none"}`}
                        ageYears={ageYears}
                        sex={sex}
                        saving={settingsSaving}
                        onSaveCalorieProfile={updateCalorieProfile}
                      />
                    ) : settingsFallback}
                  </CardErrorBoundary>
                </section>

                <section className="panel">
                  <CardErrorBoundary title="KPIs">
                    {kpisAllTime && kpisCurrentYear && kpisPreviousYear && (
                      <KpisCard
                        allTime={kpisAllTime}
                        currentYear={kpisCurrentYear}
                        previousYear={kpisPreviousYear}
                        rows={rows ?? []}
                      />
                    )}
                  </CardErrorBoundary>
                </section>
                <section className="panel" id="activites">
                  <CardErrorBoundary title="Activités">
                    {rows && (
                      <ActivitiesTable
                        rows={rows}
                        athleteWeightKg={effectiveWeightKg}
                        calorieProfile={calorieProfile}
                        shoes={profile?.shoes ?? []}
                      />
                    )}
                  </CardErrorBoundary>
                </section>
                <section className="panel" id="objectifs">
                  <CardErrorBoundary title="Objectifs course">
                    {athleteSettings ? (
                      <GoalRaceCard
                        goalRaces={athleteSettings.goalRaces}
                        predictions={predictions}
                        onAdd={addGoalRace}
                        onUpdate={updateGoalRace}
                        onDelete={deleteGoalRace}
                        saving={settingsSaving}
                      />
                    ) : settingsFallback}
                  </CardErrorBoundary>
                </section>

                {stravaConnected && (
                  <CardErrorBoundary title="Estimations actuelles">
                    <PerformancePredictionsCard
                      data={predictions}
                      loading={predictionsLoading}
                      onRefresh={async () => {
                        try {
                          setPredictionsLoading(true);
                          const p = await fetchRunningPredictions(true);
                          setPredictions(p ?? null);
                        } catch (error: unknown) {
                          handleRequestError(error);
                          setErr(errorMessage(error, "Actualisation impossible."));
                        } finally {
                          setPredictionsLoading(false);
                        }
                      }}
                    />
                  </CardErrorBoundary>
                )}
                <section className="panel" id="chaussures">
                  <CardErrorBoundary title="Gears">
                    <ShoeUsageCard
                      shoes={profile?.shoes ?? []}
                      rows={rows ?? []}
                      preferences={shoePreferences}
                      saving={settingsSaving || athleteSettings == null}
                      onRetirementKmChange={updateShoeRetirement}
                      onBrandChange={updateShoeBrand}
                    />
                  </CardErrorBoundary>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
