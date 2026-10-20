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

export async function fetchGenevaRainyDays(signal: AbortSignal): Promise<Set<string>> {
  const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=46.2044&longitude=6.1432&hourly=precipitation&timezone=Europe%2FZurich&forecast_days=7", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) throw new Error("Weather unavailable");
  return rainyDaysFromForecast(await response.json());
}
