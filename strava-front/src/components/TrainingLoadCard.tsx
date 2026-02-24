import { computeTrainingLoad } from "../utils/trainingLoad";

type Activity = {
  id: number;
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function zoneFromAcr(acr: number | null): "green" | "orange" | "red" | "insufficient_data" {
  if (acr == null) return "insufficient_data";
  if (acr <= 1.3) return "green";
  if (acr <= 1.5) return "orange";
  return "red";
}

function zoneLabel(zone: ReturnType<typeof zoneFromAcr>) {
  if (zone === "green") return "Zone OK";
  if (zone === "orange") return "Attention";
  if (zone === "red") return "Risque élevé";
  return "Données insuffisantes";
}

function zoneMessage(zone: ReturnType<typeof zoneFromAcr>) {
  if (zone === "green") return "Progression raisonnable.";
  if (zone === "orange") return "Charge en hausse: reste prudent aujourd'hui.";
  if (zone === "red") return "Risque élevé: privilégie repos ou sortie très courte.";
  return "Pas assez de données récentes pour une estimation fiable.";
}


export default function TrainingLoadCard({ rows }: { rows: Activity[] }) {
  const metrics = computeTrainingLoad(rows);
  const label = zoneLabel(metrics.zone);
  const message = zoneMessage(metrics.zone);
  const deltaRaw = round3(metrics.maxKmNowRaw - metrics.maxKmNowYesterdayRaw);
  const deltaSign = deltaRaw > 0 ? "+" : "";

  return (
    <section className="training-load-card">
      <div className="training-load-head">
        <span className={`training-zone training-zone-${metrics.zone}`}>{label}</span>
        <span className="training-acr">ACR: {metrics.acr == null ? "—" : metrics.acr}</span>
        <span className={`training-confidence training-confidence-${metrics.confidenceClass}`}>
          Fiabilité: {metrics.confidence} ({metrics.confidenceScore}%)
        </span>
      </div>

      <div className="training-main">
        <div className="training-title">Km conseillés max pour le reste d'aujourd'hui</div>
        <div className="training-value">{metrics.remainingNow.toFixed(1)} km</div>
      </div>

      <p className="training-text">{message}</p>
      <p className="training-reco">Séance conseillée maintenant: {metrics.sessionAdvice}</p>
      <p className="training-meta">
        Estimation dynamique (pas une certitude médicale). Si douleur qui monte: stoppe la séance.
        {metrics.overrunToday > 0
          ? ` Tu as déjà dépassé de ${metrics.overrunToday.toFixed(1)} km, prudence renforcée demain.`
          : ""}
      </p>

      <details className="training-details">
        <summary>Voir le détail du calcul</summary>
        <p className="training-meta">
          28 derniers jours (runs): Acute 7j {metrics.acute7Km} km, Chronic 28j {metrics.chronic28AvgKm} km/sem.
        </p>
        <p className="training-meta">
          Déjà couru aujourd'hui: {metrics.kmToday.toFixed(1)} km. Hier: {metrics.kmYesterday.toFixed(1)} km.
          Plafond du jour: {metrics.maxKmNow.toFixed(1)} km.
        </p>
        <p className="training-meta">
          Ajustements: récup +{metrics.recoveryBoostPct.toFixed(1)}% ({metrics.restDaysBeforeToday} jour(s) repos),
          fatigue -{metrics.fatiguePenaltyPct.toFixed(1)}%, report -{metrics.carryoverPenaltyPct.toFixed(1)}%.
        </p>
        <p className="training-meta">
          Fiabilité: {metrics.confidence} ({metrics.confidenceScore}%) • jours actifs 28j: {metrics.activeDays28} •
          variabilité: {metrics.variability}.
        </p>
        <p className="training-meta">
          Brut ACR: aujourd'hui {metrics.maxKmNowRaw.toFixed(3)} km, ajusté {metrics.maxKmNowAdjustedRaw.toFixed(3)} km,
          final {metrics.maxKmNowFinalRaw.toFixed(3)} km. Dépassement hier: {metrics.yesterdayOverrunKm.toFixed(1)} km.
          Hier (brut): {metrics.maxKmNowYesterdayRaw.toFixed(3)} km (delta {deltaSign}
          {deltaRaw.toFixed(3)} km).
        </p>
      </details>
    </section>
  );
}
