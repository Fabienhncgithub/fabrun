import type { GarminRecovery } from "../api";

export function sleepHours(value: number | null | undefined) {
  if (value == null) return "Indisponible";
  const minutes = Math.round(value * 60);
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}
export function recoveryContext(data: GarminRecovery) {
  const last = data.nights.at(-1);
  const recent = data.nights.filter(n => n.date <= data.date && n.date >= new Date(Date.parse(`${data.date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10));
  const average = recent.length ? recent.reduce((sum, n) => sum + n.hours, 0) / recent.length : null;
  const shortfall = last && average != null && recent.length >= 3 ? Math.round((average - last.hours) * 60) : null;
  const stale = last?.date !== data.date;
  const status: Record<string, string> = { BALANCED: "Dans ta plage habituelle", LOW: "Sous ta plage habituelle", UNBALANCED: "Hors de ta plage habituelle", POOR: "Basse selon Garmin" };
  const attention = !stale && ((shortfall != null && shortfall >= 60) || ["LOW", "POOR", "UNBALANCED"].includes(data.hrvStatus ?? ""));
  return { last, average, count: recent.length, shortfall, stale, attention,
    hrvLabel: status[data.hrvStatus ?? ""] ?? "Pas de statut Garmin disponible" };
}
