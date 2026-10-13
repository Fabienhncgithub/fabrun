import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextAvailableRun,
  computeTrainingLoad,
  computeWeeklyRampHistory,
  computeWeeklyRampRedStreak,
  projectRehabRuns,
  zoneFromWeeklyChangePct,
  type TrainingLoadActivity,
} from "./trainingLoad";
import { addDays, localDateKey } from "./dateBuckets";

function activityOn(dateKey: string, km: number): TrainingLoadActivity {
  return {
    sport_type: "Run",
    distance: km * 1000,
    start_date_local: `${dateKey}T08:00:00Z`,
  };
}

function recentLoad(referenceDate: Date, recentRuns: [number, number][]) {
  const rows = Array.from({ length: 10 }, (_, i) =>
    activityOn(localDateKey(addDays(referenceDate, -(27 - i * 2))), 4.08)
  );
  for (const [daysAgo, km] of recentRuns) {
    rows.push(activityOn(localDateKey(addDays(referenceDate, -daysAgo)), km));
  }
  return rows;
}

function dailyBase(referenceDate: Date) {
  return Array.from({ length: 28 }, (_, i) =>
    activityOn(localDateKey(addDays(referenceDate, -(i + 1))), 3)
  );
}

describe("shin pain daily advice", () => {
  it("requires rest after yesterday's run even when another run was imported today", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = [...dailyBase(today), activityOn("2026-10-12", 1)];
    const metrics = computeTrainingLoad(rows, today);

    expect(metrics.acrRemainingTodayKm).toBeGreaterThan(0.5);
    expect(metrics.periostitis.ranYesterday).toBe(true);
    expect(metrics.periostitis.remainingTodayKm).toBe(0);
  });

  it("uses weekly progression for normal mode and keeps the ACR restriction for pain mode", () => {
    const monday = new Date(2026, 9, 12, 12);
    const rows = recentLoad(monday, [[7, 1.8], [2, 11], [1, 8.1], [0, 6.1]]);
    const thursday = addDays(monday, 3);
    const metrics = computeTrainingLoad(rows, thursday);
    expect(metrics.normalWeekTargetKm).toBe(23);
    expect(metrics.remainingNow).toBeGreaterThan(6);
    expect(metrics.acrRemainingTodayKm).toBe(0);
    expect(metrics.periostitis.remainingTodayKm).toBe(0);
    expect(metrics.periostitis.weeklyCapKm).toBe(10.4);
  });

  it("does not propose a second run after today's activity is imported", () => {
    const monday = new Date(2026, 9, 12, 12);
    const rows = recentLoad(monday, [[7, 1.8], [6, 5], [4, 6], [0, 1]]);
    const metrics = computeTrainingLoad(rows, monday);
    expect(metrics.periostitis.ranYesterday).toBe(false);
    expect(metrics.remainingNow).toBe(0);
    expect(metrics.periostitis.remainingTodayKm).toBe(0);
  });

  it("does not suggest running once the daily budget has been consumed", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = [...dailyBase(today), activityOn("2026-10-12", 30)];

    expect(computeTrainingLoad(rows, today).sessionAdvice).toBe("Repos, marche ou cardio sans impact");
  });
});

describe("zoneFromWeeklyChangePct", () => {
  it("treats a null (no reference week) change as insufficient data", () => {
    expect(zoneFromWeeklyChangePct(null)).toBe("insufficient_data");
  });

  it("is green at or below +10%, orange between +10% and +20%, red above", () => {
    expect(zoneFromWeeklyChangePct(-30)).toBe("green");
    expect(zoneFromWeeklyChangePct(10)).toBe("green");
    expect(zoneFromWeeklyChangePct(15)).toBe("orange");
    expect(zoneFromWeeklyChangePct(20)).toBe("orange");
    expect(zoneFromWeeklyChangePct(21)).toBe("red");
  });
});

