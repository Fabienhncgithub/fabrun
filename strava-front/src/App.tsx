import { useEffect, useRef, useState } from "react";
import {
  fetchAccessStatus,
  fetchStravaStatus,
  fetchDashboard,
  fetchRunningPredictions,
  loginWithPassword,
  logoutAccess,
  type Activity,
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
import WeeklyKmChartCard from "./components/WeeklyKmChartCard";
import NextSessionCard from "./components/NextSessionCard";
import WeeklyTrainingPlanCard from "./components/WeeklyTrainingPlanCard";
import WeeklyEnergyCard from "./components/WeeklyEnergyCard";
import "./App.scss";

const API = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

export default function App() {
  const initialLoadDoneRef = useRef(false);
  const [rows, setRows] = useState<Activity[] | null>(null);
  const [kpisAllTime, setKpisAllTime] = useState<Kpis | null>(null);
  const [kpisCurrentYear, setKpisCurrentYear] = useState<Kpis | null>(null);
  const [kpisPreviousYear, setKpisPreviousYear] = useState<Kpis | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sleepSummary, setSleepSummary] = useState<SleepSummary | null>(null);
  const [predictions, setPredictions] = useState<PredictionResponse | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accessAuthenticated, setAccessAuthenticated] = useState<boolean | null>(null);
  const [stravaConnected, setStravaConnected] = useState<boolean | null>(null);
  const [accessPassword, setAccessPassword] = useState("");
  const [accessError, setAccessError] = useState<string | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [hasShinPain, setHasShinPain] = useState(
    () => localStorage.getItem("fabrun_shin_pain") === "true"
  );

  const updateShinPain = (value: boolean) => {
    localStorage.setItem("fabrun_shin_pain", String(value));
    setHasShinPain(value);
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
      setAccessAuthenticated(true);
    } catch (error: unknown) {
      setAccessError(errorMessage(error, "Connexion impossible."));
    } finally {
      setAccessLoading(false);
    }
  };

  const disconnectAccess = async () => {
    await logoutAccess();
    setAccessAuthenticated(false);
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await fetchDashboard();
      setRows(data.activities ?? null);
      setKpisAllTime(data.kpis ?? null);
      setKpisCurrentYear(data.kpisCurrentYear ?? data.kpis ?? null);
      setKpisPreviousYear(data.kpisPreviousYear ?? null);
      setProfile(data.profile ?? null);
      setSleepSummary(data.sleep ?? null);
      try {
        setPredictionsLoading(true);
        const p = await fetchRunningPredictions();
        setPredictions(p ?? null);
      } catch {
        setPredictions(null);
      } finally {
        setPredictionsLoading(false);
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "SESSION_ACCESS_EXPIRED") {
        setAccessAuthenticated(false);
        return;
      }
      setRows(null);
      setKpisAllTime(null);
      setKpisCurrentYear(null);
      setKpisPreviousYear(null);
      setProfile(null);
      setSleepSummary(null);
      setPredictions(null);
      setErr(errorMessage(error, "Chargement impossible."));
    } finally {
      setLoading(false);
    }
  };

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
  }, [accessAuthenticated, stravaConnected]);

  if (accessAuthenticated == null) {
    return (
      <div className="access-shell">
        <div className="access-card"><div className="access-brand">FabRun</div><p>Vérification de la session…</p></div>
      </div>
    );
  }

  if (!accessAuthenticated) {
    return (
      <div className="access-shell">
        <form className="access-card" onSubmit={submitAccess}>
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
          {!stravaConnected ? (
            <button className="btn" onClick={login}>
              Se connecter avec Strava
            </button>
          ) : (
            <>
              <span className="chip">Strava connecté</span>
              <button className="btn" onClick={loadAll} disabled={loading}>
                {loading ? "Chargement..." : "Recharger"}
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={disconnectAccess}>Fermer la session</button>
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
            <section className="panel">
              <div className="panel-head">Vue d'ensemble</div>
              <button className="btn" onClick={loadAll} disabled={loading}>
                {loading ? "Chargement..." : "Rafraîchir les données"}
              </button>
            </section>

            <section className="panel">
              {rows && <WeeklyKmChartCard rows={rows} />}
            </section>

            <section className="panel">
              {rows && (
                <TrainingLoadCard
                  rows={rows}
                  hasShinPain={hasShinPain}
                  onShinPainChange={updateShinPain}
                />
              )}
            </section>

            <section className="panel">
              {rows && <FormTrendCard rows={rows} sleep={sleepSummary} />}
            </section>

            <section className="panel">
              {rows && (
                <WeeklyEnergyCard
                  rows={rows}
                  athleteWeightKg={profile?.weight}
                />
              )}
            </section>

            <section className="panel">
              {rows && (
                <NextSessionCard
                  rows={rows}
                  predictions={predictions}
                  hasShinPain={hasShinPain}
                />
              )}
            </section>

            <section className="panel">
              {rows && (
                <WeeklyTrainingPlanCard
                  rows={rows}
                  predictions={predictions}
                  hasShinPain={hasShinPain}
                />
              )}
            </section>

            <section className="panel">
              {kpisAllTime && kpisCurrentYear && kpisPreviousYear && (
                <KpisCard
                  allTime={kpisAllTime}
                  currentYear={kpisCurrentYear}
                  previousYear={kpisPreviousYear}
                />
              )}
            </section>
            <section className="panel">
              {rows && (
                <ActivitiesTable
                  rows={rows}
                  athleteWeightKg={profile?.weight}
                />
              )}
            </section>
            {stravaConnected && (
              <PerformancePredictionsCard
                data={predictions}
                loading={predictionsLoading}
                onRefresh={async () => {
                  try {
                    setPredictionsLoading(true);
                    const p = await fetchRunningPredictions(true);
                    setPredictions(p ?? null);
                  } catch (error: unknown) {
                    setErr(errorMessage(error, "Actualisation impossible."));
                  } finally {
                    setPredictionsLoading(false);
                  }
                }}
              />
            )}
            <section className="panel">
              <ShoeUsageCard shoes={profile?.shoes ?? []} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
