import { describe, it, expect } from "vitest";
import { matchGarminActivities } from "./garminActivityMatch";
import type { GarminActivity } from "../api";
const row = { id: 10, sport_type: "Run", start_date_local: "2026-11-14T09:30:00Z", distance: 10000, moving_time: 3600 };
const activity: GarminActivity = { id: 20, sport: "running", startLocal: "2026-11-14 09:30:15", distance: 10050, duration: 3610, load: 120, aerobic: 3.1, anaerobic: 0 };
describe("Garmin activity matching", () => {
  it("matches local clocks without converting the browser timezone", () => { expect(matchGarminActivities([row], [activity]).get(10)?.id).toBe(20); });
  it("rejects ambiguous candidates and reused Garmin activities", () => {
    expect(matchGarminActivities([row], [activity, { ...activity, id: 21 }]).size).toBe(0);
    expect(matchGarminActivities([row, { ...row, id: 11 }], [activity]).size).toBe(0);
  });
  it("rejects mismatched sports, timestamps, distances and durations", () => {
    for (const candidate of [{ ...activity, sport: "cycling" }, { ...activity, startLocal: "invalid" }, { ...activity, startLocal: "2026-11-14 10:30:00" }, { ...activity, distance: 12000 }, { ...activity, duration: 4000 }])
      expect(matchGarminActivities([row], [candidate]).size).toBe(0);
  });
  it("does not match unknown sports solely from similar measurements", () => { expect(matchGarminActivities([{ ...row, sport_type: "Other" }], [{ ...activity, sport: "other" }]).size).toBe(0); });
});
