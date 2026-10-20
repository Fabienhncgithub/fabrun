import { weatherCondition, type DayWeather } from "../utils/genevaWeather";

export function WeatherIcon({ code }: { code: number }) {
  const { icon } = weatherCondition(code);
  return <svg className={`plan-weather-icon plan-weather-icon-${icon}`} width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {icon === "sun" ? <><circle cx="16" cy="16" r="6" /><path d="M16 2v3m0 22v3M2 16h3m22 0h3M6 6l2 2m16 16 2 2M6 26l2-2M24 8l2-2" /></> : <><path d="M8 21a5 5 0 0 1-1-10 8 8 0 0 1 15-1 5.5 5.5 0 0 1 2 11H8Z" />{icon === "rain" && <path d="m11 25-1 3m7-3-1 3m7-3-1 3" />}{icon === "snow" && <path d="M10 26h.1M17 26h.1M24 26h.1" />}{icon === "storm" && <path d="m18 19-4 6h5l-3 6" />}</>}
  </svg>;
}

export default function PlanWeather({ day, heavy, compact = false }: { day: DayWeather; heavy: boolean; compact?: boolean }) {
  const condition = weatherCondition(day.code);
  return <div className={`plan-day-weather${heavy ? " plan-day-weather-heavy" : ""}${compact ? " plan-day-weather-compact" : ""}`} aria-label={`${condition.label}, ${Math.round(day.min)} à ${Math.round(day.max)} degrés, ${day.rain} millimètres de précipitations, probabilité ${day.probability} %`}>
    <div className="plan-day-weather-main"><WeatherIcon code={day.code} /><span><strong>{Math.round(day.max)}° <small>/ {Math.round(day.min)}°</small></strong><span>{condition.label}</span></span></div>
    <div className="plan-day-weather-rain"><span>↧ {new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(day.rain)} mm</span><span>{Math.round(day.probability)} %</span></div>
    {heavy && <span className="plan-weather-warning">Forte pluie · course évitée</span>}
  </div>;
}
