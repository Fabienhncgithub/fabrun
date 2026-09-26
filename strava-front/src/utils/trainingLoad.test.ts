import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeNextAvailableRun,
  computeWeeklyRampHistory,
  computeWeeklyRampRedStreak,
  zoneFromWeeklyChangePct,
  type TrainingLoadActivity,
} from "./trainingLoad";

function activityOn(dateKey: string, km: number): TrainingLoadActivity {
  return {
    sport_type: "Run",
    distance: km * 1000,
    start_date_local: `${dateKey}T08:00:00Z`,
  };
}

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
