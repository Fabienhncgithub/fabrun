import { useMemo } from "react";

type Activity = {
  sport_type: string;
  distance: number; // meters
  moving_time: number; // sec
  start_date_local: string;
  average_heartrate?: number | null;
};

type SleepSummary = {
  connected: boolean;
  lastSleepHours: number;
  avg7dHours: number;
  avg30dHours: number;
};

type TrendPoint = {
  key: string;
  label: string;
  hr: number | null;
  efficiency: number | null;
  samples: number;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  return `${y}-${m}`;
}

function isComparableRun(activity: Activity) {
  if (!RUN_TYPES.has(activity.sport_type)) return false;
  const km = activity.distance / 1000;
  const minutes = activity.moving_time / 60;
  return km >= 4 && km <= 20 && minutes >= 25 && minutes <= 110;
}

function buildTrend(rows: Activity[]): TrendPoint[] {
  const now = new Date();
  const currentMonth = startOfMonth(now);
  const months = Array.from({ length: 12 }, (_, i) => addMonths(currentMonth, -(11 - i)));
  const map = new Map(
    months.map((m) => [
      monthKey(m),
      { hr: [] as number[], efficiency: [] as number[], samples: 0 },
    ])
  );

  for (const row of rows) {
    if (!isComparableRun(row)) continue;
    if (typeof row.average_heartrate !== "number") continue;
    if (row.average_heartrate < 80 || row.average_heartrate > 210) continue;
    if (row.distance <= 0 || row.moving_time <= 0) continue;
    const date = parseDate(row.start_date_local);
    if (!date) continue;

    const bucket = map.get(monthKey(startOfMonth(date)));
    if (!bucket) continue;

    const speedMetersPerMin = row.distance / (row.moving_time / 60);
    const efficiency = speedMetersPerMin / row.average_heartrate;
    bucket.hr.push(row.average_heartrate);
    bucket.efficiency.push(efficiency);
    bucket.samples += 1;
  }

  return months.map((monthStart) => {
    const key = monthKey(monthStart);
    const bucket = map.get(key)!;
    const avgHr =
      bucket.hr.length > 0 ? round1(bucket.hr.reduce((acc, v) => acc + v, 0) / bucket.hr.length) : null;
    const avgEfficiency =
      bucket.efficiency.length > 0
        ? round2(bucket.efficiency.reduce((acc, v) => acc + v, 0) / bucket.efficiency.length)
        : null;

    return {
      key,
      label: monthStart.toLocaleDateString("fr-FR", { month: "short" }).replace(".", ""),
      hr: avgHr,
      efficiency: avgEfficiency,
      samples: bucket.samples,
    };
  });
}

