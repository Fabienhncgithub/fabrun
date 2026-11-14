import { describe, expect, it } from "vitest";
import type { GarminRecovery } from "../api";
import { buildCoach } from "./coach";
import { addDays, localDateKey } from "./dateBuckets";
import { bestRunWindow, parseGenevaForecast } from "./genevaWeather";
import { formatPaceRange, paceZones, racePace } from "./paces";
import { nextGoal, racePlan } from "./racePhase";
import { computeReadiness } from "./readiness";
import { analyzeRecentRuns } from "./sessionFeedback";
import { buildSessionWorkout } from "./workoutBuilder";

// Tuesday: the "medium" template schedules intervals on Tuesdays.
const now = new Date(2026, 9, 13, 7);
const today = localDateKey(now);
const predictions = { predictions: { "5k": 25 * 60 }, reference: { distanceKm: 5, timeSec: 25 * 60 }, exponentUsed: 1.06 };
const run = (daysAgo: number, km: number, pace = 390, hr: number | null = 140) => ({
  sport_type: "Run", distance: km * 1000, moving_time: km * pace, average_heartrate: hr, max_heartrate: 185,
  start_date_local: `${localDateKey(addDays(now, -daysAgo))}T08:00:00`,
});
// Four steady weeks of ~30 km: Tuesday, Thursday, Saturday, Sunday.
const steadyRows = [2, 3, 5, 9, 10, 12, 14, 16, 17, 19, 21, 23, 24, 26].map(daysAgo => run(daysAgo, 7.5));
const recovery = (overrides: Partial<GarminRecovery> = {}): GarminRecovery => ({
  date: today, syncedAtUtc: `${today}T05:00:00Z`,
  nights: [-3, -2, -1, 0].map(offset => ({ date: localDateKey(addDays(now, offset)), hours: 7.5, score: 80, deepMinutes: null, remMinutes: null, awakeMinutes: null })),
  hrvMs: 48, hrvWeeklyMs: 47, hrvStatus: "BALANCED", restingHeartRate: 52, restingHeartRate7d: 52,
  stress: 25, bodyBattery: 70, bodyBatteryAtWake: 78, ...overrides,
});

describe("training paces", () => {
  it("derives every zone from the 5 km estimate and orders them from slow to fast", () => {
    const zones = paceZones(predictions)!;
    expect(formatPaceRange(zones.easy)).toBe("6:10–6:50/km");
    expect(formatPaceRange(zones.tempo)).toBe("5:20–5:30/km");
    expect(zones.repetition.slow).toBeLessThan(zones.interval.fast);
    expect(zones.interval.slow).toBeLessThan(zones.tempo.fast);
    expect(zones.tempo.slow).toBeLessThan(zones.easy.fast);
  });
  it("gives no zones rather than invented ones without a usable estimate", () => {
    expect(paceZones(null)).toBeNull();
    expect(paceZones({ predictions: { "5k": 30 } })).toBeNull();
  });
  it("projects a slower pace for longer races", () => {
    expect(racePace(predictions, 21.097)!).toBeGreaterThan(racePace(predictions, 10)!);
  });
});

describe("structured sessions", () => {
  const paces = paceZones(predictions);
  it("keeps the session inside its distance budget", () => {
    for (const type of ["interval", "tempo", "long", "easy"] as const) {
      for (const km of [5.6, 7, 9.5, 14]) {
        const workout = buildSessionWorkout(type, km, { paces, phase: "build" });
        const meters = workout.steps.reduce((sum, step) => sum + step.durationValue, 0);
        expect(Math.abs(meters - km * 1000)).toBeLessThanOrEqual(50);
      }
    }
  });
  it("writes repetitions with a time and a pace", () => {
    expect(buildSessionWorkout("interval", 9, { paces, phase: "build" }).headline).toMatch(/^\d × 800 m en \d:\d{2} \(\d:\d{2}\/km\), récup 400 m au trot\.$/);
  });
  it("uses the goal pace in the specific phase of a half marathon", () => {
    const tempo = buildSessionWorkout("tempo", 10, { paces, phase: "specific", goalPace: 335, goalKm: 21.1 });
    expect(tempo.headline).toContain("allure objectif (5:35/km)");
    const long = buildSessionWorkout("long", 16, { paces, phase: "specific", goalPace: 335, goalKm: 21.1 });
    expect(long.headline).toContain("4 derniers km à allure objectif");
  });
});

describe("goal periodisation", () => {
  const goal = (daysAhead: number, distanceKm = 21.1) => ({ label: "Semi", distanceKm, targetDate: localDateKey(addDays(now, daysAhead)) });
  it("moves from base to race week as the date approaches", () => {
    expect(racePlan(goal(120), now)!.phase).toBe("base");
    expect(racePlan(goal(60), now)!.phase).toBe("build");
    expect(racePlan(goal(28), now)!.phase).toBe("specific");
    expect(racePlan(goal(9), now)!.phase).toBe("taper");
    expect(racePlan(goal(3), now)!.phase).toBe("race-week");
    expect(racePlan(goal(9), now)!.volumeFactor).toBeLessThan(1);
  });
  it("ignores past goals and picks the soonest upcoming one", () => {
    expect(nextGoal([goal(-2), goal(40), goal(12)], now)?.targetDate).toBe(goal(12).targetDate);
    expect(nextGoal([goal(-2)], now)).toBeNull();
  });
  it("schedules the race, a rest day before it and no intensity in race week", () => {
    const coach = buildCoach({ rows: steadyRows, predictions, hasShinPain: false, goalRaces: [goal(5, 10)], now });
    const race = coach.plan.sessions.find(session => session.race)!;
    expect(race.km).toBe(10);
    expect(localDateKey(race.date)).toBe(goal(5).targetDate);
    const dayBefore = coach.plan.sessions.find(session => localDateKey(session.date) === localDateKey(addDays(now, 4)))!;
    expect(dayBefore.type).toBe("rest");
    expect(coach.plan.sessions.some(session => session.status === "planned" && (session.type === "interval" || session.type === "tempo"))).toBe(false);
  });
});

