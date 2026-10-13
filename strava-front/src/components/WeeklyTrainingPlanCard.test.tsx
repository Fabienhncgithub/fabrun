import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import WeeklyTrainingPlanCard from "./WeeklyTrainingPlanCard";
import { addDays, localDateKey } from "../utils/dateBuckets";
import { computeNextAvailableRun, computeTrainingLoad } from "../utils/trainingLoad";

const today = new Date(2026, 9, 12, 12);
function activity(daysAgo: number, km: number) {
  return {
    sport_type: "Run", distance: km * 1000, moving_time: km * 360,
    start_date_local: `${localDateKey(addDays(today, -daysAgo))}T08:00:00`,
  };
}

describe("weekly plan and daily advice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(today);
  });
  afterEach(() => vi.useRealTimers());

  it("does not spend the weekly margin before the daily rehab budget reopens", () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => activity(27 - i * 2, 4.08)),
      activity(7, 1.8), activity(2, 11), activity(1, 8.1), activity(0, 6.1),
    ];
    expect(computeTrainingLoad(rows).weeklyRamp.remainingKm).toBeGreaterThan(16);
    expect(computeTrainingLoad(rows).periostitis.weekRemainingKm).toBe(4.3);
    const opening = computeNextAvailableRun(rows, 10, true);
    expect(opening?.daysAhead).toBe(5);

    const markup = renderToStaticMarkup(<WeeklyTrainingPlanCard rows={rows} hasShinPain />);
    const days = [...markup.matchAll(/<article\b[\s\S]*?<\/article>/g)].map((match) => match[0]);
    const plannedRuns = days.filter((day) => day.includes("weekly-plan-status-planned") && !day.includes("weekly-plan-rest "));
    expect(plannedRuns).toHaveLength(1);
    expect(days.slice(0, 5).every((day) => !plannedRuns.includes(day))).toBe(true);
    expect(markup).toContain("Si indolore");
  });

  it("keeps today's normal-plan slot at rest when the daily load leaves no budget", () => {
    const tuesday = new Date(2026, 9, 13, 12);
    vi.setSystemTime(tuesday);
    const rows = Array.from({ length: 28 }, (_, index) => {
      const daysAgo = index + 1;
      const km = daysAgo === 1 ? 30 : 3;
      return {
        sport_type: "Run", distance: km * 1000, moving_time: km * 360,
        start_date_local: `${localDateKey(addDays(tuesday, -daysAgo))}T08:00:00`,
      };
    });
    expect(computeTrainingLoad(rows).remainingNow).toBe(0);
    const markup = renderToStaticMarkup(<WeeklyTrainingPlanCard rows={rows} hasShinPain={false} />);
    const todayRow = [...markup.matchAll(/<article\b[\s\S]*?<\/article>/g)]
      .map((match) => match[0]).find((day) => day.includes("week-schedule-today"));
    expect(todayRow).toContain("weekly-plan-rest");
    expect(todayRow).toContain("Repos course");
  });

  it("explains insufficient data without showing a zero-distance plan or export", () => {
    const markup = renderToStaticMarkup(
      <WeeklyTrainingPlanCard rows={[activity(2, 5), activity(1, 6)]} hasShinPain={false} />
    );
    expect(markup).toContain("Pas encore de plan à proposer");
    expect(markup).toContain("Au moins trois sorties récentes");
    expect(markup).not.toContain('role="progressbar"');
    expect(markup).not.toContain("Exporter");
  });
});
