import { useState } from "react";
import { fetchAutoPrediction } from "../api";

export default function AutoPredictionCard() {
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    try {
      setErr(null);
      setLoading(true);
      const j = await fetchAutoPrediction();
      setData(j);
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 16,
        padding: 16,
        border: "1px solid #eee",
        borderRadius: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <b>Prévision marathon (auto)</b>
        <button onClick={run} disabled={loading}>
          {loading ? "Analyse..." : "Analyser mes sorties"}
        </button>
      </div>
      {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}
      {data && (
        <div style={{ marginTop: 8 }}>
          <div style={{ opacity: 0.75, fontSize: 13 }}>
            Référence choisie: <b>{data.reference.kind}</b> —{" "}
            {data.reference.dist_km} km — {data.reference.time_hms}
          </div>
          <div style={{ marginTop: 6 }}>
            <div>
              <b>Temps Riegel (brut) :</b> {data.marathon.raw_hms}
            </div>
            <div>
              <b>Prévision ajustée :</b> {data.marathon.adjusted_hms} •{" "}
              <b>Allure :</b> {data.marathon.pace}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
