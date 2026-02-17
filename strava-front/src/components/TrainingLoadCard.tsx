type Activity = {
  id: number;
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const ACR_LIMIT = 1.3;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

function toDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.slice(0, 10);
  }

  const d = new Date(value);
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, offset: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + offset);
  return copy;
}

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

function computeFromWindow(values: number[]) {
  const sum28 = values.reduce((acc, v) => acc + v, 0);
  const acute7 = values.slice(-7).reduce((acc, v) => acc + v, 0);
  const chronic28Avg = sum28 / 4;
  const chronicDailyAvg = chronic28Avg / 7;
  const kmToday = values[27] ?? 0;
  const kmYesterday = values[26] ?? 0;
  const acute7BeforeToday = Math.max(0, acute7 - kmToday);
  const maxKmNowRaw = Math.max(0, ACR_LIMIT * chronic28Avg - acute7BeforeToday);

  // Recovery boost: consecutive rest days before today slightly increase the allowed cap.
  let restDaysBeforeToday = 0;
  for (let i = 26; i >= 0; i--) {
    if ((values[i] ?? 0) > 0) break;
    restDaysBeforeToday++;
  }
  const recoveryBoostRatio = Math.min(restDaysBeforeToday * 0.08, 0.24);

  // Fatigue penalty: heavy load in the last 2 days reduces today's cap.
  const kmLast2 = (values[25] ?? 0) + (values[26] ?? 0);
  const targetLast2 = Math.max(chronicDailyAvg * 2, 0.1);
  const overloadRatio = Math.max(0, (kmLast2 - targetLast2) / targetLast2);
  const fatiguePenaltyRatio = Math.min(overloadRatio * 0.25, 0.3);

  const adjustedMaxKmNowRaw = Math.max(0, maxKmNowRaw * (1 + recoveryBoostRatio) * (1 - fatiguePenaltyRatio));
  const acrRaw = chronic28Avg > 0 ? acute7 / chronic28Avg : null;

  return {
    acute7,
    chronic28Avg,
    kmToday,
    kmYesterday,
    restDaysBeforeToday,
    recoveryBoostRatio,
    fatiguePenaltyRatio,
    maxKmNowRaw,
    adjustedMaxKmNowRaw,
    acrRaw,
  };
}

function computeTrainingLoad(rows: Activity[]) {
  const today = new Date();
  const runKmByDay = new Map<string, number>();

  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    runKmByDay.set(key, (runKmByDay.get(key) ?? 0) + activity.distance / 1000);
  }

  const buildWindow = (endDate: Date) =>
    Array.from({ length: 28 }, (_, i) => localDateKey(addDays(endDate, -(27 - i)))).map(
      (k) => runKmByDay.get(k) ?? 0
    );

  const todayWindow = buildWindow(today);
  const yesterdayWindow = buildWindow(addDays(today, -1));
  const todayMetrics = computeFromWindow(todayWindow);
  const yesterdayMetrics = computeFromWindow(yesterdayWindow);

  // Carryover fatigue: if yesterday exceeded its own adjusted cap,
  // today's recommendation is reduced and cannot jump up.
  const yesterdayOverrun = Math.max(0, todayMetrics.kmYesterday - yesterdayMetrics.adjustedMaxKmNowRaw);
  const yesterdayOverrunRatio = yesterdayOverrun / Math.max(yesterdayMetrics.adjustedMaxKmNowRaw, 0.1);
  const carryoverPenaltyRatio = Math.min(yesterdayOverrunRatio * 0.35, 0.35);

  let finalAdjustedToday = todayMetrics.adjustedMaxKmNowRaw * (1 - carryoverPenaltyRatio);
  if (yesterdayOverrun > 0) {
    finalAdjustedToday = Math.min(finalAdjustedToday, yesterdayMetrics.adjustedMaxKmNowRaw * 0.9);
  }
  finalAdjustedToday = Math.max(0, finalAdjustedToday);

  return {
    acute7Km: round1(todayMetrics.acute7),
    chronic28AvgKm: round1(todayMetrics.chronic28Avg),
    kmToday: round1(todayMetrics.kmToday),
    kmYesterday: round1(todayMetrics.kmYesterday),
    restDaysBeforeToday: todayMetrics.restDaysBeforeToday,
    recoveryBoostPct: round1(todayMetrics.recoveryBoostRatio * 100),
    fatiguePenaltyPct: round1(todayMetrics.fatiguePenaltyRatio * 100),
    carryoverPenaltyPct: round1(carryoverPenaltyRatio * 100),
    yesterdayOverrunKm: round1(yesterdayOverrun),
    acr: todayMetrics.acrRaw == null ? null : round2(todayMetrics.acrRaw),
    zone: zoneFromAcr(todayMetrics.acrRaw),
    maxKmNow: round1(finalAdjustedToday),
    remainingNow: round1(Math.max(0, finalAdjustedToday - todayMetrics.kmToday)),
    overrunToday: round1(Math.max(0, todayMetrics.kmToday - finalAdjustedToday)),
    maxKmNowRaw: round3(todayMetrics.maxKmNowRaw),
    maxKmNowAdjustedRaw: round3(todayMetrics.adjustedMaxKmNowRaw),
    maxKmNowFinalRaw: round3(finalAdjustedToday),
    maxKmNowYesterdayRaw: round3(yesterdayMetrics.maxKmNowRaw),
  };
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
      </div>

      <div className="training-main">
        <div className="training-title">Km restants conseilles aujourd'hui</div>
        <div className="training-value">{metrics.remainingNow.toFixed(1)} km</div>
      </div>

      <p className="training-text">{message}</p>
      <p className="training-meta">
        Basé sur les 28 derniers jours (runs uniquement): Acute 7j {metrics.acute7Km} km, Chronic
        28j {metrics.chronic28AvgKm} km/sem.
      </p>
      <p className="training-meta">
        Déjà couru aujourd'hui: {metrics.kmToday.toFixed(1)} km. Hier: {metrics.kmYesterday.toFixed(1)} km.
      </p>
      <p className="training-meta">
        Plafond conseille du jour: {metrics.maxKmNow.toFixed(1)} km.
        {metrics.overrunToday > 0
          ? ` Tu as déjà dépassé de ${metrics.overrunToday.toFixed(1)} km (demain sera davantage pénalisé).`
          : ""}
      </p>
      <p className="training-meta">
        Ajustements: récup +{metrics.recoveryBoostPct.toFixed(1)}% ({metrics.restDaysBeforeToday} jour(s) de repos),
        fatigue -{metrics.fatiguePenaltyPct.toFixed(1)}%, report -{metrics.carryoverPenaltyPct.toFixed(1)}%.
      </p>
      <p className="training-meta">
        Brut ACR: aujourd'hui {metrics.maxKmNowRaw.toFixed(3)} km, ajusté {metrics.maxKmNowAdjustedRaw.toFixed(3)} km,
        final {metrics.maxKmNowFinalRaw.toFixed(3)} km. Dépassement hier: {metrics.yesterdayOverrunKm.toFixed(1)} km.
        Hier (brut): {metrics.maxKmNowYesterdayRaw.toFixed(3)} km (delta {deltaSign}
        {deltaRaw.toFixed(3)} km).
      </p>
    </section>
  );
}
