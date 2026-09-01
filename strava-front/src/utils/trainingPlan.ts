export type TrainingPlanLevel = "high" | "medium" | "low";

export type NormalWeekTarget = {
  hasEnoughData: boolean;
  km7: number;
  chronicWeek: number;
  acr: number;
  level: TrainingPlanLevel;
  targetKm: number;
};

const round1 = (value: number) => Math.round(value * 10) / 10;
const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

/** Builds a conservative weekly target from the recent running baseline. */
export function computeNormalWeekTarget(
  km7: number,
  km28: number,
  recentRunCount: number
): NormalWeekTarget {
  const safeKm7 = Math.max(0, km7);
  const safeKm28 = Math.max(0, km28);
  const chronicWeek = safeKm28 / 4;
  const acr = chronicWeek > 0 ? safeKm7 / chronicWeek : 0;
  const level: TrainingPlanLevel = acr > 1.3 ? "high" : acr < 0.85 ? "low" : "medium";

  if (recentRunCount < 3 || chronicWeek <= 0) {
    return {
      hasEnoughData: false,
      km7: safeKm7,
      chronicWeek,
      acr,
      level,
      targetKm: 0,
    };
  }

  const rawTarget = level === "high"
    ? Math.max(chronicWeek * 0.9, safeKm7 * 0.9)
    : level === "low"
      ? Math.max(chronicWeek * 1.04, safeKm7 * 1.03)
      : Math.max(chronicWeek, safeKm7 * 0.98);

  // Work already completed may exceed the baseline, but future work must not
  // manufacture a target beyond that or a 10% progression over the baseline.
  const maximumSafeTarget = Math.max(safeKm7, chronicWeek * 1.1);

  return {
    hasEnoughData: true,
    km7: safeKm7,
    chronicWeek,
    acr,
    level,
    targetKm: round1(clamp(rawTarget, 0, maximumSafeTarget)),
  };
}
