import { describe, expect, it } from "vitest";
import { parseStravaLocalDate, toDateKey } from "./dateBuckets";

describe("parseStravaLocalDate", () => {
  it("keeps Strava's local wall-clock time instead of applying a timezone shift", () => {
    const date = parseStravaLocalDate("2026-09-01T19:42:16Z");

    expect(date).not.toBeNull();
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(1);
    expect(date?.getHours()).toBe(19);
    expect(date?.getMinutes()).toBe(42);
  });

  it("uses the local calendar day for activity buckets", () => {
    expect(toDateKey("2026-09-01T23:55:00Z")).toBe("2026-09-01");
  });

  it("rejects impossible dates", () => {
    expect(parseStravaLocalDate("2026-02-30T10:00:00Z")).toBeNull();
  });
});
