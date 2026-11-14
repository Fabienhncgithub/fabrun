import { useEffect, useState } from "react";
import { loadGenevaForecast, type GenevaForecast } from "./genevaWeather";

/** Geneva forecast, refreshed every hour while the dashboard is open. */
export function useGenevaForecast(enabled: boolean) {
  const [weather, setWeather] = useState<GenevaForecast | null>(null);
  const [weatherError, setWeatherError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function refresh() {
      try {
        const forecast = await loadGenevaForecast(controller.signal);
        if (!controller.signal.aborted) { setWeather(forecast); setWeatherError(false); }
      } catch {
        if (!controller.signal.aborted) { setWeather(null); setWeatherError(true); }
      }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60 * 60 * 1000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [enabled]);
  return { weather, weatherError };
}
