// Training paces derived from the athlete's current 5 km estimate.
// Ratios follow the usual relationships between race pace and training
// intensities (endurance ≈ 5 km pace + 24–36 %, threshold ≈ + 7–10 %, etc.).

export type PaceRange = { fast: number; slow: number }; // seconds per km

export type PaceZones = {
  fiveKPace: number;
  easy: PaceRange;
  long: PaceRange;
  tempo: PaceRange;
  interval: PaceRange;
  repetition: PaceRange;
  /** Endurance adjustment applied from recent sessions, in percent (+ = slower). */
  adjustmentPct: number;
};

type PredictionLike = {
  predictions?: Record<string, number>;
  reference?: { distanceKm: number; timeSec: number };
  exponentUsed?: number;
} | null | undefined;

const round5 = (seconds: number) => Math.round(seconds / 5) * 5;
const range = (base: number, fast: number, slow: number): PaceRange => ({ fast: round5(base * fast), slow: round5(base * slow) });

export function paceZones(predictions: PredictionLike, adjustmentPct = 0): PaceZones | null {
  const fiveK = predictions?.predictions?.["5k"];
  if (typeof fiveK !== "number" || !Number.isFinite(fiveK) || fiveK < 12 * 60 || fiveK > 60 * 60) return null;
  const pace = fiveK / 5;
  const endurance = pace * (1 + adjustmentPct / 100);
  return {
    fiveKPace: pace,
    easy: range(endurance, 1.24, 1.36),
    long: range(endurance, 1.22, 1.33),
    tempo: range(pace, 1.07, 1.1),
    interval: range(pace, 0.98, 1.01),
    repetition: range(pace, 0.93, 0.96),
    adjustmentPct,
  };
}

/** Riegel projection of the current reference effort onto any race distance. */
export function racePace(predictions: PredictionLike, distanceKm: number): number | null {
  const reference = predictions?.reference;
  const exponent = predictions?.exponentUsed;
  if (!reference || !(reference.distanceKm > 0) || !(reference.timeSec > 0) || !(distanceKm > 0)) return null;
  const seconds = reference.timeSec * Math.pow(distanceKm / reference.distanceKm, typeof exponent === "number" && exponent > 0 ? exponent : 1.06);
  return seconds / distanceKm;
}

export function formatPace(secondsPerKm: number) {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatPaceRange(value: PaceRange) {
  return value.fast === value.slow ? `${formatPace(value.fast)}/km` : `${formatPace(value.fast)}–${formatPace(value.slow)}/km`;
}

/** "3:44" for a repetition, "1 h 02" for a whole session. */
export function formatClock(seconds: number) {
  const total = Math.round(seconds);
  if (total >= 3600) return `${Math.floor(total / 3600)} h ${String(Math.round((total % 3600) / 60)).padStart(2, "0")}`;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const midPace = (value: PaceRange) => (value.fast + value.slow) / 2;
