/** Geneva forecasts use local Swiss dates, independent of the browser timezone. */
export function rainyDaysFromForecast(data: unknown, now = new Date()): Set<string> {
  const hourly = (data as { hourly?: { time?: unknown; precipitation?: unknown } } | null)?.hourly;
  if (!Array.isArray(hourly?.time) || !Array.isArray(hourly?.precipitation) || hourly.time.length !== hourly.precipitation.length || hourly.time.length === 0) {
    throw new Error("Invalid weather forecast");
  }
  const swissNow = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(now).replace(" ", "T");
  const precipitation: unknown[] = hourly.precipitation;
  const days = new Set<string>();
  hourly.time.forEach((time: unknown, index: number) => {
    const rain: unknown = precipitation[index];
    if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time) || typeof rain !== "number" || !Number.isFinite(rain) || rain < 0) throw new Error("Invalid hourly forecast");
    const hour = Number(time.slice(11, 13));
    if (time >= swissNow && hour >= 6 && hour < 22 && rain >= 4) days.add(time.slice(0, 10));
  });
  return days;
}

export type DayWeather = {
  date: string;
  min: number;
  max: number;
  rain: number;
  probability: number;
  code: number;
};
export type GenevaForecast = { rainyDays: Set<string>; daily: Map<string, DayWeather>; updatedAt: Date };

export function weatherCondition(code: number): { label: string; icon: "sun" | "cloud" | "rain" | "snow" | "storm" } {
  if (code === 0) return { label: "Ensoleillé", icon: "sun" };
  if (code <= 3) return { label: code === 1 ? "Éclaircies" : "Nuageux", icon: "cloud" };
  if (code <= 48) return { label: "Brouillard", icon: "cloud" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: "Neige", icon: "snow" };
  if (code >= 95) return { label: "Orages", icon: "storm" };
  return { label: "Pluie", icon: "rain" };
}

export function parseGenevaForecast(data: unknown, now = new Date()): GenevaForecast {
  const rainyDays = rainyDaysFromForecast(data, now);
  const daily = (data as { daily?: Record<string, unknown> }).daily;
  const keys = ["temperature_2m_min", "temperature_2m_max", "precipitation_sum", "precipitation_probability_max", "weather_code"];
  if (!daily || !Array.isArray(daily.time) || daily.time.length === 0 || keys.some(key => !Array.isArray(daily[key]) || (daily[key] as unknown[]).length !== (daily.time as unknown[]).length)) throw new Error("Invalid daily forecast");
  const result = new Map<string, DayWeather>();
  daily.time.forEach((date: unknown, index: number) => {
    const values = keys.map(key => (daily[key] as unknown[])[index]);
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || values.some(value => typeof value !== "number" || !Number.isFinite(value))) throw new Error("Incomplete daily forecast");
    const [min, max, rain, probability, code] = values as number[];
    result.set(date, { date, min, max, rain, probability, code });
  });
  return { rainyDays, daily: result, updatedAt: now };
}

export async function fetchGenevaForecast(signal: AbortSignal): Promise<GenevaForecast> {
  const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.2044&longitude=6.1432&hourly=precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=Europe%2FZurich&forecast_days=7", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error("Weather unavailable");
  return parseGenevaForecast(await response.json());
}
