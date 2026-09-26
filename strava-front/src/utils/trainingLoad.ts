import { addDays, localDateKey, toDateKey } from "./dateBuckets";

export type TrainingLoadActivity = {
  sport_type: string;
  distance: number; // meters
  start_date_local: string;
  average_heartrate?: number | null;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const ACR_LIMIT = 1.3;

const round1 = (value: number) => Math.round(value * 10) / 10;
const round2 = (value: number) => Math.round(value * 100) / 100;
const round3 = (value: number) => Math.round(value * 1000) / 1000;

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

// Classic "10% rule": week-over-week mileage jumps beyond +10% are the
// folklore threshold most runners recognize for overuse injuries like
// periostitis. Kept as its own always-visible signal (unlike the ACR-based
// `zone` above) because it's the framing runners already know, and the
// margins it implies (how many km of room are left before crossing +10%,
// +20%) are easy to reason about without understanding acute:chronic load.
export function zoneFromWeeklyChangePct(pct: number | null): "green" | "orange" | "red" | "insufficient_data" {
  if (pct == null) return "insufficient_data";
  if (pct <= 10) return "green";
  if (pct <= 20) return "orange";
  return "red";
}

export function computeTrainingLoad(rows: TrainingLoadActivity[], referenceDate: Date = new Date()) {
  const today = referenceDate;
  const runKmByDay = new Map<string, number>();

  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    if (!key) continue;
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
  const windowStartKey = localDateKey(addDays(today, -27));
  const todayKey = localDateKey(today);
  const runCount28 = rows.filter((activity) => {
    if (!RUN_TYPES.has(activity.sport_type)) return false;
    const key = toDateKey(activity.start_date_local);
    return key != null && key >= windowStartKey && key <= todayKey;
  }).length;
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

  // Based on what's left to run today (cap minus what's already been run),
  // not the day's total cap - otherwise this contradicts remainingNow/zone
  // once a run has already happened today (e.g. "footing modéré" advice
  // while remainingNow is already ~0).
  const remainingTodayRaw = Math.max(0, finalAdjustedToday - todayMetrics.kmToday);
  const sessionAdvice =
    remainingTodayRaw <= 0.5
      ? "Repos ou 20-30 min très facile"
      : remainingTodayRaw <= 3
      ? "Footing facile court"
      : remainingTodayRaw <= 8
      ? "Footing facile à modéré"
      : "Séance possible, rester en aisance";

  const dayOfWeek = today.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const currentMonday = addDays(today, -daysSinceMonday);
  const previousMonday = addDays(currentMonday, -7);
  const previousSunday = addDays(currentMonday, -1);
  const sumRunsBetween = (start: Date, end: Date) => {
    const startKey = localDateKey(start);
    const endKey = localDateKey(end);
    let total = 0;
    for (const [key, km] of runKmByDay) {
      if (key >= startKey && key <= endKey) total += km;
    }
    return total;
  };

  const currentWeekKm = sumRunsBetween(currentMonday, today);
  const previousWeekKm = sumRunsBetween(previousMonday, previousSunday);

  const weeklyChangePct = previousWeekKm > 0 ? ((currentWeekKm - previousWeekKm) / previousWeekKm) * 100 : null;
  const weeklyRampCapKm = previousWeekKm > 0 ? previousWeekKm * 1.1 : null;
  const weeklyRampRemainingKm = weeklyRampCapKm == null ? null : Math.max(0, weeklyRampCapKm - currentWeekKm);

  // When the previous week was a full break, restart from a deliberately small
  // fraction of the recent chronic load instead of jumping back to the old volume.
  const restartWeekKm = Math.min(5, Math.max(2, todayMetrics.chronic28Avg * 0.25));
  const periostitisBaseWeekKm = previousWeekKm > 0 ? previousWeekKm : restartWeekKm;
  const periostitisWeeklyCapKm = periostitisBaseWeekKm * 1.1;
  const periostitisWeekRemainingKm = Math.max(0, periostitisWeeklyCapKm - currentWeekKm);
  const periostitisSessionCount = periostitisWeeklyCapKm < 6 ? 2 : 3;
  const periostitisSessionCapKm = Math.max(1, periostitisWeeklyCapKm / periostitisSessionCount);
  const ranYesterday = todayMetrics.kmYesterday > 0;
  const periostitisRemainingTodayRaw =
    ranYesterday && todayMetrics.kmToday === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            finalAdjustedToday - todayMetrics.kmToday,
            periostitisWeekRemainingKm,
            periostitisSessionCapKm - todayMetrics.kmToday
          )
        );

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
    weeklyRamp: {
      currentWeekKm: round1(currentWeekKm),
      previousWeekKm: round1(previousWeekKm),
      changePct: weeklyChangePct == null ? null : round1(weeklyChangePct),
      capKm: weeklyRampCapKm == null ? null : round1(weeklyRampCapKm),
      remainingKm: weeklyRampRemainingKm == null ? null : round1(weeklyRampRemainingKm),
      zone: zoneFromWeeklyChangePct(weeklyChangePct),
    },
    periostitis: {
      remainingTodayKm: round1(periostitisRemainingTodayRaw),
      currentWeekKm: round1(currentWeekKm),
      previousWeekKm: round1(previousWeekKm),
      weeklyCapKm: round1(periostitisWeeklyCapKm),
      weekRemainingKm: round1(periostitisWeekRemainingKm),
      sessionCount: periostitisSessionCount,
      sessionCapKm: round1(periostitisSessionCapKm),
      ranYesterday,
    },
  };
}

