import type { GarminRecovery } from "../api";

export type ReadinessLevel = "green" | "orange" | "red" | "unknown";
export type FactorTone = "good" | "warn" | "bad" | "unknown";
export type ReadinessFactor = { key: string; label: string; value: string; tone: FactorTone; note: string };

export type Readiness = {
  level: ReadinessLevel;
  title: string;
  advice: string;
  factors: ReadinessFactor[];
  /** True when Garmin data for today's date is available. */
  fresh: boolean;
};

const PENALTY: Record<FactorTone, number> = { good: 0, unknown: 0, warn: 1, bad: 2 };
const hoursLabel = (hours: number) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")}`;
};
const unknown = (key: string, label: string, note = "Pas de mesure aujourd’hui"): ReadinessFactor =>
  ({ key, label, value: "—", tone: "unknown", note });

function hrvFactor(data: GarminRecovery): ReadinessFactor {
  const value = data.hrvMs == null ? "—" : `${Math.round(data.hrvMs)} ms`;
  const status = data.hrvStatus;
  if (status === "BALANCED") return { key: "hrv", label: "HRV", value, tone: "good", note: "Dans ta plage habituelle" };
  if (status === "UNBALANCED") return { key: "hrv", label: "HRV", value, tone: "warn", note: "Hors de ta plage habituelle" };
  if (status === "LOW" || status === "POOR") return { key: "hrv", label: "HRV", value, tone: "bad", note: "Sous ta plage habituelle" };
  if (data.hrvMs != null && data.hrvBaselineLow != null) {
    return data.hrvMs < data.hrvBaselineLow
      ? { key: "hrv", label: "HRV", value, tone: "warn", note: "Sous ta plage habituelle" }
      : { key: "hrv", label: "HRV", value, tone: "good", note: "Dans ta plage habituelle" };
  }
  return unknown("hrv", "HRV");
}