describe("morning readiness", () => {
  it("stays unknown without a Garmin measurement dated today", () => {
    expect(computeReadiness(null, today, 1).level).toBe("unknown");
    expect(computeReadiness(recovery({ date: localDateKey(addDays(now, -1)) }), today, 1).level).toBe("unknown");
  });
  it("turns orange on one degraded signal and red on several", () => {
    expect(computeReadiness(recovery(), today, 1).level).toBe("green");
    expect(computeReadiness(recovery({ hrvStatus: "LOW" }), today, 1).level).toBe("orange");
    expect(computeReadiness(recovery({ hrvStatus: "LOW", bodyBatteryAtWake: 20 }), today, 1).level).toBe("red");
  });
  it("keeps, lightens or removes today's interval session accordingly", () => {
    const base = { rows: steadyRows, predictions, hasShinPain: false, now };
    const green = buildCoach({ ...base, recovery: recovery() }).today!;
    expect(green.type).toBe("interval");
    expect(green.workout?.paceLabel).toMatch(/\/km$/);

    const orange = buildCoach({ ...base, recovery: recovery({ hrvStatus: "LOW" }) }).today!;
    expect(orange.type).toBe("easy");
    expect(orange.km).toBeLessThan(green.km);
    expect(orange.adjustment).toContain("remplacé par un footing");

    const red = buildCoach({ ...base, recovery: recovery({ hrvStatus: "LOW", bodyBatteryAtWake: 20 }) }).today!;
    expect(red.type).toBe("rest");
    expect(red.km).toBe(0);
  });
  it("never lightens a session from yesterday's data", () => {
    const stale = recovery({ date: localDateKey(addDays(now, -1)), hrvStatus: "LOW", bodyBatteryAtWake: 10 });
    expect(buildCoach({ rows: steadyRows, predictions, hasShinPain: false, recovery: stale, now }).today!.type).toBe("interval");
  });
});

describe("session feedback", () => {
  const zones = paceZones(predictions)!;
  it("flags easy runs that were too fast or too costly, and recognises quality sessions", () => {
    const feedback = analyzeRecentRuns([run(1, 8, 340, 150), run(2, 8, 400, 165), run(3, 8, 400, 135), run(4, 6, 310, 170), run(30, 8), run(40, 8)], zones, now);
    expect(feedback.runs.map(item => item.verdict)).toEqual(["fast", "hard", "ok", "ok"]);
    expect(feedback.runs[3].kind).toBe("quality");
  });
  it("slows endurance paces when easy runs sit at a high heart rate", () => {
    const feedback = analyzeRecentRuns([1, 3, 5, 7].map(daysAgo => run(daysAgo, 8, 400, 162)), zones, now);
    expect(feedback.adjustmentPct).toBe(3);
    expect(paceZones(predictions, feedback.adjustmentPct)!.easy.fast).toBeGreaterThan(zones.easy.fast);
    expect(paceZones(predictions, feedback.adjustmentPct)!.tempo).toEqual(zones.tempo);
  });
});

describe("best time to run", () => {
  const hours = Array.from({ length: 24 }, (_, hour) => hour);
  const day = "2026-10-14";
  const forecast = parseGenevaForecast({
    hourly: {
      time: hours.map(hour => `${day}T${String(hour).padStart(2, "0")}:00`),
      precipitation: hours.map(hour => (hour >= 7 && hour <= 11 ? 2 : 0)),
      temperature_2m: hours.map(hour => (hour < 12 ? 6 : 13)),
      precipitation_probability: hours.map(hour => (hour >= 7 && hour <= 11 ? 90 : 5)),
      wind_speed_10m: hours.map(() => 8),
    },
    daily: { time: [day], temperature_2m_min: [6], temperature_2m_max: [13], precipitation_sum: [10], precipitation_probability_max: [90], weather_code: [61], sunrise: [`${day}T07:45`], sunset: [`${day}T18:40`] },
  }, now);
  it("prefers a dry daylight window over a wet morning", () => {
    const window = bestRunWindow(forecast, day, 50, now)!;
    expect(window.dry).toBe(true);
    expect(window.daylight).toBe(true);
    expect(window.startHour).toBeGreaterThanOrEqual(12);
  });
  it("only proposes hours that are still ahead today", () => {
    const afternoon = new Date("2026-10-14T13:30:00Z"); // 15:30 in Geneva
    expect(bestRunWindow(forecast, day, 50, afternoon)!.startHour).toBeGreaterThanOrEqual(16);
    expect(bestRunWindow(forecast, "2026-10-13", 50, afternoon)).toBeNull();
  });
});