/**
 * Number of consecutive days (counting back from today, capped at `maxDays`)
 * where the ACR was in the red zone (> 1.5). Used to decide whether the
 * in-app alert banner should show: a single red day is normal noise, several
 * in a row is the actual signal worth surfacing.
 */
export function computeRedZoneStreak(rows: TrainingLoadActivity[], maxDays = 14): number {
  const runKmByDay = new Map<string, number>();
  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    if (!key) continue;
    runKmByDay.set(key, (runKmByDay.get(key) ?? 0) + activity.distance / 1000);
  }

  const acrForDay = (day: Date): number | null => {
    const window = Array.from({ length: 28 }, (_, i) => localDateKey(addDays(day, -(27 - i)))).map(
      (k) => runKmByDay.get(k) ?? 0
    );
    const sum28 = window.reduce((acc, v) => acc + v, 0);
    const acute7 = window.slice(-7).reduce((acc, v) => acc + v, 0);
    const chronic28Avg = sum28 / 4;
    return chronic28Avg > 0 ? acute7 / chronic28Avg : null;
  };

  const today = new Date();
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const acr = acrForDay(addDays(today, -i));
    if (acr == null || acr <= 1.5) break;
    streak++;
  }
  return streak;
}

function buildRunKmByDay(rows: TrainingLoadActivity[]): Map<string, number> {
  const runKmByDay = new Map<string, number>();
  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    if (!key) continue;
    runKmByDay.set(key, (runKmByDay.get(key) ?? 0) + activity.distance / 1000);
  }
  return runKmByDay;
}

function mondayOf(date: Date): Date {
  const dow = date.getDay();
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  return addDays(date, -daysSinceMonday);
}

/**
 * Same +10% week-over-week rule as `weeklyRamp` above, but replayed for each
 * of the last `maxDays` days instead of just today. Used to decide whether
 * the in-app alert banner should show: a single day over the cap (e.g. one
 * big long run early in the week) is normal, staying over it for several
 * days running is the actual signal worth surfacing.
 */
export function computeWeeklyRampRedStreak(rows: TrainingLoadActivity[], maxDays = 14): number {
  const runKmByDay = buildRunKmByDay(rows);

  const sumBetween = (start: Date, end: Date) => {
    const startKey = localDateKey(start);
    const endKey = localDateKey(end);
    let total = 0;
    for (const [key, km] of runKmByDay) {
      if (key >= startKey && key <= endKey) total += km;
    }
    return total;
  };

  const zoneForDay = (day: Date) => {
    const monday = mondayOf(day);
    const previousMonday = addDays(monday, -7);
    const previousSunday = addDays(monday, -1);
    const weekToDateKm = sumBetween(monday, day);
    const previousWeekKm = sumBetween(previousMonday, previousSunday);
    const pct = previousWeekKm > 0 ? ((weekToDateKm - previousWeekKm) / previousWeekKm) * 100 : null;
    return zoneFromWeeklyChangePct(pct);
  };

  const today = new Date();
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    if (zoneForDay(addDays(today, -i)) !== "red") break;
    streak++;
  }
  return streak;
}

