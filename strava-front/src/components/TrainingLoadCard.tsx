import { computeTrainingLoad } from "../utils/trainingLoad";

type Activity = {
  id: number;
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

type TrainingZone = "green" | "orange" | "red" | "insufficient_data";

function zoneLabel(zone: TrainingZone) {
  if (zone === "green") return "Zone OK";
  if (zone === "orange") return "Attention";
  if (zone === "red") return "Risque élevé";
  return "Données insuffisantes";
}

function zoneMessage(zone: TrainingZone) {
  if (zone === "green") return "Progression raisonnable.";
  if (zone === "orange") return "Charge en hausse: reste prudent aujourd'hui.";
  if (zone === "red") return "Risque élevé: privilégie repos ou sortie très courte.";
  return "Pas assez de données récentes pour une estimation fiable.";
}


export default function TrainingLoadCard({
  rows,
  hasShinPain,
  onShinPainChange,
  settingsSaving = false,
}: {
  rows: Activity[];
  hasShinPain: boolean;
  onShinPainChange: (value: boolean) => void;
  settingsSaving?: boolean;
}) {
  const metrics = computeTrainingLoad(rows);
  const periostitis = metrics.periostitis;
  const label = zoneLabel(metrics.zone);
  const message = zoneMessage(metrics.zone);
  const deltaRaw = round3(metrics.maxKmNowRaw - metrics.maxKmNowYesterdayRaw);
  const deltaSign = deltaRaw > 0 ? "+" : "";

  return (
    <section className="training-load-card">
      <label className="training-pain-toggle">
        <span>Douleur périostite</span>
        <input
          type="checkbox"
          role="switch"
          checked={hasShinPain}
          disabled={settingsSaving}
          onChange={(event) => onShinPainChange(event.target.checked)}
        />
        <span className="training-switch" aria-hidden="true" />
        <strong>{hasShinPain ? "Oui" : "Non"}</strong>
      </label>
      <p className={`training-mode-explainer ${hasShinPain ? "training-mode-explainer-active" : ""}`}>
        {hasShinPain
          ? "Mode actif : le conseil du jour et le plan hebdomadaire passent immédiatement en reprise prudente."
          : "Active ce bouton si une douleur de périostite est présente : FabRun retirera vitesse, côtes et jours consécutifs."}
      </p>

      <div className="training-load-head">
        {hasShinPain && <span className="training-injury-mode">Reprise périostite</span>}
        <span className={`training-zone training-zone-${metrics.zone}`}>{label}</span>
        <span className="training-acr">ACR: {metrics.acr == null ? "—" : metrics.acr}</span>
        <span className={`training-confidence training-confidence-${metrics.confidenceClass}`}>
          Fiabilité: {metrics.confidence} ({metrics.confidenceScore}%)
        </span>
      </div>

      <div className="training-main">
        <div className="training-title">Km conseillés max pour le reste d'aujourd'hui</div>
        <div className="training-value">
          {(hasShinPain ? periostitis.remainingTodayKm : metrics.remainingNow).toFixed(1)} km
        </div>
      </div>

      <p className="training-text">
        {hasShinPain && periostitis.ranYesterday
          ? "Repos course aujourd'hui: au moins un jour sans impact entre deux sorties."
          : message}
      </p>
      <p className="training-reco">
        Séance conseillée maintenant:{" "}
        {hasShinPain
          ? periostitis.remainingTodayKm <= 0
            ? "repos, marche indolore ou cardio sans impact"
            : "course-marche très facile, terrain plat, sans vitesse ni côtes"
          : metrics.sessionAdvice}
        .
      </p>

      {hasShinPain && <><div className="training-rehab-summary">
        <div>
          <span>Cette semaine</span>
          <strong>{periostitis.currentWeekKm.toFixed(1)} km</strong>
        </div>
        <div>
          <span>Plafond semaine</span>
          <strong>{periostitis.weeklyCapKm.toFixed(1)} km</strong>
        </div>
        <div>
          <span>Reste semaine</span>
          <strong>{periostitis.weekRemainingKm.toFixed(1)} km</strong>
        </div>
      </div>

      <div className="training-rehab-progress" aria-label="Utilisation du plafond de reprise">
        <span style={{ width: `${periostitis.weeklyCapKm > 0 ? Math.min(100, periostitis.currentWeekKm / periostitis.weeklyCapKm * 100) : 0}%` }} />
      </div>
      <div className="training-rehab-progress-labels">
        <span>Couru {periostitis.currentWeekKm.toFixed(1)} km</span>
        <span>Limite {periostitis.weeklyCapKm.toFixed(1)} km</span>
      </div>

      <a className="training-plan-link" href="#plan-semaine">
        Voir comment le reste de la semaine et S+1 sont recalculés →
      </a>
      </>}

      <p className="training-meta">
        {hasShinPain
          ? "Ne commence la reprise que si tu peux marcher 30 min sans douleur. Le plafond de +10 % n'est jamais un objectif obligatoire. Si la douleur augmente, devient vive ou persiste plus de 24–48 h: arrêt et retour à l'étape précédente."
          : "Estimation dynamique (pas une certitude médicale). Si une douleur apparaît ou augmente: stoppe la séance et active le mode périostite."}
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
          Plafond ACR du jour: {metrics.maxKmNow.toFixed(1)} km.
          {hasShinPain && ` Plafond reprise périostite restant: ${periostitis.remainingTodayKm.toFixed(1)} km. Semaine précédente: ${periostitis.previousWeekKm.toFixed(1)} km.`}
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
