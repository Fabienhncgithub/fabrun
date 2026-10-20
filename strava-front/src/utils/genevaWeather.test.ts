import { describe, expect, it } from "vitest";
import { rainyDaysFromForecast } from "./genevaWeather";

describe("Geneva rain forecasts", () => {
  it("ignores light rain, night and elapsed hours in Swiss time", () => {
    const result = rainyDaysFromForecast({ hourly: {
      time: ["2026-10-20T08:00", "2026-10-20T14:00", "2026-10-21T02:00", "2026-10-21T12:00", "2026-10-22T18:00"],
      precipitation: [8, 2, 9, 4, 7],
    } }, new Date("2026-10-20T10:00:00Z"));
    expect([...result]).toEqual(["2026-10-21", "2026-10-22"]);
  });
  it("rejects missing forecast data instead of assuming dry weather", () => {
    expect(() => rainyDaysFromForecast({ hourly: { time: ["2026-10-21T12:00"], precipitation: [null] } })).toThrow();
  });
});
