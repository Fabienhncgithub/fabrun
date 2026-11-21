import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { fetchGarminHistory, type GarminHistory, type GarminHistoryDay, type GarminPeriod } from "../api";
import { sleepHours } from "../utils/garminRecovery";

const periods: [GarminPeriod, string][] = [["1d", "1 jour"], ["7d", "7 jours"], ["1m", "1 mois"], ["4m", "4 mois"], ["1y", "1 an"], ["2y", "2 ans"]];
const metrics = {
  caloriesTotal: ["Calories brûlées", "kcal"], caloriesActive: ["Calories actives", "kcal"],
  sleepHours: ["Sommeil", "h"], sleepScore: ["Score de sommeil", "/ 100"], hrvMs: ["HRV nocturne", "ms"],
  restingHeartRate: ["Pouls au repos", "bpm"], stress: ["Stress moyen", "/ 100"],
  bodyBattery: ["Body Battery · dernière mesure du jour", "/ 100"], weightKg: ["Poids", "kg"],
} as const;
type Metric = keyof typeof metrics;
type NumericField = Exclude<keyof GarminHistoryDay, "date">;

const isCalories = (field: NumericField) => field.startsWith("calories");
const kcal = (n: number) => `${Math.round(n).toLocaleString("fr-CH")} kcal`;

function mean(days: GarminHistoryDay[], field: NumericField) {
  const values = days.map(d => d[field]).filter((n): n is number => n != null);
  return { value: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, count: values.length };
}