export type WeeklyRampHistoryWeek = {
  weekStartKey: string;
  weekKm: number;
  previousWeekKm: number;
  changePct: number | null;
  zone: "green" | "orange" | "red" | "insufficient_data";
};

export type NextAvailableRun = {
  daysAhead: number;
  dateKey: string;
  maxKm: number;
  rehabMaxKm: number;
};

/**
 * When today's budget is (near) zero, projects forward assuming pure rest
 * (no runs added meanwhile) to find the first day the ACR-based cap - and,
 * in parallel, the periostitis-rehab cap - opens back up. Reuses
 * computeTrainingLoad's own math via `referenceDate` instead of
 * duplicating it, so "when can I run again" always matches "how much can I
 * run today" exactly. Returns null if still capped after `maxDaysAhead`.
 */
export function computeNextAvailableRun(
  rows: TrainingLoadActivity[],
  maxDaysAhead = 10
): NextAvailableRun | null {
  const today = new Date();
  for (let i = 1; i <= maxDaysAhead; i++) {
    const day = addDays(today, i);
    const metrics = computeTrainingLoad(rows, day);
    if (metrics.remainingNow >= 1 || metrics.periostitis.remainingTodayKm >= 1) {
      return {
        daysAhead: i,
        dateKey: localDateKey(day),
        maxKm: metrics.remainingNow,
        rehabMaxKm: metrics.periostitis.remainingTodayKm,
      };
    }
  }
  return null;
}

/**
 * Full week-over-week +10% history for the last `weeksBack` completed weeks
 * plus the current (in-progress) one, oldest first, so the UI can show more
 * than just today's snapshot - e.g. which past weeks actually crossed into
 * risky territory.
 */
export function computeWeeklyRampHistory(
  rows: TrainingLoadActivity[],
  weeksBack = 10
): WeeklyRampHistoryWeek[] {
  const runKmByDay = buildRunKmByDay(rows);

  const sumBetween = (start: Date, end: Date) => {
    const startKey = localDateKey(start);
    const endKey = localDateKey(end);
    let total = 0;
    for (const [key, km] of runKmByDay) {
      if (key >= startKey && key <= endKey) total += km;
    }
    return total;
  };

  const currentMonday = mondayOf(new Date());
  const history: WeeklyRampHistoryWeek[] = [];

  for (let i = weeksBack; i >= 0; i--) {
    const weekMonday = addDays(currentMonday, -7 * i);
    const weekSunday = addDays(weekMonday, 6);
    const previousMonday = addDays(weekMonday, -7);
    const previousSunday = addDays(weekMonday, -1);

    const weekKm = sumBetween(weekMonday, weekSunday);
    const previousWeekKm = sumBetween(previousMonday, previousSunday);
    const changePct = previousWeekKm > 0 ? ((weekKm - previousWeekKm) / previousWeekKm) * 100 : null;

    history.push({
      weekStartKey: localDateKey(weekMonday),
      weekKm: round1(weekKm),
      previousWeekKm: round1(previousWeekKm),
      changePct: changePct == null ? null : round1(changePct),
      zone: zoneFromWeeklyChangePct(changePct),
    });
  }

  return history;
}

export type WeekDayBreakdown = {
  dateKey: string;
  km: number;
  runs: number;
};

export function computeWeekDailyBreakdown(rows: TrainingLoadActivity[], weekStartKey: string): WeekDayBreakdown[] {
  const [y, m, d] = weekStartKey.split("-").map(Number);
  const monday = new Date(y, m - 1, d);
  const kmByDay = new Map<string, number>();
  const runsByDay = new Map<string, number>();
  for (const activity of rows) {
    if (!RUN_TYPES.has(activity.sport_type)) continue;
    const key = toDateKey(activity.start_date_local);
    if (!key) continue;
    kmByDay.set(key, (kmByDay.get(key) ?? 0) + activity.distance / 1000);
    runsByDay.set(key, (runsByDay.get(key) ?? 0) + 1);
  }
  return Array.from({ length: 7 }, (_, i) => {
    const dateKey = localDateKey(addDays(monday, i));
    return { dateKey, km: round1(kmByDay.get(dateKey) ?? 0), runs: runsByDay.get(dateKey) ?? 0 };
  });
}
