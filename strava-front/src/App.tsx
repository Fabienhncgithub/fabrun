import { useEffect, useState } from "react";
import { getAccessToken, fetchActivities, fetchKpis } from "./api";
import ActivitiesTable from "./components/ActivitiesTable";
import KpisCard from "./components/KpisCard";
import MarathonPredictor from "./components/MarathonPredictor";
import AutoPredictionCard from "./components/AutoPredictionCard";
import "./App.css";

const API = import.meta.env.VITE_API_BASE as string;

export default function App() {
  const token = getAccessToken();
  const [rows, setRows] = useState<any[] | null>(null);
  const [kpis, setKpis] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const login = () => (location.href = `${API}/auth/login`);

  const loadAll = async () => {
    try {
      setLoading(true);
      setErr(null);
      const [a, k] = await Promise.all([fetchActivities(), fetchKpis()]);
      setRows(a);
      setKpis(k);
    } catch (e: any) {
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
              {kpis && <KpisCard k={kpis} />}
            </section>
            <section className="panel">
              {rows && <ActivitiesTable rows={rows} />}
            </section>
            <section className="panel two-cols">
              {kpis && <MarathonPredictor kpis={kpis} />}
              {token && <AutoPredictionCard />}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