export default function GarminHistoryChart() {
  const fillId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [period, setPeriod] = useState<GarminPeriod>("7d");
  const [metric, setMetric] = useState<Metric>("caloriesTotal");
  const [history, setHistory] = useState<GarminHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetchGarminHistory(period, controller.signal).then(result => { if (!controller.signal.aborted) setHistory(result); }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof TypeError ? "Connexion à FabRun interrompue. Réessaie le chargement de cette période." : e instanceof Error ? e.message : "Historique indisponible.");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [period, attempt]);

  const monthly = period === "1y" || period === "2y";
  const today = history?.until;
  // Today's calories are still accumulating: keep the point on the chart, but leave it
  // out of averages unless it is the only day available (1-day view).
  const settled = (days: GarminHistoryDay[], field: NumericField) =>
    isCalories(field) && days.length > 1 ? days.filter(d => d.date !== today) : days;
  const format = (n: number) => metric === "sleepHours" ? sleepHours(n)
    : isCalories(metric) ? kcal(n)
    : `${n.toLocaleString("fr-CH", { maximumFractionDigits: 1 })} ${metrics[metric][1]}`;

  const groups = new Map<string, GarminHistoryDay[]>();
  if (history) {
    const keyOf = (date: string) => monthly ? date.slice(0, 7) : date;
    for (let time = Date.parse(`${history.from}T12:00:00Z`); time <= Date.parse(`${history.until}T12:00:00Z`); time += 86400000) {
      const key = keyOf(new Date(time).toISOString().slice(0, 10));
      if (!groups.has(key)) groups.set(key, []);
    }
    for (const day of history.days) groups.get(keyOf(day.date))?.push(day);
  }
  const rows = [...groups.entries()].map(([date, days]) => ({ date, days, partial: !monthly && date === today }));
  const points = rows.map(r => ({ date: r.date, ...mean(monthly ? settled(r.days, metric) : r.days, metric) }));
  const allDays = history?.days ?? [];
  const summary = mean(settled(allDays, metric), metric);

  const width = 1000, height = 180, top = 12, bottom = 166;
  const present = points.map(p => p.value).filter((n): n is number => n != null);
  // Weight varies by a few kg: a zero baseline would flatten it, so scale around the data.
  const lower = metric === "weightKg" && present.length ? Math.floor(Math.min(...present)) - 1 : 0;
  const upper = metric === "weightKg" && present.length ? Math.ceil(Math.max(...present)) + 1
    : Math.max(...present, metric === "sleepHours" ? 8 : 1) * 1.15;
  const coords = points.map((p, i) => ({ ...p,
    x: points.length <= 1 ? width / 2 : 10 + i * 980 / (points.length - 1),
    y: p.value == null ? null : bottom - (p.value - lower) / (upper - lower) * (bottom - top),
  }));
  const segments: typeof coords[] = [];
  let segment: typeof coords = [];
  for (const point of coords) {
    if (point.y == null) { if (segment.length) segments.push(segment); segment = []; }
    else segment.push(point);
  }
  if (segment.length) segments.push(segment);
  const ticks = [0, .25, .5, .75, 1].map(t => ({ y: top + (bottom - top) * t, value: lower + (upper - lower) * (1 - t) }));
  const tickLabel = (n: number) => isCalories(metric) ? Math.round(n).toLocaleString("fr-CH") : n.toFixed(1);
  const hovered = hoveredIndex == null ? null : coords[hoveredIndex];
  const label = (date: string) => new Date(`${date.length === 7 ? `${date}-01` : date}T12:00:00Z`).toLocaleDateString("fr-CH", date.length === 7 ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });
  const labelPoints = coords.filter((_, i) => i % Math.max(1, Math.ceil(coords.length / 7)) === 0 || i === coords.length - 1);

  function hoverNearest(e: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !coords.length) return;
    const x = (e.clientX - rect.left) / rect.width * width;
    let closest = 0;
    coords.forEach((p, i) => { if (Math.abs(p.x - x) < Math.abs(coords[closest].x - x)) closest = i; });
    setHoveredIndex(closest);
  }
  function choosePeriod(key: GarminPeriod) {
    if (key === period) return;
    setLoading(true); setError(""); setHistory(null); setHoveredIndex(null); setPeriod(key);
  }

  return <section className="weekly-km-card garmin-history" aria-label="Historique Garmin">
    <div className="weekly-km-head">
      <div><div className="weekly-km-title">Énergie et récupération dans le temps</div><div className="weekly-km-sub">{metrics[metric][0]} · {metrics[metric][1]}</div></div>
      <div className="weekly-km-controls" role="group" aria-label="Période">
        {periods.map(([key, text]) => <button type="button" className={`weekly-km-tab ${period === key ? "weekly-km-tab-active" : ""}`} key={key} aria-pressed={period === key} onClick={() => choosePeriod(key)}>{text}</button>)}
      </div>
    </div>
    <div className="garmin-metric-controls" role="group" aria-label="Mesure">
      {(Object.keys(metrics) as Metric[]).map(key => <button type="button" key={key} className={`weekly-km-tab ${metric === key ? "weekly-km-tab-active" : ""}`} aria-pressed={metric === key} onClick={() => { setMetric(key); setHoveredIndex(null); }}>{metrics[key][0].replace(" · dernière mesure du jour", "")}</button>)}
    </div>
    {loading && <p role="status">Chargement de l’historique Garmin… Les périodes longues peuvent prendre une minute.</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => { setError(""); setLoading(true); setAttempt(value => value + 1); }}>Réessayer</button></div>}
    {history && <>
      <div className="weekly-km-stats">
        <span>{isCalories(metric) ? "Moyenne par jour" : "Moyenne"} : {summary.value == null ? "Indisponible" : format(summary.value)}</span>
        <span>{summary.count} jours renseignés</span>
        <span>{label(history.from)} – {label(history.until)}</span>
      </div>
      {present.length === 0 ? <p>Aucune mesure disponible sur cette période.</p> : <div className="weekly-km-chart">
        <div className="weekly-km-plot-row">
          <div className="weekly-km-y-axis" aria-hidden="true">{ticks.map(t => <div key={t.y} className="weekly-km-y-label">{tickLabel(t.value)}</div>)}</div>
          <div className="weekly-km-plot">
            <svg ref={svgRef} className="weekly-km-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${metrics[metric][0]}, du ${history.from} au ${history.until}. Valeurs détaillées disponibles sous le graphique.`}
              onPointerMove={hoverNearest} onPointerLeave={() => setHoveredIndex(null)}>
              <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#fc4c02" stopOpacity=".28" /><stop offset="100%" stopColor="#fc4c02" stopOpacity=".03" /></linearGradient></defs>
              {ticks.map(t => <line key={t.y} x1="0" x2={width} y1={t.y} y2={t.y} className="weekly-km-grid-line" />)}
              {segments.map((part, i) => {
                const path = part.map((p, j) => `${j ? "L" : "M"} ${p.x} ${p.y}`).join(" ");
                return <g key={i}>{part.length > 1 && <path d={`${path} L ${part.at(-1)!.x} ${bottom} L ${part[0].x} ${bottom} Z`} fill={`url(#${fillId})`} />}<path d={path} className="weekly-km-line" /></g>;
              })}
              {hovered && <line x1={hovered.x} x2={hovered.x} y1={top} y2={bottom} className="weekly-km-hover-line" />}
              {coords.map((p, i) => p.y == null ? null : <circle key={p.date} cx={p.x} cy={p.y} r={hoveredIndex === i ? 5.2 : 3.1} className={`weekly-km-point ${hoveredIndex === i ? "weekly-km-point-hovered" : ""}`}><title>{label(p.date)} : {format(p.value!)} · {p.count} jours</title></circle>)}
            </svg>
            {hovered && <div className="weekly-km-tooltip"><div className="weekly-km-tooltip-label">{label(hovered.date)}</div><div className="weekly-km-tooltip-value">{hovered.value == null ? "Indisponible" : format(hovered.value)}</div></div>}
          </div>
        </div>
        <div className="weekly-km-labels garmin-history-labels">{labelPoints.map(p => <div key={p.date} className="weekly-km-label">{label(p.date)}</div>)}</div>
      </div>}
      {isCalories(metric) && <CaloriesTable rows={rows} monthly={monthly} average={settled(allDays, "caloriesTotal")} settle={days => settled(days, "caloriesTotal")} label={label} />}
      <p className="garmin-stamp">{monthly ? "Moyennes mensuelles des jours renseignés." : "Mesures quotidiennes."} Les jours absents interrompent la courbe.
        {isCalories(metric) && " Calories Garmin : métabolisme de base + activité, toute la journée. La journée en cours est partielle et exclue des moyennes."}</p>
      {!isCalories(metric) && <details><summary>Consulter les valeurs du graphique</summary><div className="garmin-table"><table><thead><tr><th>Période</th><th>{metrics[metric][0]}</th><th>Jours renseignés</th></tr></thead><tbody>{points.map(p => <tr key={p.date}><td>{p.date}</td><td>{p.value == null ? "Indisponible" : format(p.value)}</td><td>{p.count}</td></tr>)}</tbody></table></div></details>}
    </>}
  </section>;
}

