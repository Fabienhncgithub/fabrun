import { useEffect, useState } from "react";
import { getAccessToken, fetchActivities, fetchKpis, fetchProfile } from "./api";
import ActivitiesTable from "./components/ActivitiesTable";
import KpisCard from "./components/KpisCard";
import MarathonPredictor from "./components/MarathonPredictor";
import AutoPredictionCard from "./components/AutoPredictionCard";
import TrainingLoadCard from "./components/TrainingLoadCard";
import ShoeUsageCard from "./components/ShoeUsageCard";
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

export default function App() {
  const token = getAccessToken();
  const [rows, setRows] = useState<any[] | null>(null);
  const [kpis, setKpis] = useState<any | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const login = () => (location.href = `${API}/auth/login`);

  const loadAll = async () => {
    try {
      setLoading(true);
      setErr(null);
      const profilePromise = fetchProfile().catch(() => null);
      const [a, k, p] = await Promise.all([fetchActivities(), fetchKpis(), profilePromise]);
      setRows(a);
      setKpis(k);
      setProfile(p);
    } catch (e: any) {
      setRows(null);
      setKpis(null);
      setProfile(null);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadAll();
    }
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
              {rows && <TrainingLoadCard rows={rows} />}
            </section>

            <section className="panel">
              {kpis && <KpisCard k={kpis} />}
            </section>
            <section className="panel">
              {rows && <ActivitiesTable rows={rows} athleteWeightKg={profile?.weight} />}
            </section>
            <section className="panel two-cols">
              {kpis && <MarathonPredictor kpis={kpis} />}
              {token && <AutoPredictionCard />}
            </section>

            <section className="panel">
              <ShoeUsageCard shoes={profile?.shoes ?? []} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