describe("computeWeeklyRampRedStreak", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts consecutive red days back from today, stopping at the first non-red day", () => {
    // "Today" is Wednesday 2024-01-10. Previous week (Mon 01-01..Sun 01-07)
    // totals 10km; this week opens with a single 15km run on Monday 01-08,
    // a +50% jump that stays red every day until the lookback runs into
    // 01-07 - the last day of the previous week, which has no reference
    // week of its own (nothing before 2023-12-25) and so is insufficient
    // data rather than red.
    vi.setSystemTime(new Date(2024, 0, 10, 12, 0, 0));

    const rows: TrainingLoadActivity[] = [
      activityOn("2024-01-01", 2.5),
      activityOn("2024-01-02", 2.5),
      activityOn("2024-01-03", 2.5),
      activityOn("2024-01-04", 2.5),
      activityOn("2024-01-08", 15),
    ];

    expect(computeWeeklyRampRedStreak(rows, 14)).toBe(3);
  });

  it("returns 0 when there is no reference (previous) week at all", () => {
    vi.setSystemTime(new Date(2024, 0, 10, 12, 0, 0));

    const rows: TrainingLoadActivity[] = [activityOn("2024-01-08", 15)];

    expect(computeWeeklyRampRedStreak(rows, 14)).toBe(0);
  });
});

describe("computeNextAvailableRun", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never finds an opening when there is no running history at all", () => {
    vi.setSystemTime(new Date(2024, 0, 10, 12, 0, 0));

    expect(computeNextAvailableRun([], 10)).toBeNull();
  });

  it("finds a future day the budget reopens after a blowout on top of a steady base", () => {
    vi.setSystemTime(new Date(2024, 0, 29, 12, 0, 0));

    const rows: TrainingLoadActivity[] = [];
    // Steady 3km/day base for the 28 days before today, then a 30km blowout
    // run today - a large ACR spike that should keep the budget at 0 for a
    // few days before rolling off the trailing 7-day window.
    for (let i = 28; i >= 1; i--) {
      const key = new Date(2024, 0, 29 - i).toISOString().slice(0, 10);
      rows.push(activityOn(key, 3));
    }
    rows.push(activityOn("2024-01-29", 30));

    const result = computeNextAvailableRun(rows, 10);

    expect(result).not.toBeNull();
    expect(result!.daysAhead).toBeGreaterThan(0);
    expect(result!.daysAhead).toBeLessThanOrEqual(10);
    expect(result!.maxKm).toBeGreaterThanOrEqual(1);
  });

  it("uses the selected mode rather than announcing an opening with a zero rehab budget", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = [...dailyBase(today), activityOn("2026-10-12", 1)];

    const normal = computeNextAvailableRun(rows, 10, false, today);
    const rehab = computeNextAvailableRun(rows, 10, true, today);

    expect(normal?.daysAhead).toBe(1);
    expect(normal?.rehabMaxKm).toBe(0);
    expect(rehab?.daysAhead).toBe(2);
    expect(rehab!.rehabMaxKm).toBeGreaterThanOrEqual(0.5);
  });

  it("recognizes a half-kilometre opening using the same cutoff as today's advice", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = recentLoad(today, [[7, 1.8], [6, 5], [4, 6], [1, 8.1], [0, 6.1]]);

    expect(computeNextAvailableRun(rows, 10, true, today)).toMatchObject({
      daysAhead: 2,
      rehabMaxKm: 0.5,
    });
  });
});