function CaloriesTable({ rows, monthly, average, settle, label }: {
  rows: { date: string; days: GarminHistoryDay[]; partial: boolean }[];
  monthly: boolean;
  average: GarminHistoryDay[];
  settle: (days: GarminHistoryDay[]) => GarminHistoryDay[];
  label: (date: string) => string;
}) {
  const cell = (days: GarminHistoryDay[], field: NumericField) => {
    const { value } = mean(days, field);
    return value == null ? "—" : kcal(value);
  };
  const ordered = [...rows].reverse().filter(r => r.days.some(d => d.caloriesTotal != null));
  return <div className="garmin-table garmin-calories">
    <table>
      <caption>Calories brûlées {monthly ? "· moyenne par jour, par mois" : "· par jour"}</caption>
      <thead><tr><th>{monthly ? "Mois" : "Jour"}</th><th>Total</th><th>Actives</th><th>Repos (métabolisme)</th></tr></thead>
      <tbody>
        <tr className="garmin-calories-average"><th scope="row">Moyenne par jour</th><td>{cell(average, "caloriesTotal")}</td><td>{cell(average, "caloriesActive")}</td><td>{cell(average, "caloriesResting")}</td></tr>
        {ordered.map(r => {
          const days = settle(r.days);
          return <tr key={r.date}>
            <td>{label(r.date)}{r.partial && " (en cours)"}</td>
            <td>{cell(days, "caloriesTotal")}</td><td>{cell(days, "caloriesActive")}</td><td>{cell(days, "caloriesResting")}</td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}
