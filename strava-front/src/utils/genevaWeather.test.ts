import { describe, expect, it } from "vitest";
import { parseGenevaForecast, weatherCondition, rainyDaysFromForecast } from "./genevaWeather";

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


describe("daily forecast display", () => {
  const forecast = {
    hourly: { time: ["2026-10-21T18:00"], precipitation: [6] },
    daily: { time: ["2026-10-21"], temperature_2m_min: [8], temperature_2m_max: [14], precipitation_sum: [18], precipitation_probability_max: [95], weather_code: [63] },
  };
  it("uses the same forecast for daily conditions and rain avoidance", () => {
    const result = parseGenevaForecast(forecast, new Date("2026-10-20T10:00:00Z"));
    expect(result.rainyDays.has("2026-10-21")).toBe(true);
    expect(result.daily.get("2026-10-21")).toEqual({ date: "2026-10-21", min: 8, max: 14, rain: 18, probability: 95, code: 63 });
    expect(weatherCondition(63)).toEqual({ label: "Pluie", icon: "rain" });
    expect(weatherCondition(95).icon).toBe("storm");
    expect(weatherCondition(73).icon).toBe("snow");
  });
  it("rejects incomplete daily data rather than displaying invented values", () => {
    expect(() => parseGenevaForecast({ ...forecast, daily: { ...forecast.daily, temperature_2m_max: [null] } })).toThrow();
    expect(() => parseGenevaForecast({ ...forecast, daily: { ...forecast.daily, weather_code: [] } })).toThrow();
  });
});
