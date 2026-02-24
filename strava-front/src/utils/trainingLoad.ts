export type TrainingLoadActivity = {
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

function standardDeviation(values: number[]) {
  if (values.length === 0) return 0;
  const mean = values.reduce((acc, v) => acc + v, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
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

  let restDaysBeforeToday = 0;
  for (let i = 26; i >= 0; i--) {
    if ((values[i] ?? 0) > 0) break;
    restDaysBeforeToday++;
  }
  const recoveryBoostRatio = Math.min(restDaysBeforeToday * 0.08, 0.24);

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

function zoneFromAcr(acr: number | null): "green" | "orange" | "red" | "insufficient_data" {
  if (acr == null) return "insufficient_data";
  if (acr <= 1.3) return "green";
  if (acr <= 1.5) return "orange";
  return "red";
}

export function computeTrainingLoad(rows: TrainingLoadActivity[]) {
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
  const activeDays28 = todayWindow.filter((km) => km > 0).length;
  const runCount28 = rows.filter((a) => RUN_TYPES.has(a.sport_type)).length;
  const dailyStd = standardDeviation(todayWindow);
  const dailyMean = todayWindow.reduce((acc, v) => acc + v, 0) / Math.max(todayWindow.length, 1);
  const variability = dailyMean > 0 ? dailyStd / dailyMean : 0;

  const yesterdayOverrun = Math.max(0, todayMetrics.kmYesterday - yesterdayMetrics.adjustedMaxKmNowRaw);
  const yesterdayOverrunRatio = yesterdayOverrun / Math.max(yesterdayMetrics.adjustedMaxKmNowRaw, 0.1);
  const carryoverPenaltyRatio = Math.min(yesterdayOverrunRatio * 0.35, 0.35);

  let finalAdjustedToday = todayMetrics.adjustedMaxKmNowRaw * (1 - carryoverPenaltyRatio);
  if (yesterdayOverrun > 0) {
    finalAdjustedToday = Math.min(finalAdjustedToday, yesterdayMetrics.adjustedMaxKmNowRaw * 0.9);
  }
  finalAdjustedToday = Math.max(0, finalAdjustedToday);

  let confidenceScore = 100;
  if (activeDays28 < 8) confidenceScore -= 35;
  else if (activeDays28 < 12) confidenceScore -= 20;
  if (runCount28 < 12) confidenceScore -= 20;
  if (variability > 1.25) confidenceScore -= 20;
  else if (variability > 0.9) confidenceScore -= 10;
  if (yesterdayOverrun > 0) confidenceScore -= 10;
  confidenceScore = Math.max(25, Math.min(100, confidenceScore));

  const confidence =
    confidenceScore >= 80 ? "haute" : confidenceScore >= 60 ? "moyenne" : "faible";
  const confidenceClass =
    confidence === "haute" ? "high" : confidence === "moyenne" ? "medium" : "low";

  const sessionAdvice =
    finalAdjustedToday <= 0.5
      ? "Repos ou 20-30 min très facile"
      : finalAdjustedToday <= 3
      ? "Footing facile court"
      : finalAdjustedToday <= 8
      ? "Footing facile à modéré"
      : "Séance possible, rester en aisance";

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
    confidenceScore: Math.round(confidenceScore),
    confidence,
    confidenceClass,
    activeDays28,
    variability: round2(variability),
    sessionAdvice,
  };
}
