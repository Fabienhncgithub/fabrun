import { describe, it, expect } from "vitest";
import { recoveryContext, sleepHours } from "./garminRecovery";
import type { GarminRecovery } from "../api";
const base: GarminRecovery = { date: "2026-11-14", syncedAtUtc: "2026-11-14T10:00:00Z", nights: [], hrvMs: null, hrvWeeklyMs: null, restingHeartRate: null, stress: null, bodyBattery: null, bodyBatteryAtWake: null };
describe("recovery context", () => {
  it("formats durations without decimal hours", () => { expect(sleepHours(4.93)).toBe("4 h 56"); expect(sleepHours(null)).toBe("Indisponible"); });
  it("does not infer recovery from missing or stale sleep", () => { expect(recoveryContext(base).stale).toBe(true); expect(recoveryContext({ ...base, hrvStatus: "LOW" }).attention).toBe(false); });
  it("uses calendar windows rather than the last seven recorded nights", () => {
    const nights = ["2026-10-22", "2026-11-13", "2026-11-14"].map(date => ({ date, hours: 7, score: null, deepMinutes: null, remMinutes: null, awakeMinutes: null }));
    expect(recoveryContext({ ...base, nights }).count).toBe(2);
    expect(recoveryContext({ ...base, nights, hrvStatus: "LOW" }).attention).toBe(true);
  });
});
