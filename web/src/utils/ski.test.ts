import { describe, expect, it } from "vitest";
import type { GarminSkiDay } from "../api";
import { seasonLabel, skiSeasonStart, skiSeasons, summarizeSki } from "./ski";

const day = (startLocal: string, distance: number, elevationLoss: number | null, maxSpeed: number | null): GarminSkiDay =>
  ({ id: Math.random(), startLocal, sport: "resort_skiing", distance, duration: 0, elevationLoss, maxSpeed });

describe("ski", () => {
  it("groups December and March in the same season", () => {
    expect(skiSeasonStart("2025-12-20 09:00:00")).toBe(2025);
    expect(skiSeasonStart("2026-03-02 09:00:00")).toBe(2025);
    expect(seasonLabel(2025)).toBe("2025-26");
    expect(seasonLabel(2099)).toBe("2099-00");
  });

  it("sums distance and descent and converts max speed to km/h", () => {
    const s = summarizeSki("Total", [day("2026-01-10 09:00:00", 60000, 6000, 20), day("2026-01-11 09:00:00", 40000, null, null)]);
    expect(s.days).toBe(2);
    expect(s.km).toBe(100);
    expect(s.descentM).toBe(6000);
    expect(s.maxKmh).toBe(72);
    expect(s.biggestDayKm).toBe(60);
  });

  it("returns no max speed when none was measured and orders seasons newest first", () => {
    const seasons = skiSeasons([day("2024-12-20 09:00:00", 1000, 0, null), day("2026-02-01 09:00:00", 1000, 0, 10)]);
    expect(seasons.map((s) => s.label)).toEqual(["2025-26", "2024-25"]);
    expect(seasons[1].maxKmh).toBeNull();
  });
});
