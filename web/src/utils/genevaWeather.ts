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
export type HourWeather = { hour: number; rain: number; temp: number | null; probability: number | null; wind: number | null };
export type GenevaForecast = {
  rainyDays: Set<string>;
  daily: Map<string, DayWeather>;
  /** Hour-by-hour conditions per Swiss calendar day; empty when the forecast has no hourly detail. */
  hours: Map<string, HourWeather[]>;
  /** Sunrise and sunset as decimal local hours. */
  daylight: Map<string, { sunrise: number; sunset: number }>;
  updatedAt: Date;
};
export type RunWindow = { startHour: number; endHour: number; temp: number | null; probability: number | null; rain: number; dry: boolean; daylight: boolean };

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
  return { rainyDays, daily: result, hours: parseHours(data), daylight: parseDaylight(daily), updatedAt: now };
}

const optionalNumber = (values: unknown, index: number) => {
  const value = Array.isArray(values) ? values[index] : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

// Hourly detail only refines the advice (best time to run), so missing optional
// series degrade to "unknown" instead of rejecting the whole forecast.
function parseHours(data: unknown) {
  const hourly = (data as { hourly?: Record<string, unknown> }).hourly ?? {};
  const hours = new Map<string, HourWeather[]>();
  (hourly.time as string[]).forEach((time, index) => {
    const day = time.slice(0, 10);
    const list = hours.get(day) ?? [];
    list.push({
      hour: Number(time.slice(11, 13)),
      rain: (hourly.precipitation as number[])[index],
      temp: optionalNumber(hourly.temperature_2m, index),
      probability: optionalNumber(hourly.precipitation_probability, index),
      wind: optionalNumber(hourly.wind_speed_10m, index),
    });
    hours.set(day, list);
  });
  return hours;
}

function parseDaylight(daily: Record<string, unknown>) {
  const result = new Map<string, { sunrise: number; sunset: number }>();
  const decimalHour = (value: unknown) => {
    const match = typeof value === "string" ? /T(\d{2}):(\d{2})/.exec(value) : null;
    return match ? Number(match[1]) + Number(match[2]) / 60 : null;
  };
  (daily.time as string[]).forEach((date, index) => {
    const sunrise = decimalHour(Array.isArray(daily.sunrise) ? daily.sunrise[index] : null);
    const sunset = decimalHour(Array.isArray(daily.sunset) ? daily.sunset[index] : null);
    if (sunrise != null && sunset != null) result.set(date, { sunrise, sunset });
  });
  return result;
}

/** Current Swiss date and hour, independent of the browser timezone. */
export function swissNow(now = new Date()) {
  const text = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).format(now);
  return { date: text.slice(0, 10), hour: Number(text.slice(11, 13)) };
}

/**
 * Most comfortable start time between 6 h and 22 h for a run of the given
 * duration: dry first, then mild, calm and in daylight.
 */
export function bestRunWindow(forecast: GenevaForecast | null | undefined, date: string, durationMinutes: number, now = new Date()): RunWindow | null {
  const hours = forecast?.hours.get(date);
  if (!hours || hours.every(hour => hour.temp == null)) return null;
  const current = swissNow(now);
  if (date < current.date) return null;
  const earliest = date === current.date ? Math.max(6, current.hour + 1) : 6;
  const length = Math.max(1, Math.ceil(durationMinutes / 60));
  const daylight = forecast?.daylight.get(date);
  const isDay = (hour: number) => daylight == null || (hour >= daylight.sunrise - 0.5 && hour + 1 <= daylight.sunset + 0.5);
  const byHour = new Map(hours.map(hour => [hour.hour, hour]));
  let best: { score: number; start: number; slots: HourWeather[] } | null = null;
  for (let start = earliest; start + length <= 22; start++) {
    const slots = Array.from({ length }, (_, offset) => byHour.get(start + offset));
    if (slots.some(slot => slot == null)) continue;
    const window = slots as HourWeather[];
    const score = window.reduce((sum, slot) => {
      const temp = slot.temp ?? 12;
      const heat = temp > 22 ? (temp - 22) * 0.8 : temp < 2 ? (2 - temp) * 0.5 : Math.abs(temp - 12) * 0.08;
      return sum + slot.rain * 8 + (slot.probability ?? 0) / 25 + heat + (slot.wind ?? 0) / 20 + (isDay(slot.hour) ? 0 : 1.5);
    }, 0) / length;
    if (best == null || score < best.score - 1e-9) best = { score, start, slots: window };
  }
  if (!best) return null;
  const temps = best.slots.map(slot => slot.temp).filter((value): value is number => value != null);
  const probabilities = best.slots.map(slot => slot.probability).filter((value): value is number => value != null);
  const rain = best.slots.reduce((sum, slot) => sum + slot.rain, 0);
  return {
    startHour: best.start, endHour: best.start + length,
    temp: temps.length ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : null,
    probability: probabilities.length ? Math.max(...probabilities) : null,
    rain: Math.round(rain * 10) / 10,
    dry: rain < 0.2,
    daylight: best.slots.every(slot => isDay(slot.hour)),
  };
}

export function describeRunWindow(window: RunWindow) {
  const conditions = [
    window.temp != null ? `${window.temp}°` : null,
    window.dry ? "sec" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(window.rain)} mm de pluie`,
    window.daylight ? null : "de nuit",
  ].filter(Boolean).join(", ");
  return `${window.startHour} h–${window.endHour} h · ${conditions}`;
}

export async function fetchGenevaForecast(signal: AbortSignal): Promise<GenevaForecast> {
  const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.2044&longitude=6.1432&hourly=precipitation,temperature_2m,precipitation_probability,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,sunrise,sunset&timezone=Europe%2FZurich&forecast_days=7", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error("Weather unavailable");
  return parseGenevaForecast(await response.json());
}

// The today card and the weekly plan both need the forecast: share one request.
let shared: { at: number; promise: Promise<GenevaForecast> } | null = null;
export function loadGenevaForecast(signal: AbortSignal, maxAgeMs = 30 * 60 * 1000): Promise<GenevaForecast> {
  if (!shared || Date.now() - shared.at > maxAgeMs) {
    const entry = { at: Date.now(), promise: fetchGenevaForecast(new AbortController().signal) };
    entry.promise.catch(() => { if (shared === entry) shared = null; });
    shared = entry;
  }
  const pending = shared.promise;
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    pending.then(resolve, reject);
  });
}
