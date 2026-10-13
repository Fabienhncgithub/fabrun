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
import WeeklyRampAlertBanner from "./components/WeeklyRampAlertBanner";
import NextSessionCard from "./components/NextSessionCard";
import WeeklyTrainingPlanCard from "./components/WeeklyTrainingPlanCard";
import WeeklyEnergyCard from "./components/WeeklyEnergyCard";
import CardErrorBoundary from "./components/CardErrorBoundary";
import DashboardSkeleton from "./components/DashboardSkeleton";
import AthleteProfileSettingsCard from "./components/AthleteProfileSettingsCard";
import EmptyState from "./components/EmptyState";
import DashboardNav from "./components/DashboardNav";
import { dashboardPageFromHash, dashboardPages } from "./utils/dashboardNavigation";
import { applyTheme, resolveInitialTheme, type Theme } from "./utils/theme";
import "./App.scss";
import "./styles/dashboard.scss";

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
const PENDING_SHIN_PAIN_KEY = "fabrun_pending_shin_pain";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

function readPendingShinPain(): boolean | null {
  const stored = localStorage.getItem(PENDING_SHIN_PAIN_KEY);
  if (stored === "true") return true;
  if (stored === "false") return false;
  return null;
}

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
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const [activePage, setActivePage] = useState(() => dashboardPageFromHash(location.hash));
  const page = dashboardPages.find((item) => item.id === activePage)!;
  const [theme, setTheme] = useState<Theme>(resolveInitialTheme);
  const initialLoadDoneRef = useRef(false);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [heatmapRows, setHeatmapRows] = useState<Activity[] | null>(null);
  const [kpisAllTime, setKpisAllTime] = useState<Kpis | null>(null);
  const [kpisCurrentYear, setKpisCurrentYear] = useState<Kpis | null>(null);
  const [kpisPreviousYear, setKpisPreviousYear] = useState<Kpis | null>(null);
  const [kpisTwoYearsAgo, setKpisTwoYearsAgo] = useState<Kpis | null>(null);
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
  const [pendingShinPain, setPendingShinPain] = useState<boolean | null>(readPendingShinPain);
  const [shinPainSyncError, setShinPainSyncError] = useState<string | null>(null);
  const hasShinPain = pendingShinPain ?? athleteSettings?.hasShinPain ?? false;
  const shoePreferences = athleteSettings?.shoePreferences ?? [];
  const ageYears = athleteSettings?.ageYears ?? null;
  const sex = athleteSettings?.sex ?? null;
  const calorieProfile = { ageYears, sex };
  const effectiveWeightKg = profile?.weight;

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const closeMenu = (event: PointerEvent | KeyboardEvent) => {
      const menu = accountMenuRef.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      } else if (event instanceof PointerEvent && !menu.contains(event.target as Node)) {
        menu.open = false;
      }
    };
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, []);

  useEffect(() => {
    const navigate = () => {
      if (location.hash === "#dashboard-content") return;
      setActivePage(dashboardPageFromHash(location.hash));
      requestAnimationFrame(() => {
        if (dashboardPages.some((item) => `#${item.id}` === location.hash)) {
          window.scrollTo({ top: 0, behavior: "instant" });
        } else {
          document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
        }
      });
    };
    window.addEventListener("hashchange", navigate);
    return () => window.removeEventListener("hashchange", navigate);
  }, []);

  const clearDashboardState = useCallback(() => {
    initialLoadDoneRef.current = false;
    setRows(null);
    setHeatmapRows(null);
    setKpisAllTime(null);
    setKpisCurrentYear(null);
    setKpisPreviousYear(null);
    setKpisTwoYearsAgo(null);
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

  const updateShinPain = async (value: boolean): Promise<boolean> => {
    // The safety advice must react immediately, even if the settings API is
    // temporarily unavailable. This pending value is cleared as soon as the
    // server confirms the change and otherwise remains as a local fallback.
    localStorage.setItem(PENDING_SHIN_PAIN_KEY, String(value));
    setPendingShinPain(value);
    setShinPainSyncError(null);

    if (!athleteSettings) {
      setShinPainSyncError("Choix appliqué sur cet appareil. Réessaie lorsque les préférences seront disponibles.");
      return false;
    }

    const saved = await saveSettings({
      hasShinPain: value,
      goalRaces: athleteSettings.goalRaces,
      shoePreferences,
      ageYears,
      sex,
    });

    if (saved) {
      localStorage.removeItem(PENDING_SHIN_PAIN_KEY);
      setPendingShinPain(null);
      setShinPainSyncError(null);
    } else {
      setShinPainSyncError("Choix appliqué sur cet appareil, mais la synchronisation avec le serveur a échoué.");
    }

    return saved;
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
      setKpisTwoYearsAgo(data.kpisTwoYearsAgo ?? null);
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

  const painModeKnown = athleteSettings !== null || pendingShinPain !== null;

  return (
    <div className="app dashboard-app">
      <a className="skip-link" href="#dashboard-content">Aller au contenu</a>
      <header className="topbar">
        <div className="brand-block">
          <a className="brand-title" href="#entrainement" aria-label="FabRun — accueil">Fab<span>Run</span><i aria-hidden="true" /></a>
          <div className="brand-sub">Ton carnet d’entraînement</div>
        </div>
        <div className="topbar-actions">
          {stravaConnected && lastUpdatedAt && (
            <span className="topbar-last-sync" role="status">
              <i aria-hidden="true" /> À jour à {lastUpdatedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          {stravaConnected && (
            <button className="btn sync-button" type="button" aria-label={loading ? "Synchronisation en cours" : "Synchroniser les activités Strava"} onClick={() => loadAll(true)} disabled={loading}>
              <span className={loading ? "sync-icon sync-icon-loading" : "sync-icon"} aria-hidden="true">↻</span>
              <span className="sync-button-label">{loading ? "Synchronisation…" : "Synchroniser"}</span>
            </button>
          )}
          <details className="account-menu" ref={accountMenuRef}>
            <summary aria-label="Menu du compte">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 21v-3a7 7 0 0 1 14 0v3" /></svg>
            </summary>
            <div className="account-menu-panel">
              <span>{stravaConnected ? "Strava connecté" : "Strava non connecté"}</span>
              <button type="button" onClick={disconnectAccess} disabled={accessLoading}>
                {accessLoading ? "Déconnexion…" : "Se déconnecter"}
              </button>
            </div>
          </details>
        </div>
      </header>

      <main className="main" id="dashboard-content" tabIndex={-1}>
        {err && (
          <div className="alert dashboard-error" role="alert">
            <div><strong>Actualisation impossible</strong><p>{rows ? "Tes dernières données restent affichées. Tu peux réessayer." : err}</p></div>
            <button className="btn btn-secondary" type="button" onClick={() => loadAll(true)} disabled={loading}>Réessayer</button>
            {rows && <details><summary>Détail de l’erreur</summary><p>{err}</p></details>}
          </div>
        )}

        {!stravaConnected ? (
          <section className="panel connect-panel">
            <span className="dashboard-eyebrow">Bienvenue sur FabRun</span>
            <h1>Ton entraînement commence ici.</h1>
            <p>Connecte Strava pour retrouver tes sorties et un plan adapté à ton activité.</p>
            <button className="btn" type="button" onClick={login}>Se connecter avec Strava</button>
          </section>
        ) : (
          <>
            <DashboardNav activePage={activePage} />
            <div className="dashboard-page-heading">
              <div>
                <span className="dashboard-eyebrow">{new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</span>
                <h1 id="dashboard-page-title">{page.title}</h1>
                <p>{page.description}</p>
              </div>
              {activePage === "entrainement" && painModeKnown && hasShinPain && <span className="dashboard-mode"><i aria-hidden="true" />Mode prudent</span>}
            </div>

            {loading && !rows ? (
              <div role="status" aria-label="Chargement du tableau de bord"><DashboardSkeleton /></div>
            ) : !rows ? (
              <section className="panel"><EmptyState icon="↻" title="Données indisponibles" message="Tes activités n’ont pas pu être chargées. Ta connexion est conservée." action={<button className="btn" type="button" onClick={() => loadAll()}>Réessayer</button>} /></section>
            ) : (
              <>
                <div className="dashboard-view training-view" id="entrainement" hidden={activePage !== "entrainement"} aria-labelledby="dashboard-page-title">
                  <div className="training-alerts">
                    <CardErrorBoundary title="Alerte charge d’entraînement"><AcrAlertBanner rows={rows} /></CardErrorBoundary>
                    <CardErrorBoundary title="Alerte progression hebdomadaire"><WeeklyRampAlertBanner rows={rows} /></CardErrorBoundary>
                  </div>
                  {painModeKnown ? (
                    <>
                      <section className="panel today-panel" id="aujourdhui">
                        <CardErrorBoundary title="Conseil du jour">
                          <TrainingLoadCard rows={rows} hasShinPain={hasShinPain} onShinPainChange={updateShinPain} settingsSaving={settingsSaving} settingsError={shinPainSyncError}>
                            {!hasShinPain && <NextSessionCard embedded rows={rows} predictions={predictions} hasShinPain={hasShinPain} />}
                          </TrainingLoadCard>
                        </CardErrorBoundary>
                      </section>
                      <section className="panel week-panel" id="plan-semaine">
                        <CardErrorBoundary title="Plan de la semaine"><WeeklyTrainingPlanCard rows={rows} predictions={predictions} hasShinPain={hasShinPain} /></CardErrorBoundary>
                      </section>
                    </>
                  ) : (
                    <section className="panel">{settingsFallback}</section>
                  )}
                </div>

                <div className="dashboard-view" id="progression" hidden={activePage !== "progression"} aria-labelledby="dashboard-page-title">
                  <section className="panel"><CardErrorBoundary title="Bilan d’activité">
                    {kpisAllTime && kpisCurrentYear && kpisPreviousYear && <KpisCard allTime={kpisAllTime} currentYear={kpisCurrentYear} previousYear={kpisPreviousYear} twoYearsAgo={kpisTwoYearsAgo} />}
                  </CardErrorBoundary></section>
                  <section className="panel"><CardErrorBoundary title="Kilomètres de course"><WeeklyKmChartCard rows={rows} /></CardErrorBoundary></section>
                  <CardErrorBoundary title="Activité de l’année"><YearHeatmapCard rows={heatmapRows ?? rows} /></CardErrorBoundary>
                </div>

                <div className="dashboard-view" id="recuperation" hidden={activePage !== "recuperation"} aria-labelledby="dashboard-page-title">
                  <section className="panel"><CardErrorBoundary title="Évolution de forme"><FormTrendCard rows={rows} sleep={sleepSummary} /></CardErrorBoundary></section>
                  <section className="panel"><CardErrorBoundary title="Énergie et activité"><WeeklyEnergyCard rows={rows} athleteWeightKg={effectiveWeightKg} calorieProfile={calorieProfile} /></CardErrorBoundary></section>
                  <details className="panel profile-settings"><summary>Ton profil de calcul</summary><CardErrorBoundary title="Profil de calcul">
                    {athleteSettings ? <AthleteProfileSettingsCard key={`${ageYears ?? "none"}-${sex ?? "none"}`} ageYears={ageYears} sex={sex} saving={settingsSaving} onSaveCalorieProfile={updateCalorieProfile} /> : settingsFallback}
                  </CardErrorBoundary></details>
                </div>

                <div className="dashboard-view" id="activites" hidden={activePage !== "activites"} aria-labelledby="dashboard-page-title">
                  <section className="panel"><CardErrorBoundary title="Activités"><ActivitiesTable rows={rows} athleteWeightKg={effectiveWeightKg} calorieProfile={calorieProfile} shoes={profile?.shoes ?? []} /></CardErrorBoundary></section>
                </div>

                <div className="dashboard-view" id="objectifs" hidden={activePage !== "objectifs"} aria-labelledby="dashboard-page-title">
                  <section className="panel"><CardErrorBoundary title="Objectifs de course">
                    {athleteSettings ? <GoalRaceCard goalRaces={athleteSettings.goalRaces} predictions={predictions} onAdd={addGoalRace} onUpdate={updateGoalRace} onDelete={deleteGoalRace} saving={settingsSaving} /> : settingsFallback}
                  </CardErrorBoundary></section>
                  <CardErrorBoundary title="Estimations de course"><PerformancePredictionsCard data={predictions} loading={predictionsLoading} onRefresh={async () => {
                    try { setPredictionsLoading(true); setPredictions(await fetchRunningPredictions(true) ?? null); }
                    catch (error: unknown) { handleRequestError(error); setErr(errorMessage(error, "Actualisation impossible.")); }
                    finally { setPredictionsLoading(false); }
                  }} /></CardErrorBoundary>
                </div>

                <div className="dashboard-view" id="equipement" hidden={activePage !== "equipement"} aria-labelledby="dashboard-page-title">
                  <section className="panel" id="chaussures"><CardErrorBoundary title="Chaussures"><ShoeUsageCard shoes={profile?.shoes ?? []} rows={rows} preferences={shoePreferences} saving={settingsSaving || athleteSettings == null} onRetirementKmChange={updateShoeRetirement} onBrandChange={updateShoeBrand} /></CardErrorBoundary></section>
                </div>
              </>
            )}
            <footer className="dashboard-footer"><span>FabRun · ton carnet d’entraînement</span><span>Les estimations restent des repères, adaptés à ton ressenti.</span></footer>
          </>
        )}
      </main>
    </div>
  );
}