function computeFormScore(rows: Activity[], sleep?: SleepSummary | null) {
  const now = Date.now();
  const runs = rows.filter((r) => RUN_TYPES.has(r.sport_type)).map((r) => ({ ...r, date: parseDate(r.start_date_local) }));
  const validRuns = runs.filter((r) => r.date != null);
  const inDays = (days: number) => validRuns.filter((r) => now - r.date!.getTime() <= days * 24 * 3600 * 1000);

  const runs7 = inDays(7);
  const runs42 = inDays(42);
  const runs2 = inDays(2);
  const runs1 = inDays(1);

  const km7 = runs7.reduce((acc, r) => acc + r.distance / 1000, 0);
  const km42 = runs42.reduce((acc, r) => acc + r.distance / 1000, 0);
  const chronicWeek = km42 / 6;
  const loadRatio = chronicWeek > 0 ? km7 / chronicWeek : null;

  let score = 50;
  if (loadRatio == null) {
    score -= 5;
  } else if (loadRatio >= 0.8 && loadRatio <= 1.2) {
    score += 22;
  } else if ((loadRatio >= 0.6 && loadRatio < 0.8) || (loadRatio > 1.2 && loadRatio <= 1.35)) {
    score += 12;
  } else if ((loadRatio >= 0.45 && loadRatio < 0.6) || (loadRatio > 1.35 && loadRatio <= 1.5)) {
    score += 4;
  } else {
    score -= 8;
  }

  if (runs1.length === 0) score += 4;
  const hadHard48h = runs2.some((r) => r.distance / 1000 >= 14 || r.moving_time >= 90 * 60);
  if (hadHard48h) score -= 6;

  if (sleep?.connected) {
    if (sleep.avg7dHours >= 7.5) score += 18;
    else if (sleep.avg7dHours >= 7.0) score += 12;
    else if (sleep.avg7dHours >= 6.5) score += 6;
    else if (sleep.avg7dHours < 6.0) score -= 10;

    if (sleep.avg7dHours >= sleep.avg30dHours + 0.3) score += 4;
    if (sleep.avg7dHours <= sleep.avg30dHours - 0.3) score -= 4;
    if (sleep.lastSleepHours >= 7.0) score += 4;
    if (sleep.lastSleepHours < 6.0) score -= 4;
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 80 ? "A" : score >= 65 ? "B" : score >= 50 ? "C" : score >= 35 ? "D" : "E";
  const status =
    score >= 75
      ? "Grande forme"
      : score >= 60
      ? "Bonne forme"
      : score >= 45
      ? "Forme moyenne"
      : "Fatigue probable";

  return {
    score,
    grade,
    status,
    km7: round1(km7),
    chronicWeek: round1(chronicWeek),
    loadRatio: loadRatio == null ? null : round2(loadRatio),
  };
}

function loadZone(loadRatio: number | null) {
  if (loadRatio == null) {
    return {
      label: "Charge inconnue",
      tone: "neutral" as const,
      advice: "Pas assez de donnees recentes pour evaluer la charge.",
    };
  }
  if (loadRatio > 1.5) {
    return {
      label: "Charge tres elevee",
      tone: "bad" as const,
      advice: "Tu charges beaucoup plus que ta base: allege 24-48h.",
    };
  }
  if (loadRatio > 1.3) {
    return {
      label: "Charge elevee",
      tone: "warn" as const,
      advice: "Risque de fatigue. Priorite a l'endurance facile.",
    };
  }
  if (loadRatio >= 0.8 && loadRatio <= 1.2) {
    return {
      label: "Charge optimale",
      tone: "good" as const,
      advice: "Bonne zone de progression.",
    };
  }
  return {
    label: "Charge basse",
    tone: "neutral" as const,
    advice: "Possible de construire progressivement.",
  };
}

function trendDelta(values: Array<number | null>) {
  const last = [...values].reverse().find((v): v is number => typeof v === "number");
  const first = values.find((v): v is number => typeof v === "number");
  if (last == null || first == null) return null;
  return round2(last - first);
}

function TrendLine({
  title,
  subtitle,
  labels,
  values,
  color,
  precision = 1,
  unit = "",
}: {
  title: string;
  subtitle: string;
  labels: string[];
  values: Array<number | null>;
  color: string;
  precision?: number;
  unit?: string;
}) {
  const valid = values.filter((v): v is number => typeof v === "number");
  if (valid.length === 0) {
    return (
      <div className="form-trend-plot-card">
        <div className="form-trend-plot-head">
          <div className="form-trend-plot-title">{title}</div>
          <div className="form-trend-plot-sub">{subtitle}</div>
        </div>
        <div className="form-trend-empty">Pas assez de données comparables sur 12 mois.</div>
      </div>
    );
  }

  const width = 1000;
  const height = 140;
  const padX = 8;
  const padY = 14;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = Math.max(max - min, 0.0001);
  const yMin = min - span * 0.12;
  const yMax = max + span * 0.12;

  const coords = values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : padX + (index * (width - padX * 2)) / (values.length - 1);
    if (value == null) return { x, y: null as number | null, value: null as number | null };
    const y = height - padY - ((value - yMin) / (yMax - yMin)) * (height - padY * 2);
    return { x, y, value };
  });

  const segments: string[] = [];
  let current: string[] = [];
  for (const coord of coords) {
    if (coord.y == null) {
      if (current.length >= 2) segments.push(current.join(" "));
      current = [];
      continue;
    }
    current.push(`${coord.x},${coord.y}`);
  }
  if (current.length >= 2) segments.push(current.join(" "));

  const last = [...values].reverse().find((v): v is number => typeof v === "number");
  const first = values.find((v): v is number => typeof v === "number");
  const delta = last != null && first != null ? last - first : null;

  return (
    <div className="form-trend-plot-card">
      <div className="form-trend-plot-head">
        <div>
          <div className="form-trend-plot-title">{title}</div>
          <div className="form-trend-plot-sub">{subtitle}</div>
        </div>
        <div className="form-trend-plot-stats">
          <span>
            Actuel: {last?.toFixed(precision)}
            {unit}
          </span>
          <span>
            Delta 12m: {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(precision)}${unit}`}
          </span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="form-trend-svg">
        <line x1={0} y1={height - padY} x2={width} y2={height - padY} className="form-trend-grid-line" />
        <line x1={0} y1={padY} x2={width} y2={padY} className="form-trend-grid-line" />
        {segments.map((segment, i) => (
          <polyline key={`segment-${i}`} points={segment} className="form-trend-line" style={{ stroke: color }} />
        ))}
        {coords.map((coord, i) =>
          coord.y == null ? null : <circle key={`pt-${i}`} cx={coord.x} cy={coord.y} r={2.8} fill={color} />
        )}
      </svg>

      <div className="form-trend-labels">
        {labels.map((label, i) => (
          <span key={`${label}-${i}`} className="form-trend-label">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function FormTrendCard({
  rows,
  sleep,
}: {
  rows: Activity[];
  sleep?: SleepSummary | null;
}) {
  const trend = useMemo(() => buildTrend(rows), [rows]);
  const score = useMemo(() => computeFormScore(rows, sleep), [rows, sleep]);
  const labels = trend.map((p) => p.label);
  const hrValues = trend.map((p) => p.hr);
  const efficiencyValues = trend.map((p) => p.efficiency);
  const sampleCount = trend.reduce((acc, p) => acc + p.samples, 0);
  const hrDelta = trendDelta(hrValues);
  const efficiencyDelta = trendDelta(efficiencyValues);
  const load = loadZone(score.loadRatio);

  const cardioMessage =
    hrDelta == null || efficiencyDelta == null
      ? "Tendance cardio insuffisante."
      : hrDelta > 2 && efficiencyDelta < 0
      ? "Ton cout cardio monte: meme effort, plus de BPM."
      : hrDelta < -2 && efficiencyDelta > 0
      ? "Bonne adaptation: moins de BPM et meilleure efficacite."
      : "Tendance plutot stable.";

  return (
    <section className="form-trend-card">
      <div className="form-trend-head">
        <div>
          <div className="form-trend-title">Evolution de forme</div>
          <div className="form-trend-sub">BPM et efficacite cardio sur 12 mois</div>
        </div>
        <div className="form-grade">
          <span className="form-grade-label">Forme du jour</span>
          <span className="form-grade-value">Grade {score.grade}</span>
          <span className="form-grade-score">{score.score}/100</span>
        </div>
      </div>

      <div className="form-trend-summary">
        <div className={`form-pill form-pill-${load.tone}`}>{load.label}</div>
        <div className="form-summary-line">
          <strong>Lecture du jour:</strong> {load.advice}
        </div>
        <div className="form-summary-line">
          <strong>Cardio:</strong> {cardioMessage}
        </div>
      </div>

      <div className="form-trend-metrics">
        <span>Etat: {score.status}</span>
        <span>Charge 7j: {score.km7.toFixed(1)} km</span>
        <span>Base 42j: {score.chronicWeek.toFixed(1)} km/sem</span>
        <span>Ratio charge: {score.loadRatio == null ? "—" : score.loadRatio.toFixed(2)}</span>
        <span>Sorties comparables: {sampleCount}</span>
      </div>

      <div className="form-trend-grid">
        <TrendLine
          title="BPM moyen"
          subtitle="A effort comparable, plus bas = mieux"
          labels={labels}
          values={hrValues}
          color="#dc2626"
          precision={1}
          unit=" bpm"
        />
        <TrendLine
          title="Economie de course"
          subtitle="Vitesse / BPM (plus haut = mieux)"
          labels={labels}
          values={efficiencyValues}
          color="#0f766e"
          precision={2}
        />
      </div>
    </section>
  );
}
