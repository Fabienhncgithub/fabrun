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
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
};

const confidenceLabel = (level: string) => {
  if (level === "high") return "Confiance élevée";
  if (level === "medium") return "Confiance moyenne";
  return "Confiance faible";
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
        <p>Aucune estimation disponible.</p>
        <button className="btn" onClick={onRefresh} disabled={loading}>
          {loading ? "Calcul..." : "Recalculer"}
        </button>
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

      <button className="btn" onClick={onRefresh} disabled={loading}>
        {loading ? "Calcul..." : "Recalculer"}
      </button>
    </div>
  );
}
