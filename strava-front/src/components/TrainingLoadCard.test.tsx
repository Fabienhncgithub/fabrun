import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TrainingLoadCard from "./TrainingLoadCard";
import { addDays, localDateKey } from "../utils/dateBuckets";
import { computeTrainingLoad } from "../utils/trainingLoad";
import { buildNormalPlan, buildRehabPlan } from "../utils/weeklyPlan";

afterEach(() => vi.useRealTimers());

describe("daily advice matches the selected weekly plan", () => {
  it("does not add running on a rest day when pain mode is activated", () => {
    const today = new Date(2026, 9, 13, 12);
    vi.useFakeTimers();
    vi.setSystemTime(today);
    const rows = [2.7, 4.8, 6.9, 9, 1.6, 3.7, 5.8, 7.9, 10].map((km, index) => ({
      id: index + 1, sport_type: "Run", distance: km * 1000, moving_time: km * 360,
      start_date_local: `${localDateKey(addDays(today, -(2 + index * 3)))}T08:00:00`,
    }));
    expect(computeTrainingLoad(rows, today).periostitis.remainingTodayKm).toBeGreaterThan(0.5);
    expect(buildNormalPlan(rows, today).sessions.find((session) => session.isToday)?.type).toBe("rest");
    expect(buildRehabPlan(rows, today).sessions.find((session) => session.isToday)?.type).toBe("rest");
    for (const hasShinPain of [false, true]) {
      const markup = renderToStaticMarkup(<TrainingLoadCard rows={rows} hasShinPain={hasShinPain} onShinPainChange={vi.fn()} />);
      expect(markup).toContain(">Repos course</h2>");
      expect(markup).not.toContain(">Reprise très facile</h2>");
      expect(markup).not.toContain("training-today-budget");
    }
  });
});
