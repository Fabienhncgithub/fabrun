import { addDays, localDateKey, parseStravaLocalDate } from "./dateBuckets";
import { formatPace, formatPaceRange, type PaceZones } from "./paces";

export type FeedbackActivity = {
  sport_type: string;
  distance: number;
  moving_time?: number;
  start_date_local: string;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
};

export type RunFeedback = {
  dateKey: string;
  km: number;
  paceSec: number;
  heartRate: number | null;
  kind: "easy" | "quality";
  verdict: "ok" | "fast" | "hard" | "info";
  summary: string;
  text: string;
};

export type SessionFeedback = {
  runs: RunFeedback[];
  byDay: Map<string, RunFeedback>;
  /** Endurance pace adjustment in percent (+ = slower) derived from recent easy runs. */
  adjustmentPct: number;
  adjustmentReason: string | null;
  observedHrMax: number | null;
};

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const kmFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};

/**
 * Compares what was actually run with the target paces.
 * `zones` must be the unadjusted zones: the adjustment returned here is then
 * applied to the endurance paces of upcoming sessions.
 */
export function analyzeRecentRuns(rows: FeedbackActivity[], zones: PaceZones | null, now = new Date()): SessionFeedback {
  const todayKey = localDateKey(now);
  const runs = rows.flatMap(row => {
    if (!RUN_TYPES.has(row.sport_type) || !(row.distance >= 1000) || !(row.moving_time && row.moving_time > 0)) return [];
    const date = parseStravaLocalDate(row.start_date_local);
    if (!date) return [];
    const dateKey = localDateKey(date);
    return dateKey <= todayKey ? [{ row, dateKey, km: row.distance / 1000, paceSec: row.moving_time / (row.distance / 1000) }] : [];
  }).sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  const since = (days: number) => localDateKey(addDays(now, -(days - 1)));
  const maxValues = runs.filter(run => run.dateKey >= since(180))
    .map(run => run.row.max_heartrate).filter((value): value is number => typeof value === "number" && value >= 140 && value <= 220);
  // A single spike is often a strap artefact: require a few sessions before trusting the maximum.
  const observedHrMax = maxValues.length >= 3 ? Math.max(...maxValues) : null;

  const feedback: RunFeedback[] = runs.filter(run => run.dateKey >= since(14)).slice(0, 8).map(run => {
    const heartRate = typeof run.row.average_heartrate === "number" && run.row.average_heartrate > 0 ? run.row.average_heartrate : null;
    const ratio = heartRate != null && observedHrMax ? heartRate / observedHrMax : null;
    const summary = `${kmFormatter.format(run.km)} km à ${formatPace(run.paceSec)}/km${heartRate != null ? ` · ${Math.round(heartRate)} bpm` : ""}`;
    const base = { dateKey: run.dateKey, km: run.km, paceSec: run.paceSec, heartRate, summary };
    if (!zones) return { ...base, kind: "easy" as const, verdict: "info" as const, text: "Allures cibles indisponibles : pas encore d’estimation 5 km." };
    if (run.paceSec <= zones.tempo.slow * 1.03) {
      return { ...base, kind: "quality" as const, verdict: "ok" as const, text: "Sortie soutenue : compte-la comme une séance de qualité." };
    }
    if (ratio != null && ratio >= 0.85) {
      return { ...base, kind: "easy" as const, verdict: "hard" as const, text: `Fréquence cardiaque élevée pour de l’endurance (${Math.round(ratio * 100)} % de ton maximum observé). Ralentis sur les prochains footings.` };
    }
    if (run.paceSec < zones.easy.fast * 0.97) {
      return { ...base, kind: "easy" as const, verdict: "fast" as const, text: `Plus rapide que ta zone d’endurance (${formatPaceRange(zones.easy)}). Courir plus lentement les jours faciles aide à récupérer.` };
    }
    return { ...base, kind: "easy" as const, verdict: "ok" as const, text: "Dans la zone d’endurance." };
  });

  const byDay = new Map<string, RunFeedback>();
  for (const run of feedback) {
    const existing = byDay.get(run.dateKey);
    if (!existing || run.km > existing.km) byDay.set(run.dateKey, run);
  }

  let adjustmentPct = 0;
  let adjustmentReason: string | null = null;
  if (zones && observedHrMax) {
    const easy = runs.filter(run => run.dateKey >= since(21) && run.paceSec > zones.tempo.slow * 1.03
      && typeof run.row.average_heartrate === "number" && run.row.average_heartrate > 0);
    const ratio = median(easy.map(run => run.row.average_heartrate! / observedHrMax));
    const pace = median(easy.map(run => run.paceSec));
    if (easy.length >= 3 && ratio != null && pace != null) {
      if (ratio > 0.84) {
        adjustmentPct = 3;
        adjustmentReason = `Tes ${easy.length} derniers footings montent à ${Math.round(ratio * 100)} % de ta fréquence cardiaque maximale observée : les allures d’endurance sont ralenties de 3 %.`;
      } else if (ratio < 0.72 && pace < zones.easy.fast) {
        adjustmentPct = -2;
        adjustmentReason = `Tes ${easy.length} derniers footings sont plus rapides que la zone prévue à fréquence cardiaque basse (${Math.round(ratio * 100)} % du maximum observé) : les allures d’endurance sont accélérées de 2 %.`;
      }
    }
  }
  return { runs: feedback, byDay, adjustmentPct, adjustmentReason, observedHrMax };
}
