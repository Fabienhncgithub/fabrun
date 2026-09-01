import EmptyState from "./EmptyState";
import { parseStravaLocalDate } from "../utils/dateBuckets";

type PredictionReference = {
  distanceKm: number;
  timeSec: number;
  dateLocal: string;
  activityId: number;
  activityName: string;
  method: "streams" | "splits" | "activity" | string;
};

type PredictionConfidence = {
  score: number;
  level: "high" | "medium" | "low" | string;
  reasons: string[];
};

type PredictionResponse = {
  reference: PredictionReference;
  exponentUsed: number;
  predictions: Record<string, number>;
  confidence: PredictionConfidence;
  bestEfforts?: BestEffort[];
};

type BestEffort = {
  distanceKm: number;
  timeSec: number;
  activityId: number;
  activityName: string;
  dateLocal: string;
  method: string;
};

const fmtTime = (sec: number) => {
  if (!sec || sec <= 0) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
};

const fmtDate = (value: string) => {
  if (!value) return "-";
  const date = parseStravaLocalDate(value);
  return date ? date.toLocaleDateString() : "-";
};

const confidenceLabel = (level: string) => {
  if (level === "high") return "Confiance élevée";
  if (level === "medium") return "Confiance moyenne";
  return "Confiance faible";
};

const distanceLabel = (distanceKm: number) => {
  if (Math.abs(distanceKm - 21.097) < 0.02) return "Semi";
  if (Math.abs(distanceKm - 42.195) < 0.02) return "Marathon";
  return `${distanceKm.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km`;
};

const paceLabel = (seconds: number, distanceKm: number) => {
  if (seconds <= 0 || distanceKm <= 0) return "—";
  const secondsPerKm = Math.round(seconds / distanceKm);
  const minutes = Math.floor(secondsPerKm / 60);
  const remainingSeconds = secondsPerKm % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}/km`;
};

const methodLabel = (method: string) => {
  if (method === "streams") return "GPS précis";
  if (method === "splits") return "Splits km";
  return "Activité complète";
};

export default function PerformancePredictionsCard({
  data,
  onRefresh,
  loading,
}: {
  data: PredictionResponse | null;
  onRefresh: () => void;
  loading: boolean;
}) {
  if (!data || !data.predictions || Object.keys(data.predictions).length === 0) {
    return (
      <div className="panel">
        <div className="panel-head">Estimations actuelles</div>
        <EmptyState
          icon="📈"
          title="Aucune estimation"
          message="Pas encore assez d'activités pour calculer une estimation fiable."
          action={
            <button className="btn" onClick={onRefresh} disabled={loading}>
              {loading ? "Calcul..." : "Recalculer"}
            </button>
          }
        />
      </div>
    );
  }

  const ref = data.reference;
  const confidence = data.confidence;
  const badgeClass =
    confidence.level === "high"
      ? "badge-green"
      : confidence.level === "medium"
      ? "badge-orange"
      : "badge-red";

  return (
    <div className="panel">
      <div className="panel-head">Estimations actuelles</div>
      <div className="predictions-grid">
        <div className="prediction-tile">
          <div className="prediction-label">5K</div>
          <div className="prediction-value">{fmtTime(data.predictions["5k"])}</div>
        </div>
        <div className="prediction-tile">
          <div className="prediction-label">10K</div>
          <div className="prediction-value">{fmtTime(data.predictions["10k"])}</div>
        </div>
        <div className="prediction-tile">
          <div className="prediction-label">Semi</div>
          <div className="prediction-value">{fmtTime(data.predictions["half"])}</div>
        </div>
        <div className="prediction-tile">
          <div className="prediction-label">Marathon</div>
          <div className="prediction-value">{fmtTime(data.predictions["marathon"])}</div>
        </div>
      </div>

      <div className="prediction-meta">
        <span className={`prediction-badge ${badgeClass}`}>{confidenceLabel(confidence.level)}</span>
        <span className="prediction-score">Score: {confidence.score}/100</span>
      </div>

      <p className="prediction-reference">
        Basé sur: {ref.distanceKm.toFixed(1)}K {fmtTime(ref.timeSec)} du {fmtDate(ref.dateLocal)} ({ref.method})
        {ref.activityName ? ` • ${ref.activityName}` : ""}
      </p>

      {confidence.reasons?.length ? (
        <ul className="prediction-reasons">
          {confidence.reasons.map((r, idx) => (
            <li key={`${r}-${idx}`}>{r}</li>
          ))}
        </ul>
      ) : null}

      <p className="prediction-hint">
        Les estimations sont plus fiables si ton effort source est récent et proche d’une course.
      </p>

      {data.bestEfforts && data.bestEfforts.length > 0 && (
        <div className="best-efforts-section">
          <h3>Meilleurs efforts détectés</h3>
          <div className="best-efforts-grid">
            {data.bestEfforts.map((effort) => (
              <a
                className="best-effort-item"
                href={`https://www.strava.com/activities/${effort.activityId}`}
                target="_blank"
                rel="noopener noreferrer"
                key={`${effort.distanceKm}-${effort.activityId}`}
              >
                <span className="best-effort-distance">{distanceLabel(effort.distanceKm)}</span>
                <strong>{fmtTime(effort.timeSec)}</strong>
                <span>{paceLabel(effort.timeSec, effort.distanceKm)}</span>
                <small>{fmtDate(effort.dateLocal)} • {methodLabel(effort.method)}</small>
              </a>
            ))}
          </div>
        </div>
      )}

      <button className="btn" onClick={onRefresh} disabled={loading}>
        {loading ? "Calcul..." : "Recalculer"}
      </button>
    </div>
  );
}
