import { useMemo, useState } from "react";
import {
  buildYearBuckets,
  parseStravaLocalDate,
  type DayBucketActivity,
} from "../utils/dateBuckets";
import EmptyState from "./EmptyState";

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
const MONTH_SHORT = [
  "Jan", "Fév", "Mar", "Avr", "Mai", "Juin", "Juil", "Août", "Sep", "Oct", "Nov", "Déc",
];

type Day = { key: string; date: Date; km: number; inYear: boolean };
type Week = { days: Day[]; monthLabel: string | null };

function levelForKm(km: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (km <= 0) return 0;
  if (max <= 0) return 1;
  const ratio = km / max;
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

function mondayOf(date: Date): Date {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  const copy = new Date(date);
  copy.setDate(copy.getDate() + offset);
  return copy;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

export default function YearHeatmapCard({ rows }: { rows: DayBucketActivity[] }) {
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const row of rows) {
      const date = parseStravaLocalDate(row.start_date_local);
      if (date) years.add(date.getFullYear());
    }
    years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  const [year, setYear] = useState(() => new Date().getFullYear());

  const { weeks, total, max, activeDays } = useMemo(() => {
    const buckets = buildYearBuckets(rows, year);
    const jan1 = new Date(year, 0, 1);
    const dec31 = new Date(year, 11, 31);
    const start = mondayOf(jan1);

    const weeksArr: Week[] = [];
    const seenMonths = new Set<number>();
    for (let cursor = new Date(start); cursor <= dec31; cursor.setDate(cursor.getDate() + 7)) {
      const days: Day[] = [];
      let monthLabel: string | null = null;
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        d.setDate(d.getDate() + i);
        const inYear = d >= jan1 && d <= dec31;
        const key = dayKey(d);
        days.push({ key, date: d, km: inYear ? buckets.get(key) ?? 0 : 0, inYear });
        if (inYear && d.getDate() <= 7 && !seenMonths.has(d.getMonth())) {
          seenMonths.add(d.getMonth());
          monthLabel = MONTH_SHORT[d.getMonth()];
        }
      }
      weeksArr.push({ days, monthLabel });
    }

    const kmValues = Array.from(buckets.values());
    const totalKm = kmValues.reduce((acc, v) => acc + v, 0);
    const maxKm = Math.max(...kmValues, 0);
    const active = kmValues.filter((v) => v > 0).length;
    return { weeks: weeksArr, total: totalKm, max: maxKm, activeDays: active };
  }, [rows, year]);

  return (
    <div className="panel year-heatmap-card">
      <div className="year-heatmap-head">
        <div className="panel-head">Activité de l'année</div>
        <div className="year-heatmap-years">
          {availableYears.map((y) => (
            <button
              type="button"
              key={y}
              className={`year-heatmap-year-btn ${y === year ? "year-heatmap-year-btn-active" : ""}`}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {total <= 0 ? (
        <EmptyState icon="📅" title="Rien à afficher" message={`Aucune sortie enregistrée en ${year}.`} />
      ) : (
        <>
          <div className="year-heatmap-scroll">
            <div className="year-heatmap-grid">
              <div className="year-heatmap-weekday-col">
                <span className="year-heatmap-month-spacer" aria-hidden />
                {WEEKDAY_LABELS.map((label, i) => (
                  <span key={i} className={i % 2 === 0 ? "" : "year-heatmap-weekday-dim"}>
                    {label}
                  </span>
                ))}
              </div>
              {weeks.map((week, weekIndex) => (
                <div className="year-heatmap-week-col" key={weekIndex}>
                  <span className="year-heatmap-month-label">{week.monthLabel ?? ""}</span>
                  {week.days.map((day) => (
                    <span
                      key={day.key}
                      className={`year-heatmap-cell year-heatmap-cell-level-${
                        day.inYear ? levelForKm(day.km, max) : "muted"
                      }`}
                      title={day.inYear ? `${day.key} — ${day.km.toFixed(1)} km` : undefined}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="year-heatmap-legend">
            <span>Moins</span>
            {[0, 1, 2, 3, 4].map((level) => (
              <span key={level} className={`year-heatmap-cell year-heatmap-cell-level-${level}`} />
            ))}
            <span>Plus</span>
            <span className="year-heatmap-summary">
              {total.toFixed(0)} km sur {activeDays} jour{activeDays > 1 ? "s" : ""} en {year}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
