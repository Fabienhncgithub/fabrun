import { computeTrainingLoad } from "../utils/trainingLoad";
import { computeNormalWeekTarget } from "../utils/trainingPlan";
import { parseStravaLocalDate } from "../utils/dateBuckets";
import {
  buildTcxMultiple,
  distanceBudgetSteps,
  downloadTextFile,
  type WorkoutExport,
} from "../utils/workoutExport";

type Activity = {
  sport_type: string;
  distance: number;
  moving_time: number;
  start_date_local: string;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
};

type Predictions = {
  predictions?: Record<string, number>;
};

type SessionType = "rest" | "easy" | "tempo" | "interval" | "long";
type SessionStatus = "done" | "missed" | "planned";

type PlannedSession = {
  date: Date;
  type: SessionType;
  ratio: number;
  km: number;
  title: string;
  details: string;
  status: SessionStatus;
  isToday: boolean;
};

type WeekTarget = {
  label: string;
  km: number;
};

type DatedRun = Activity & { date: Date };
type RawSession = Omit<PlannedSession, "status" | "isToday">;
type AllocationSlot = { index: number; weight: number; capKm: number };

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);
const DAY_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const DAY_LONG = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function toDate(value: string) {
  return parseStravaLocalDate(value);
}

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function currentMonday(from: Date) {
  const date = startOfDay(from);
  const jsDay = date.getDay();
  date.setDate(date.getDate() + (jsDay === 0 ? -6 : 1 - jsDay));
  return date;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRuns(rows: Activity[]): DatedRun[] {
  return rows
    .filter((activity) => RUN_TYPES.has(activity.sport_type))
    .flatMap((activity) => {
      const date = toDate(activity.start_date_local);
      return date ? [{ ...activity, date }] : [];
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime());
}

function actualKmByDay(sessions: RawSession[], runs: DatedRun[]) {
  const weekKeys = new Set(sessions.map((session) => localDateKey(session.date)));
  const result = new Map<string, number>();

  for (const run of runs) {
    const key = localDateKey(run.date);
    if (!weekKeys.has(key)) continue;
    result.set(key, (result.get(key) ?? 0) + run.distance / 1000);
  }

  return result;
}

/**
 * Répartit une distance sur les créneaux encore disponibles sans dépasser
 * leur plafond. Si la semaine est déjà trop avancée, le reliquat reste
 * volontairement non planifié au lieu d'être tassé sur une seule sortie.
 */
function allocateDistance(totalKm: number, slots: AllocationSlot[]) {
  const allocations = new Map<number, number>();
  let remainingKm = Math.max(0, totalKm);
  let active = slots.filter((slot) => slot.capKm > 0);

  for (const slot of active) allocations.set(slot.index, 0);

  while (remainingKm > 0.001 && active.length > 0) {
    const totalWeight = active.reduce((sum, slot) => sum + slot.weight, 0);
    const capped = active.filter((slot) => {
      const current = allocations.get(slot.index) ?? 0;
      const share = remainingKm * (slot.weight / totalWeight);
      return share >= slot.capKm - current - 0.001;
    });

    if (capped.length === 0) {
      for (const slot of active) {
        const current = allocations.get(slot.index) ?? 0;
        allocations.set(slot.index, current + remainingKm * (slot.weight / totalWeight));
      }
      remainingKm = 0;
      break;
    }

    const cappedIndexes = new Set(capped.map((slot) => slot.index));
    for (const slot of capped) {
      const current = allocations.get(slot.index) ?? 0;
      const capacity = Math.max(0, slot.capKm - current);
      allocations.set(slot.index, current + capacity);
      remainingKm = Math.max(0, remainingKm - capacity);
    }
    active = active.filter((slot) => !cappedIndexes.has(slot.index));
  }

  for (const [index, km] of allocations) allocations.set(index, round1(km));

  const roundedTarget = round1(Math.min(totalKm, slots.reduce((sum, slot) => sum + slot.capKm, 0)));
  const roundedTotal = round1(Array.from(allocations.values()).reduce((sum, km) => sum + km, 0));
  let roundingDifference = round1(roundedTarget - roundedTotal);
  for (const slot of [...slots].reverse()) {
    if (Math.abs(roundingDifference) < 0.05) break;
    const current = allocations.get(slot.index) ?? 0;
    const adjusted = round1(clamp(current + roundingDifference, 0, slot.capKm));
    allocations.set(slot.index, adjusted);
    roundingDifference = round1(roundingDifference - (adjusted - current));
  }
  return allocations;
}

function normalSessionDetails(type: SessionType, km: number) {
  if (type === "easy") return `${km.toFixed(1)} km faciles, respiration aisée.`;
  if (type === "interval") return `${km.toFixed(1)} km au total avec fractionné court et récupération au trot.`;
  if (type === "tempo") return `${km.toFixed(1)} km dont 15–20 min soutenues mais contrôlées.`;
  if (type === "long") return `${km.toFixed(1)} km en endurance régulière, sans forcer.`;
  return "Repos complet ou 20 min de mobilité/renforcement léger.";
}

function completedSession(base: RawSession, actualKm: number, isToday: boolean): PlannedSession {
  const plannedNote = base.type === "rest" ? "" : ` • plan initial ${base.km.toFixed(1)} km`;
  return {
    ...base,
    type: base.type === "rest" ? "easy" : base.type,
    km: round1(actualKm),
    title: "Course réalisée",
    details: `Import Strava : ${round1(actualKm).toFixed(1)} km${plannedNote}. Le reste de la semaine est recalculé.`,
    status: "done",
    isToday,
  };
}

function pastSession(base: RawSession): PlannedSession {
  const wasRestDay = base.type === "rest";
  return {
    ...base,
    status: wasRestDay ? "done" : "missed",
    isToday: false,
    details: wasRestDay
      ? "Journée sans course terminée."
      : `${base.details} Non réalisée : ces kilomètres ne sont pas automatiquement rattrapés.`,
  };
}

function adaptNormalSessions(
  sessions: RawSession[],
  runs: DatedRun[],
  now: Date,
  targetKm: number
) {
  const today = startOfDay(now);
  const actuals = actualKmByDay(sessions, runs);
  const actualWeekKm = Array.from(actuals.values()).reduce((sum, km) => sum + km, 0);
  const remainingKm = Math.max(0, targetKm - actualWeekKm);
  const slots: AllocationSlot[] = sessions.flatMap((session, index) => {
    const day = startOfDay(session.date);
    const hasActual = (actuals.get(localDateKey(session.date)) ?? 0) > 0.05;
    if (day < today || hasActual || session.type === "rest") return [];
    return [{ index, weight: Math.max(session.ratio, 0.1), capKm: Math.max(1, session.km * 1.2) }];
  });
  const allocations = allocateDistance(remainingKm, slots);

  return sessions.map((session, index): PlannedSession => {
    const day = startOfDay(session.date);
    const isToday = day.getTime() === today.getTime();
    const actualKm = actuals.get(localDateKey(session.date)) ?? 0;
    if (actualKm > 0.05) return completedSession(session, actualKm, isToday);
    if (day < today) return pastSession(session);

    const allocatedKm = allocations.get(index) ?? 0;
    if (allocatedKm > 0.05) {
      return {
        ...session,
        km: allocatedKm,
        details: normalSessionDetails(session.type, allocatedKm),
        status: "planned",
        isToday,
      };
    }

    if (session.type !== "rest") {
      return {
        ...session,
        type: "rest",
        ratio: 0,
        km: 0,
        title: "Récupération ajustée",
        details: remainingKm <= 0.05
          ? "La cible hebdomadaire est déjà atteinte : aucune course supplémentaire planifiée."
          : "Séance retirée pour ne pas concentrer les kilomètres manqués en fin de semaine.",
        status: "planned",
        isToday,
      };
    }

    return { ...session, status: "planned", isToday };
  });
}

function chooseRehabDays(
  sessions: RawSession[],
  actuals: Map<string, number>,
  now: Date,
  requestedCount: number
) {
  if (requestedCount <= 0) return [] as number[];
  const todayKey = localDateKey(now);
  const futureIndexes = sessions
    .map((session, index) => ({ index, key: localDateKey(session.date) }))
    .filter(({ key }) => key >= todayKey && (actuals.get(key) ?? 0) <= 0.05)
    .map(({ index }) => index);
  const occupied = sessions
    .map((session, index) => ({ index, km: actuals.get(localDateKey(session.date)) ?? 0 }))
    .filter(({ km }) => km > 0.05)
    .map(({ index }) => index);
  const preferred = new Set(
    sessions.map((session, index) => session.type === "easy" ? index : -1).filter((index) => index >= 0)
  );

  let best: number[] = [];
  let bestScore = -1;
  const combinations = 1 << futureIndexes.length;
  for (let mask = 0; mask < combinations; mask += 1) {
    const selected = futureIndexes.filter((_, bit) => (mask & (1 << bit)) !== 0);
    if (selected.length > requestedCount) continue;
    const safelySpaced = selected.every((day, index) =>
      occupied.every((actualDay) => Math.abs(day - actualDay) >= 2) &&
      selected.slice(0, index).every((plannedDay) => day - plannedDay >= 2)
    );
    if (!safelySpaced) continue;
    const preferredCount = selected.filter((index) => preferred.has(index)).length;
    const spread = selected.length > 1 ? selected[selected.length - 1] - selected[0] : 0;
    const score = selected.length * 100 + preferredCount * 10 + spread;
    if (score > bestScore) {
      best = selected;
      bestScore = score;
    }
  }

  return best.sort((a, b) => a - b);
}

function adaptRehabSessions(
  sessions: RawSession[],
  runs: DatedRun[],
  now: Date,
  targetKm: number,
  desiredSessionCount: number
) {
  const today = startOfDay(now);
  const actuals = actualKmByDay(sessions, runs);
  const actualRunDays = Array.from(actuals.values()).filter((km) => km > 0.05).length;
  const actualWeekKm = Array.from(actuals.values()).reduce((sum, km) => sum + km, 0);
  const remainingKm = Math.max(0, targetKm - actualWeekKm);
  const futureSessionCount = Math.max(0, desiredSessionCount - actualRunDays);
  const selectedDays = chooseRehabDays(sessions, actuals, now, futureSessionCount);
  const perSessionCapKm = targetKm > 0 ? targetKm / desiredSessionCount : 0;
  const allocations = allocateDistance(
    remainingKm,
    selectedDays.map((index) => ({ index, weight: 1, capKm: perSessionCapKm }))
  );

  return sessions.map((session, index): PlannedSession => {
    const day = startOfDay(session.date);
    const isToday = day.getTime() === today.getTime();
    const actualKm = actuals.get(localDateKey(session.date)) ?? 0;
    if (actualKm > 0.05) return completedSession(session, actualKm, isToday);
    if (day < today) return pastSession(session);

    const allocatedKm = allocations.get(index) ?? 0;
    if (allocatedKm > 0.05) {
      const isFirstRun = actualRunDays === 0 && index === selectedDays[0];
      return {
        ...session,
        type: "easy",
        ratio: targetKm > 0 ? allocatedKm / targetKm : 0,
        km: allocatedKm,
        title: isFirstRun ? "Course-marche test" : "Endurance très facile",
        details: `${allocatedKm.toFixed(1)} km maximum, terrain plat, sans allure ni côte. Arrêt si la douleur augmente.`,
        status: "planned",
        isToday,
      };
    }

    return {
      ...session,
      type: "rest",
      ratio: 0,
      km: 0,
      title: "Repos / sans impact",
      details: remainingKm <= 0.05
        ? "Plafond hebdomadaire atteint : récupération sans course."
        : "Repos, mobilité douce, natation ou vélo facile uniquement si totalement indolore.",
      status: "planned",
      isToday,
    };
  });
}

function expectedWeekKm(sessions: PlannedSession[]) {
  return round1(
    sessions
      .filter((session) => session.type !== "rest" && session.status !== "missed")
      .reduce((sum, session) => sum + session.km, 0)
  );
}

function buildNormalPlan(rows: Activity[], now = new Date()) {
  const runs = getRuns(rows);
  if (runs.length === 0) {
    return {
      targetKm: 0,
      level: "high" as const,
      sessions: [] as PlannedSession[],
      progression: [] as WeekTarget[],
      reasons: ["Aucune sortie de course exploitable pour construire une semaine."],
    };
  }

  const inLastDays = (days: number) =>
    runs.filter((run) => {
      const ageMs = now.getTime() - run.date.getTime();
      return ageMs >= 0 && ageMs <= days * 24 * 3600 * 1000;
    });
  const runs28 = inLastDays(28);
  const km7 = inLastDays(7).reduce((sum, run) => sum + run.distance / 1000, 0);
  const km28 = runs28.reduce((sum, run) => sum + run.distance / 1000, 0);
  const target = computeNormalWeekTarget(km7, km28, runs28.length);
  if (!target.hasEnoughData) {
    return {
      targetKm: 0,
      level: "low" as const,
      sessions: [] as PlannedSession[],
      progression: [] as WeekTarget[],
      reasons: ["Au moins trois sorties récentes sont nécessaires pour proposer une semaine fiable."],
    };
  }
  const { chronicWeek, acr, level, targetKm } = target;

  const templates: Record<"high" | "medium" | "low", { day: number; type: SessionType; ratio: number }[]> = {
    high: [
      { day: 1, type: "easy", ratio: 0.35 },
      { day: 3, type: "easy", ratio: 0.25 },
      { day: 6, type: "long", ratio: 0.4 },
    ],
    medium: [
      { day: 1, type: "interval", ratio: 0.26 },
      { day: 3, type: "easy", ratio: 0.18 },
      { day: 5, type: "tempo", ratio: 0.24 },
      { day: 6, type: "long", ratio: 0.32 },
    ],
    low: [
      { day: 0, type: "easy", ratio: 0.18 },
      { day: 2, type: "interval", ratio: 0.24 },
      { day: 4, type: "easy", ratio: 0.16 },
      { day: 5, type: "tempo", ratio: 0.18 },
      { day: 6, type: "long", ratio: 0.24 },
    ],
  };
  const lowVolumeTemplate: { day: number; type: SessionType; ratio: number }[] = [
    { day: 1, type: "easy", ratio: 0.3 },
    { day: 3, type: "easy", ratio: 0.3 },
    { day: 6, type: "long", ratio: 0.4 },
  ];
  const template = targetKm < 12 ? lowVolumeTemplate : templates[level];
  const monday = currentMonday(now);
  const rawSessions: RawSession[] = Array.from({ length: 7 }, (_, day) => {
    const planned = template.find((item) => item.day === day);
    if (!planned) {
      return {
        date: addDays(monday, day),
        type: "rest",
        ratio: 0,
        km: 0,
        title: "Repos / mobilité",
        details: normalSessionDetails("rest", 0),
      };
    }
    const km = round1(targetKm * planned.ratio);
    const titles: Record<SessionType, string> = {
      rest: "Repos / mobilité",
      easy: "Endurance facile",
      interval: "Fractionné",
      tempo: "Tempo contrôlé",
      long: "Sortie longue",
    };
    return {
      date: addDays(monday, day),
      ...planned,
      km,
      title: titles[planned.type],
      details: normalSessionDetails(planned.type, km),
    };
  });
  const sessions = adaptNormalSessions(rawSessions, runs, now, targetKm);
  const expectedKm = expectedWeekKm(sessions);
  const progressionBaseKm = expectedKm > 0 ? expectedKm : targetKm;
  const growth = level === "high" ? 1.03 : level === "medium" ? 1.04 : 1.05;
  const nextWeekKm = round1(progressionBaseKm * growth);
  const followingWeekKm = round1(nextWeekKm * growth);
  const progression = [
    { label: "Cette semaine", km: targetKm },
    { label: "S+1", km: nextWeekKm },
    { label: "S+2", km: followingWeekKm },
    { label: "S+3", km: round1(followingWeekKm * 0.9) },
  ];
  const reasons = [
    `Charge 7 jours : ${round1(km7)} km • moyenne 28 jours : ${round1(chronicWeek)} km/semaine • ACR ${round1(acr)}.`,
    `Cible ${level === "high" ? "allégée" : level === "low" ? "progressive" : "stabilisée"} : ${targetKm.toFixed(1)} km.`,
    ...(targetKm < 12 ? ["Volume modéré : trois sorties faciles, sans séance intense imposée."] : []),
    "Après chaque synchronisation Strava, seules les séances à venir sont recalculées.",
  ];
  return { targetKm, level, sessions, progression, reasons };
}

function buildRehabPlan(rows: Activity[], now = new Date()) {
  const runs = getRuns(rows);
  if (runs.length === 0) {
    return {
      targetKm: 0,
      level: "high" as const,
      sessions: [] as PlannedSession[],
      progression: [] as WeekTarget[],
      reasons: ["Aucune sortie de course exploitable pour construire une semaine."],
    };
  }

  const metrics = computeTrainingLoad(rows);
  const rehab = metrics.periostitis;
  const targetKm = rehab.weeklyCapKm;
  const desiredSessionCount = rehab.sessionCount;
  const monday = currentMonday(now);
  const originalRunDays = desiredSessionCount === 2 ? [1, 5] : [1, 3, 6];
  const rawSessions: RawSession[] = Array.from({ length: 7 }, (_, index) => {
    const runPosition = originalRunDays.indexOf(index);
    if (runPosition < 0) {
      return {
        date: addDays(monday, index),
        type: "rest",
        ratio: 0,
        km: 0,
        title: "Repos / sans impact",
        details: "Repos, mobilité douce, natation ou vélo facile uniquement si totalement indolore.",
      };
    }
    const km = round1(targetKm / desiredSessionCount);
    return {
      date: addDays(monday, index),
      type: "easy",
      ratio: 1 / desiredSessionCount,
      km,
      title: runPosition === 0 ? "Course-marche test" : "Endurance très facile",
      details: `${km.toFixed(1)} km maximum, terrain plat, sans allure ni côte. Arrêt si la douleur augmente.`,
    };
  });
  const sessions = adaptRehabSessions(rawSessions, runs, now, targetKm, desiredSessionCount);
  const expectedKm = expectedWeekKm(sessions);
  const restartKm = Math.min(5, Math.max(2, metrics.chronic28AvgKm * 0.25));
  const nextWeekKm = round1((expectedKm > 0 ? expectedKm : restartKm) * 1.1);
  const followingWeekKm = round1(nextWeekKm * 1.1);
  const progression: WeekTarget[] = [
    { label: "Cette semaine", km: targetKm },
    { label: "S+1", km: nextWeekKm },
    { label: "S+2", km: followingWeekKm },
    { label: "S+3", km: round1(followingWeekKm * 0.85) },
  ];
  const reasons = [
    `Plafond calculé depuis la semaine précédente (${rehab.previousWeekKm.toFixed(1)} km) : ${targetKm.toFixed(1)} km maximum.`,
    `${desiredSessionCount} sorties maximum, séparées par au moins un jour sans course.`,
    "Les kilomètres manqués ne sont jamais rattrapés sur une autre séance.",
    "Aucun fractionné, tempo, côte ou sortie longue pendant cette phase.",
    `La proposition S+1 part des ${expectedKm.toFixed(1)} km faits ou encore planifiés, pas du plafond théorique.`,
    "Progression uniquement sans douleur pendant la course et dans les 24–48 h suivantes.",
  ];
  return { targetKm, level: "high" as const, sessions, progression, reasons };
}

function sessionToWorkout(session: PlannedSession): WorkoutExport | null {
  if (session.status !== "planned" || session.type === "rest" || session.km <= 0) return null;
  return {
    fileName: `fabrun-${localDateKey(session.date)}.tcx`,
    workoutName: `FabRun ${DAY_LONG[session.date.getDay()]} - ${session.title}`,
    steps: distanceBudgetSteps(session.title, session.km * 1000),
  };
}

function statusLabel(session: PlannedSession) {
  if (session.status === "done") return session.type === "rest" ? "Repos fait" : "Fait";
  if (session.status === "missed") return "Non fait";
  return session.type === "rest" ? "Repos" : "À faire";
}

export default function WeeklyTrainingPlanCard({
  rows,
  hasShinPain,
}: {
  rows: Activity[];
  predictions?: Predictions | null;
  hasShinPain: boolean;
}) {
  const plan = hasShinPain ? buildRehabPlan(rows) : buildNormalPlan(rows);
  const weekWorkouts = plan.sessions
    .map(sessionToWorkout)
    .filter((workout): workout is WorkoutExport => workout !== null);
  const doneKm = round1(
    plan.sessions.filter((session) => session.status === "done" && session.type !== "rest")
      .reduce((sum, session) => sum + session.km, 0)
  );
  const plannedKm = round1(
    plan.sessions.filter((session) => session.status === "planned" && session.type !== "rest")
      .reduce((sum, session) => sum + session.km, 0)
  );
  const remainingKm = round1(Math.max(0, plan.targetKm - doneKm));
  const unplannedKm = round1(Math.max(0, remainingKm - plannedKm));
  const overrunKm = round1(Math.max(0, doneKm - plan.targetKm));
  const doneWidth = plan.targetKm > 0 ? Math.min(100, (doneKm / plan.targetKm) * 100) : 0;
  const plannedWidth = plan.targetKm > 0
    ? Math.min(100 - doneWidth, (plannedKm / plan.targetKm) * 100)
    : 0;
  const plannedSessions = plan.sessions.filter(
    (session) => session.status === "planned" && session.type !== "rest"
  ).length;
  const targetLabel = hasShinPain ? "Plafond" : "Cible";

  const summary = overrunKm > 0
    ? `${targetLabel} dépassé${hasShinPain ? "" : "e"} de ${overrunKm.toFixed(1)} km : aucune course supplémentaire n'est planifiée.`
    : remainingKm <= 0.05
      ? `${targetLabel} atteint${hasShinPain ? "" : "e"} : la fin de semaine passe en récupération.`
      : `${doneKm.toFixed(1)} km déjà faits. ${plannedKm.toFixed(1)} km répartis sur ${plannedSessions} séance${plannedSessions === 1 ? "" : "s"} à venir.`;

  return (
    <section className={`weekly-plan-card ${hasShinPain ? "weekly-plan-card-rehab" : ""}`}>
      <div className="weekly-plan-head">
        <div>
          <div className="weekly-plan-title">
            Plan adaptatif {hasShinPain ? "• reprise périostite" : "• normal"}
          </div>
          <div className="weekly-plan-subtitle">Mis à jour avec les kilomètres importés depuis Strava.</div>
        </div>
        <div className="weekly-plan-target">
          {targetLabel} {plan.targetKm.toFixed(1)} km
        </div>
      </div>

      <div className={`weekly-plan-callout ${overrunKm > 0 ? "weekly-plan-callout-warning" : ""}`}>
        <strong>{summary}</strong>
        {unplannedKm > 0.05 && (
          <span>
            {unplannedKm.toFixed(1)} km restent volontairement non planifiés pour éviter un rattrapage trop concentré.
          </span>
        )}
        {hasShinPain && <span>Le plafond est une limite de sécurité, jamais une obligation à atteindre.</span>}
      </div>

      <div className="weekly-plan-overview" aria-label="Progression de la semaine">
        <div className="weekly-plan-summary-grid">
          <div><span>Déjà fait</span><strong>{doneKm.toFixed(1)} km</strong></div>
          <div><span>Planifié</span><strong>{plannedKm.toFixed(1)} km</strong></div>
          <div><span>{hasShinPain ? "Reste au plafond" : "Reste à la cible"}</span><strong>{remainingKm.toFixed(1)} km</strong></div>
          <div><span>Séances à faire</span><strong>{plannedSessions}</strong></div>
        </div>
        <div
          className="weekly-plan-progress"
          role="progressbar"
          aria-label={`${doneKm.toFixed(1)} kilomètres réalisés sur ${plan.targetKm.toFixed(1)}`}
          aria-valuemin={0}
          aria-valuemax={Math.max(plan.targetKm, 1)}
          aria-valuenow={Math.min(doneKm, plan.targetKm)}
        >
          <span className="weekly-plan-progress-done" style={{ width: `${doneWidth}%` }} />
          <span className="weekly-plan-progress-planned" style={{ width: `${plannedWidth}%` }} />
        </div>
        <div className="weekly-plan-legend" aria-label="Légende">
          <span><i className="weekly-plan-legend-done" /> Fait et importé</span>
          <span><i className="weekly-plan-legend-planned" /> Recalculé à venir</span>
          <span><i className="weekly-plan-legend-free" /> Marge non planifiée</span>
        </div>
      </div>

      {weekWorkouts.length > 0 && (
        <div className="next-session-export">
          <button
            className="next-session-export-btn"
            type="button"
            onClick={() => downloadTextFile("fabrun-semaine.tcx", buildTcxMultiple(weekWorkouts))}
          >
            Télécharger les {weekWorkouts.length} séance{weekWorkouts.length > 1 ? "s" : ""} à faire (.tcx)
          </button>
          <div className="next-session-export-hint">
            L'export contient uniquement les séances futures recalculées, jamais celles déjà réalisées.
          </div>
        </div>
      )}

      <div className="weekly-plan-grid">
        {plan.sessions.map((session, index) => (
          <article
            key={`${session.date.toISOString()}-${index}`}
            className={`weekly-plan-item weekly-plan-${session.type} weekly-plan-status-${session.status} ${
              session.isToday ? "weekly-plan-item-today" : ""
            }`}
          >
            <div className="weekly-plan-day">
              {DAY_SHORT[session.date.getDay()]} {session.date.getDate()}
              {session.isToday && <span className="weekly-plan-today-badge">Aujourd'hui</span>}
              <span className={`weekly-plan-status-badge weekly-plan-status-badge-${session.status}`}>
                {statusLabel(session)}
              </span>
            </div>
            <div className="weekly-plan-item-title">{session.title}</div>
            <div className="weekly-plan-km">{session.type === "rest" ? "—" : `${session.km.toFixed(1)} km`}</div>
            <div className="weekly-plan-detail">{session.details}</div>
          </article>
        ))}
      </div>

      <details className="weekly-plan-help">
        <summary>Comment FabRun adapte ce plan ?</summary>
        <p>
          Les kilomètres déjà courus remplacent le programme du jour. Le volume encore autorisé est réparti
          uniquement sur les séances futures, dans leur limite. Une séance manquée n'est donc pas tassée sur le week-end.
        </p>
        {hasShinPain && (
          <p>
            En reprise périostite, FabRun conserve au moins un jour sans course entre deux sorties et peut laisser une
            partie du plafond non planifiée s'il ne reste plus assez de jours sûrs.
          </p>
        )}
      </details>

      {plan.progression.length > 0 && (
        <div className="weekly-plan-projection">
          <div className="weekly-plan-projection-head">
            <strong>Projection des semaines suivantes</strong>
            <span>
              S+1 part des {round1(doneKm + plannedKm).toFixed(1)} km faits ou encore planifiés
              {hasShinPain ? ", uniquement si la reprise reste indolore." : "."}
            </span>
          </div>
          <div className="weekly-plan-ramp" aria-label="Projection des prochaines semaines">
            {plan.progression.map((week, index) => (
              <div key={`${week.label}-${index}`} className={`weekly-plan-ramp-item ${index === 0 ? "weekly-plan-ramp-current" : ""}`}>
                <div className="weekly-plan-ramp-label">{week.label}</div>
                <div className="weekly-plan-ramp-km">{week.km.toFixed(1)} km</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="weekly-plan-help weekly-plan-calculation">
        <summary>Voir pourquoi cette cible a été choisie</summary>
        <ul className="weekly-plan-notes">
          {plan.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}
        </ul>
      </details>
    </section>
  );
}
