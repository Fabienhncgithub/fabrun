import { describe, expect, it } from "vitest";
import { addDays, localDateKey } from "./dateBuckets";
import { buildNormalPlan, buildRehabPlan, type PlanActivity, type PlannedSession } from "./weeklyPlan";

const futureRuns = (sessions: PlannedSession[]) => sessions.filter((session) => session.status === "planned" && session.type !== "rest");
const sum = (sessions: PlannedSession[]) => sessions.reduce((total, session) => total + session.km, 0);
const activity = (date: Date, km: number): PlanActivity => ({
  sport_type: "Run", distance: km * 1000, moving_time: Math.round(km * 360),
  start_date_local: `${localDateKey(date)}T08:00:00`,
});

function quotedLoad() {
  const monday = new Date(2026, 9, 12, 12);
  return [
    ...Array.from({ length: 10 }, (_, index) => activity(addDays(monday, -(27 - index * 2)), 4.08)),
    activity(addDays(monday, -7), 1.8), activity(addDays(monday, -2), 11),
    activity(addDays(monday, -1), 8.1), activity(monday, 6.1),
  ];
}

function assertRestricted(normal: ReturnType<typeof buildNormalPlan>, rehab: ReturnType<typeof buildRehabPlan>) {
  expect(rehab.targetKm).toBeLessThanOrEqual(normal.targetKm);
  const normalFutureKm = sum(futureRuns(normal.sessions));
  const rehabFutureKm = sum(futureRuns(rehab.sessions));
  expect(rehabFutureKm).toBeLessThanOrEqual(normalFutureKm * 0.5 + 1e-8);
  if (normalFutureKm > 0) expect(rehabFutureKm).toBeLessThan(normalFutureKm);
  for (const session of futureRuns(rehab.sessions)) {
    const base = futureRuns(normal.sessions).find((candidate) => localDateKey(candidate.date) === localDateKey(session.date));
    expect(base).toBeDefined();
    expect(session.km).toBeLessThanOrEqual(base!.km);
    expect(session.type).toBe("easy");
  }
  normal.sessions.filter((session) => session.status === "done").forEach((base) => {
    const unchanged = rehab.sessions.find((session) => localDateKey(session.date) === localDateKey(base.date));
    expect(unchanged?.km).toBe(base.km);
    expect(unchanged?.status).toBe(base.status);
  });
  rehab.progression.forEach((week, index) => expect(week.km).toBeLessThanOrEqual(normal.progression[index].km));
}

describe("pain mode restricts the same normal plan", () => {
  it("does not propose more kilometres for the reported 6.1 km completed week", () => {
    const now = new Date(2026, 9, 13, 12);
    const rows = quotedLoad();
    const normal = buildNormalPlan(rows, now);
    const rehab = buildRehabPlan(rows, now);
    assertRestricted(normal, rehab);
    expect(normal.targetKm).toBe(23);
    expect(sum(futureRuns(normal.sessions))).toBeCloseTo(16.9, 1);
    expect(rehab.targetKm).toBe(10.4);
    expect(sum(futureRuns(rehab.sessions))).toBeLessThanOrEqual(4.3);
    expect(rehab.sessions.find((session) => session.status === "done")?.km).toBe(6.1);
    expect(futureRuns(rehab.sessions).length).toBeGreaterThan(0);
  });

  it("keeps the restriction across week days and different recent loads", () => {
    for (let scenario = 0; scenario < 21; scenario++) {
      const now = new Date(2026, 9, 12 + scenario % 7, 12);
      const rows = Array.from({ length: 28 }, (_, index) => {
        const km = (index + scenario) % 3 === 0 ? 1 + ((index * 7 + scenario * 3) % 95) / 10 : 0;
        return activity(addDays(now, -index), km);
      }).filter((run) => run.distance > 0);
      assertRestricted(buildNormalPlan(rows, now), buildRehabPlan(rows, now));
    }
  });

  it("does not force all remaining weekly volume into one late-week session", () => {
    const sunday = new Date(2026, 9, 18, 12);
    const plan = buildNormalPlan(quotedLoad(), sunday);
    expect(plan.targetKm).toBe(23);
    const proposed = futureRuns(plan.sessions);
    expect(proposed).toHaveLength(1);
    expect(proposed[0].km).toBeLessThan(16.9);
    expect(proposed[0].km).toBeLessThanOrEqual(10.3);
  });

  it("uses the same insufficient-data state in both modes", () => {
    const now = new Date(2026, 9, 13, 12);
    const rows = [activity(addDays(now, -2), 5), activity(addDays(now, -1), 6)];
    expect(buildRehabPlan(rows, now).sessions).toEqual([]);
    expect(buildRehabPlan(rows, now).reasons).toEqual(buildNormalPlan(rows, now).reasons);
  });

  it("does not add a run after the completed volume already exceeds the reference", () => {
    const now = new Date(2026, 9, 16, 12);
    const rows = Array.from({ length: 28 }, (_, index) => activity(addDays(now, -index), index < 3 ? 25 : 2));
    const plan = buildRehabPlan(rows, now);
    expect(futureRuns(plan.sessions)).toEqual([]);
    expect(sum(plan.sessions.filter((session) => session.status === "done" && session.type !== "rest"))).toBeGreaterThan(plan.targetKm);
  });
});