function sleepFactor(data: GarminRecovery): ReadinessFactor {
  const night = data.nights.at(-1);
  if (!night || night.date !== data.date) return unknown("sleep", "Sommeil", "Nuit pas encore synchronisée");
  const weekStart = new Date(Date.parse(`${data.date}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  const recent = data.nights.filter(n => n.date >= weekStart && n.date < data.date);
  const average = recent.length >= 3 ? recent.reduce((sum, n) => sum + n.hours, 0) / recent.length : null;
  const value = hoursLabel(night.hours);
  if (night.hours < 5.5) return { key: "sleep", label: "Sommeil", value, tone: "bad", note: "Nuit très courte" };
  if (average != null && average - night.hours >= 1.5) return { key: "sleep", label: "Sommeil", value, tone: "bad", note: `${Math.round((average - night.hours) * 60)} min de moins que ta moyenne` };
  if (night.hours < 6.5) return { key: "sleep", label: "Sommeil", value, tone: "warn", note: "Nuit courte" };
  if (average != null && average - night.hours >= 1) return { key: "sleep", label: "Sommeil", value, tone: "warn", note: `${Math.round((average - night.hours) * 60)} min de moins que ta moyenne` };
  if (night.score != null && night.score < 60) return { key: "sleep", label: "Sommeil", value, tone: "warn", note: `Score Garmin ${Math.round(night.score)} / 100` };
  return { key: "sleep", label: "Sommeil", value, tone: "good", note: night.score != null ? `Score Garmin ${Math.round(night.score)} / 100` : "Durée correcte" };
}

function heartFactor(data: GarminRecovery): ReadinessFactor {
  if (data.restingHeartRate == null) return unknown("rhr", "Pouls au repos");
  const value = `${Math.round(data.restingHeartRate)} bpm`;
  if (data.restingHeartRate7d == null) return { key: "rhr", label: "Pouls au repos", value, tone: "unknown", note: "Pas encore de moyenne sur 7 jours" };
  const delta = Math.round(data.restingHeartRate - data.restingHeartRate7d);
  if (delta >= 7) return { key: "rhr", label: "Pouls au repos", value, tone: "bad", note: `+${delta} bpm par rapport à ta moyenne` };
  if (delta >= 4) return { key: "rhr", label: "Pouls au repos", value, tone: "warn", note: `+${delta} bpm par rapport à ta moyenne` };
  return { key: "rhr", label: "Pouls au repos", value, tone: "good", note: "Proche de ta moyenne sur 7 jours" };
}

function batteryFactor(data: GarminRecovery): ReadinessFactor {
  if (data.bodyBatteryAtWake == null) return unknown("battery", "Body Battery au réveil");
  const value = `${Math.round(data.bodyBatteryAtWake)} / 100`;
  if (data.bodyBatteryAtWake < 30) return { key: "battery", label: "Body Battery au réveil", value, tone: "bad", note: "Réserves très basses" };
  if (data.bodyBatteryAtWake < 50) return { key: "battery", label: "Body Battery au réveil", value, tone: "warn", note: "Recharge incomplète" };
  return { key: "battery", label: "Body Battery au réveil", value, tone: "good", note: "Bien rechargé" };
}

function loadFactor(acr: number | null): ReadinessFactor {
  if (acr == null) return unknown("load", "Charge récente", "Pas assez de sorties");
  const value = acr.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  if (acr > 1.5) return { key: "load", label: "Charge récente", value, tone: "bad", note: "Bien au-dessus de ton habitude" };
  if (acr > 1.3) return { key: "load", label: "Charge récente", value, tone: "warn", note: "Au-dessus de ton habitude" };
  return { key: "load", label: "Charge récente", value, tone: "good", note: "Proche de ton habitude" };
}

/**
 * Combines today's Garmin measurements with the recent running load.
 * Without a Garmin measurement dated today the level stays "unknown":
 * yesterday's data never decides today's session.
 */
export function computeReadiness(recovery: GarminRecovery | null | undefined, todayKey: string, acr: number | null): Readiness {
  const load = loadFactor(acr);
  const fresh = recovery != null && recovery.date === todayKey;
  if (!fresh) {
    return {
      level: "unknown", fresh: false,
      title: "Forme du jour inconnue",
      advice: "Synchronise Garmin pour adapter la séance à ta récupération. En attendant, le plan suit uniquement ta charge de course.",
      factors: [unknown("hrv", "HRV"), unknown("sleep", "Sommeil"), unknown("rhr", "Pouls au repos"), unknown("battery", "Body Battery au réveil"), load],
    };
  }
  const garmin = [hrvFactor(recovery), sleepFactor(recovery), heartFactor(recovery), batteryFactor(recovery)];
  const factors = [...garmin, load];
  if (garmin.every(factor => factor.tone === "unknown")) {
    return {
      level: "unknown", fresh: true, factors,
      title: "Forme du jour inconnue",
      advice: "Garmin n’a pas encore de mesure pour aujourd’hui. Synchronise ta montre, puis relance la synchronisation.",
    };
  }
  const penalty = factors.reduce((sum, factor) => sum + PENALTY[factor.tone], 0);
  const bad = factors.filter(factor => factor.tone === "bad").length;
  const level: ReadinessLevel = penalty >= 4 || bad >= 2 ? "red" : penalty >= 2 ? "orange" : "green";
  return {
    level, fresh: true, factors,
    title: level === "green" ? "Feu vert" : level === "orange" ? "Journée à alléger" : "Récupération prioritaire",
    advice: level === "green"
      ? "Tes signaux de récupération sont bons : la séance prévue est maintenue."
      : level === "orange"
        ? "Un ou deux signaux sont en retrait : pas d’intensité aujourd’hui. Un fractionné ou un tempo devient un footing, une sortie longue est raccourcie."
        : "Plusieurs signaux indiquent une récupération incomplète : pas de course aujourd’hui.",
  };
}
