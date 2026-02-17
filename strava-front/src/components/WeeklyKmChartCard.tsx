import { useMemo, useRef, useState, type MouseEvent } from "react";

type Activity = {
  sport_type: string;
  distance: number;
  start_date_local: string;
};

type Period = "12m" | "4m" | "1m";
type Bucket = "month" | "week" | "day";

type Point = {
  key: string;
  label: string;
  km: number;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

const PERIOD_CONFIG: Record<Period, { label: string; bucket: Bucket; count: number }> = {
  "12m": { label: "12 mois", bucket: "month", count: 12 },
  "4m": { label: "4 mois", bucket: "week", count: 16 },
  "1m": { label: "1 mois", bucket: "day", count: 30 },
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function startOfWeek(d: Date): Date {
  const copy = startOfDay(d);
  const day = copy.getDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + delta);
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addWeeks(d: Date, weeks: number): Date {
  return addDays(d, weeks * 7);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function keyOf(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function buildPoints(rows: Activity[], period: Period): Point[] {
  const cfg = PERIOD_CONFIG[period];
  const now = new Date();

  const starts: Date[] = [];
  if (cfg.bucket === "month") {
    const current = startOfMonth(now);
    for (let i = cfg.count - 1; i >= 0; i--) starts.push(addMonths(current, -i));
  } else if (cfg.bucket === "week") {
    const current = startOfWeek(now);
    for (let i = cfg.count - 1; i >= 0; i--) starts.push(addWeeks(current, -i));
  } else {
    const current = startOfDay(now);
    for (let i = cfg.count - 1; i >= 0; i--) starts.push(addDays(current, -i));
  }

  const map = new Map<string, number>(starts.map((d) => [keyOf(d), 0]));

  for (const row of rows) {
    if (!RUN_TYPES.has(row.sport_type)) continue;
    const d = parseDate(row.start_date_local);
    if (!d) continue;

    const bucketStart =
      cfg.bucket === "month" ? startOfMonth(d) : cfg.bucket === "week" ? startOfWeek(d) : startOfDay(d);
    const k = keyOf(bucketStart);
    if (!map.has(k)) continue;
    map.set(k, (map.get(k) ?? 0) + row.distance / 1000);
  }

  return starts.map((start) => {
    const km = round1(map.get(keyOf(start)) ?? 0);
    const label =
      cfg.bucket === "month"
        ? start.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "")
        : start.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }).replace(".", "");
    return { key: keyOf(start), label, km };
  });
}

export default function WeeklyKmChartCard({ rows }: { rows: Activity[] }) {
  const [period, setPeriod] = useState<Period>("4m");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const points = useMemo(() => buildPoints(rows, period), [rows, period]);
  const cfg = PERIOD_CONFIG[period];

  const maxKm = Math.max(...points.map((p) => p.km), 1);
  const total = round1(points.reduce((acc, p) => acc + p.km, 0));
  const avg = round1(total / Math.max(points.length, 1));
  const current = points[points.length - 1]?.km ?? 0;

  const chartWidth = 1000;
  const chartHeight = 180;
  const padLeft = 10;
  const padRight = 10;
  const padTop = 12;
  const padBottom = 14;
  const baseline = chartHeight - padBottom;
  const xSpan = chartWidth - padLeft - padRight;
  const ySpan = baseline - padTop;
  const yMax = Math.max(Math.ceil(maxKm * 1.1), 5);

  const coords = points.map((p, i) => {
    const x = points.length <= 1 ? chartWidth / 2 : padLeft + (i * xSpan) / (points.length - 1);
    const y = baseline - (p.km / yMax) * ySpan;
    return { ...p, x, y };
  });

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath =
    coords.length > 1
      ? `${linePath} L ${coords[coords.length - 1].x} ${baseline} L ${coords[0].x} ${baseline} Z`
      : "";

  const showLabel = (index: number) => {
    if (period === "12m") return true;
    if (period === "4m") return index % 2 === 0 || index === points.length - 1;
    return index % 5 === 0 || index === points.length - 1;
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((tick) => ({
    y: padTop + ySpan * tick,
    value: Math.round((yMax * (1 - tick)) * 10) / 10,
  }));

  const hovered = hoveredIndex == null ? null : coords[hoveredIndex] ?? null;

  const handleMove = (event: MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || coords.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const xInViewBox = ratio * chartWidth;
    let closest = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.abs(coords[i].x - xInViewBox);
      if (d < bestDist) {
        bestDist = d;
        closest = i;
      }
    }
    setHoveredIndex(closest);
  };

  return (
    <section className="weekly-km-card">
      <div className="weekly-km-head">
        <div>
          <div className="weekly-km-title">Charge de course</div>
          <div className="weekly-km-sub">Derniers {cfg.label}</div>
        </div>

        <div className="weekly-km-controls">
          <button
            className={`weekly-km-tab ${period === "12m" ? "weekly-km-tab-active" : ""}`}
            onClick={() => setPeriod("12m")}
            type="button"
          >
            12 mois
          </button>
          <button
            className={`weekly-km-tab ${period === "4m" ? "weekly-km-tab-active" : ""}`}
            onClick={() => setPeriod("4m")}
            type="button"
          >
            4 mois
          </button>
          <button
            className={`weekly-km-tab ${period === "1m" ? "weekly-km-tab-active" : ""}`}
            onClick={() => setPeriod("1m")}
            type="button"
          >
            1 mois
          </button>
        </div>
      </div>

      <div className="weekly-km-stats">
        <span>Derniere periode: {current.toFixed(1)} km</span>
        <span>Moyenne: {avg.toFixed(1)} km</span>
        <span>Total: {total.toFixed(1)} km</span>
      </div>

      <div className="weekly-km-chart">
        <div className="weekly-km-plot-row">
          <div className="weekly-km-y-axis">
            {yTicks.map((tick) => (
              <div key={tick.y} className="weekly-km-y-label">
                {tick.value.toFixed(1)}
              </div>
            ))}
          </div>

          <div className="weekly-km-plot">
            <svg
              ref={svgRef}
              className="weekly-km-svg"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              onMouseMove={handleMove}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <defs>
                <linearGradient id="weekly-km-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#fc4c02" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#fc4c02" stopOpacity="0.03" />
                </linearGradient>
              </defs>

              {yTicks.map((tick) => (
                <line key={tick.y} x1={0} y1={tick.y} x2={chartWidth} y2={tick.y} className="weekly-km-grid-line" />
              ))}

              {areaPath && <path d={areaPath} fill="url(#weekly-km-fill)" />}
              {linePath && <path d={linePath} className="weekly-km-line" />}

              {hovered && (
                <line x1={hovered.x} y1={padTop} x2={hovered.x} y2={baseline} className="weekly-km-hover-line" />
              )}

              {coords.map((c, i) => {
                const isCurrent = i === coords.length - 1;
                const isHovered = hovered?.key === c.key;
                return (
                  <circle
                    key={c.key}
                    cx={c.x}
                    cy={c.y}
                    r={isHovered ? 5.2 : isCurrent ? 4.2 : 3.1}
                    className={`weekly-km-point ${isCurrent ? "weekly-km-point-current" : ""} ${
                      isHovered ? "weekly-km-point-hovered" : ""
                    }`}
                  >
                    <title>
                      {c.label}: {c.km.toFixed(1)} km
                    </title>
                  </circle>
                );
              })}
            </svg>
            {hovered && (
              <div className="weekly-km-tooltip">
                <div className="weekly-km-tooltip-label">{hovered.label}</div>
                <div className="weekly-km-tooltip-value">{hovered.km.toFixed(1)} km</div>
              </div>
            )}
          </div>
        </div>

        <div className="weekly-km-labels" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
          {points.map((p, i) => (
            <div key={p.key} className="weekly-km-label">
              {showLabel(i) ? p.label : ""}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