describe("projectRehabRuns", () => {
  it("does not plan before the full-rest opening despite unused weekly mileage", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = recentLoad(today, [[7, 1.8], [2, 11], [1, 8.1], [0, 6.1]]);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(today, i));
    const opening = computeNextAvailableRun(rows, 10, true, today);
    const projected = projectRehabRuns(rows, dates, 23, 2, today);

    expect(computeTrainingLoad(rows, today).weeklyRamp.remainingKm).toBeGreaterThan(16);
    expect(computeTrainingLoad(rows, today).periostitis.weekRemainingKm).toBe(4.3);
    expect(opening?.daysAhead).toBe(5);
    expect(projected).toEqual([{ dateKey: "2026-10-17", km: 3.4 }]);
    expect(projected[0].dateKey).toBe(opening?.dateKey);
  });

  it("includes the first planned run when limiting a later session", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = recentLoad(today, [[7, 1.8], [6, 5], [4, 6], [1, 8.1], [0, 6.1]]);
    const wednesday = addDays(today, 2);
    const friday = addDays(today, 4);
    const projected = projectRehabRuns(rows, [friday, wednesday], 8.1, 2, today);
    const fridayAfterRest = projectRehabRuns(rows, [friday], 8.1, 1, today);

    expect(projected).toEqual([
      { dateKey: "2026-10-14", km: 0.5 },
      { dateKey: "2026-10-16", km: 1.5 },
    ]);
    expect(fridayAfterRest[0].km).toBe(2);
    expect(projected[1].km).toBeLessThan(fridayAfterRest[0].km);
  });

  it("counts the previous Sunday's run when keeping Monday free of impact", () => {
    const today = new Date(2026, 9, 12, 12);
    const projected = projectRehabRuns(dailyBase(today), [today, addDays(today, 1)], 23.1, 1, today);

    expect(projected).toHaveLength(1);
    expect(projected[0].dateKey).toBe("2026-10-13");
  });

  it("respects the supplied weekly target and does not fill unused mileage later", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = recentLoad(today, [[7, 1.8], [6, 5], [4, 6], [1, 8.1], [0, 6.1]]);
    const dates = [addDays(today, 2), addDays(today, 4), addDays(today, 6)];

    expect(projectRehabRuns(rows, dates, 6.6, 3, today)).toEqual([
      { dateKey: "2026-10-14", km: 0.5 },
    ]);
  });

  it("floors the remaining target using imported precision rather than displayed kilometres", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = [...dailyBase(today), activityOn("2026-10-12", 1.049)];

    expect(projectRehabRuns(rows, [addDays(today, 2)], 1.6, 1, today)).toEqual([
      { dateKey: "2026-10-14", km: 0.5 },
    ]);
  });

  it("ignores duplicate, past, already-run and next-week candidate dates", () => {
    const today = new Date(2026, 9, 12, 12);
    const rows = [...dailyBase(today), activityOn("2026-10-12", 1)];
    const wednesday = addDays(today, 2);
    const dates = [addDays(today, -1), today, wednesday, wednesday, addDays(today, 7)];

    expect(projectRehabRuns(rows, dates, 23.1, 3, today)).toEqual([
      { dateKey: "2026-10-14", km: 3.5 },
    ]);
  });
});

describe("computeWeeklyRampHistory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replays the +10% rule week by week, oldest first, including the in-progress current week", () => {
    // "Today" is Monday 2024-01-15, the first day of the current week.
    vi.setSystemTime(new Date(2024, 0, 15, 9, 0, 0));

    const rows: TrainingLoadActivity[] = [
      activityOn("2024-01-01", 10), // week of 01-01: no reference week before it
      activityOn("2024-01-08", 15), // week of 01-08: +50% vs 10km -> red
      activityOn("2024-01-15", 2), // current week so far: well down vs 15km -> green
    ];

    const history = computeWeeklyRampHistory(rows, 2);

    expect(history).toEqual([
      {
        weekStartKey: "2024-01-01",
        weekKm: 10,
        previousWeekKm: 0,
        changePct: null,
        zone: "insufficient_data",
      },
      {
        weekStartKey: "2024-01-08",
        weekKm: 15,
        previousWeekKm: 10,
        changePct: 50,
        zone: "red",
      },
      {
        weekStartKey: "2024-01-15",
        weekKm: 2,
        previousWeekKm: 15,
        changePct: -86.7,
        zone: "green",
      },
    ]);
  });
});
