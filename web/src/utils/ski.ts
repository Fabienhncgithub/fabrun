import type { GarminSkiDay } from "../api";

export type SkiSummary = {
  label: string;
  days: number;
  km: number;
  descentM: number;
  maxKmh: number | null;
  biggestDayKm: number;
};

// A ski season straddles the new year: July to June, labelled "2025-26".
export function skiSeasonStart(startLocal: string): number {
  const year = Number(startLocal.slice(0, 4));
  const month = Number(startLocal.slice(5, 7));
  return month >= 7 ? year : year - 1;
}

export function seasonLabel(start: number): string {
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function summarizeSki(label: string, days: GarminSkiDay[]): SkiSummary {
  const speeds = days.map((d) => d.maxSpeed).filter((v): v is number => v != null && v > 0);
  return {
    label,
    days: days.length,
    km: days.reduce((sum, d) => sum + d.distance, 0) / 1000,
    descentM: days.reduce((sum, d) => sum + (d.elevationLoss ?? 0), 0),
    maxKmh: speeds.length ? Math.max(...speeds) * 3.6 : null,
    biggestDayKm: days.reduce((max, d) => Math.max(max, d.distance), 0) / 1000,
  };
}

// Most recent season first.
export function skiSeasons(days: GarminSkiDay[]): SkiSummary[] {
  const groups = new Map<number, GarminSkiDay[]>();
  for (const day of days) {
    const start = skiSeasonStart(day.startLocal);
    groups.set(start, [...(groups.get(start) ?? []), day]);
  }
  return [...groups.entries()].sort(([a], [b]) => b - a).map(([start, list]) => summarizeSki(seasonLabel(start), list));
}
