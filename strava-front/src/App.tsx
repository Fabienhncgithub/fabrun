import { useEffect, useRef, useState } from "react";
import { getAccessToken, fetchDashboard, fetchRunningPredictions } from "./api";
import ActivitiesTable from "./components/ActivitiesTable";
import KpisCard from "./components/KpisCard";
import TrainingLoadCard from "./components/TrainingLoadCard";
import ShoeUsageCard from "./components/ShoeUsageCard";
import PerformancePredictionsCard from "./components/PerformancePredictionsCard";
import WeeklyKmChartCard from "./components/WeeklyKmChartCard";
import "./App.css";

const API = import.meta.env.VITE_API_BASE as string;

type ProfileShoe = {
  id?: string | null;
  name?: string | null;
  distance?: number | null;
  converted_distance?: number | null;
};

type Profile = {
  weight?: number;
  shoes?: ProfileShoe[];
};

type SleepSummary = {
  connected: boolean;
  lastSleepHours: number;
  avg7dHours: number;
  avg30dHours: number;
  sessions7d: number;
  sessions30d: number;
  totalSessions: number;
  lastSleepEndUtc?: string | null;
};

export default function App() {
  const token = getAccessToken();
  const initialLoadDoneRef = useRef(false);
  const [rows, setRows] = useState<any[] | null>(null);
  const [kpisAllTime, setKpisAllTime] = useState<any | null>(null);
  const [kpisCurrentYear, setKpisCurrentYear] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sleepSummary, setSleepSummary] = useState<SleepSummary | null>(null);
  const [predictions, setPredictions] = useState<any | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const login = () => {
    const front = encodeURIComponent(window.location.origin);
    location.href = `${API}/auth/login?front=${front}`;
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      setErr(null);
      const data = await fetchDashboard();
      setRows(data.activities ?? null);
      setKpisAllTime(data.kpis ?? null);
      setKpisCurrentYear(data.kpisCurrentYear ?? data.kpis ?? null);
      setProfile(data.profile ?? null);
      setSleepSummary(data.sleep ?? null);
      try {
        setPredictionsLoading(true);
        const p = await fetchRunningPredictions();
        setPredictions(p ?? null);
      } catch (e: any) {
        setPredictions(null);
      } finally {
        setPredictionsLoading(false);
      }
    } catch (e: any) {
      setRows(null);
      setKpisAllTime(null);
      setKpisCurrentYear(null);
      setProfile(null);
      setSleepSummary(null);
      setPredictions(null);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token || initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;
    loadAll();
  }, [token]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-title">FabRun</div>
          <div className="brand-sub">Dashboard d'entraînement</div>
        </div>
        <div className="topbar-actions">
          {!token ? (
            <button className="btn" onClick={login}>
              Se connecter avec Strava
            </button>
          ) : (
            <>
              <span className="chip">Token présent</span>
              <button className="btn" onClick={loadAll} disabled={loading}>
                {loading ? "Chargement..." : "Recharger"}
              </button>
            </>
          )}
        </div>
      </header>

      <main className="main">
        {!token ? (
          <section className="panel">
            <p>Connecte Strava pour charger tes activités.</p>
            <button className="btn" onClick={login}>
              Se connecter avec Strava
            </button>
          </section>
        ) : (
          <>
            {err && (
              <div className="alert">
                <div>Erreur: {err}</div>
              </div>
            )}

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
              {rows && <TrainingLoadCard rows={rows} />}
            </section>

            <section className="panel">
              {kpisAllTime && kpisCurrentYear && (
                <KpisCard
                  allTime={kpisAllTime}
                  currentYear={kpisCurrentYear}
                  sleep={sleepSummary}
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
            {token && (
              <PerformancePredictionsCard
                data={predictions}
                loading={predictionsLoading}
                onRefresh={async () => {
                  try {
                    setPredictionsLoading(true);
                    const p = await fetchRunningPredictions(true);
                    setPredictions(p ?? null);
                  } catch (e: any) {
                    setErr(e.message || String(e));
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
