import { computeTrainingLoad } from "./trainingLoad";
import { computeNormalWeekTarget } from "./trainingPlan";
import { parseStravaLocalDate } from "./dateBuckets";
export type PlanActivity = {
  sport_type: string;
  distance: number;
  moving_time?: number;
  start_date_local: string;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
};

type SessionType = "rest" | "easy" | "tempo" | "interval" | "long";
type SessionStatus = "done" | "missed" | "planned";

export type PlannedSession = {
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

type DatedRun = PlanActivity & { date: Date };
type RawSession = Omit<PlannedSession, "status" | "isToday">;
type AllocationSlot = { index: number; weight: number; capKm: number };

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

const kmFormatter = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function formatKm(km: number) {
  return kmFormatter.format(km);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function floor1(value: number) {
  return Math.floor((value + 1e-9) * 10) / 10;
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

function getRuns(rows: PlanActivity[]): DatedRun[] {
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
  if (type === "easy") return `${formatKm(km)} km faciles, respiration aisée.`;
  if (type === "interval") return `${formatKm(km)} km au total avec fractionné court et récupération au trot.`;
  if (type === "tempo") return `${formatKm(km)} km dont 15–20 min soutenues mais contrôlées.`;
  if (type === "long") return `${formatKm(km)} km en endurance régulière, sans forcer.`;
  return "Repos complet ou 20 min de mobilité/renforcement léger.";
}

function completedSession(base: RawSession, actualKm: number, isToday: boolean): PlannedSession {
  const plannedNote = base.type === "rest" ? "" : ` • plan initial ${formatKm(base.km)} km`;
  return {
    ...base,
    type: base.type === "rest" ? "easy" : base.type,
    km: round1(actualKm),
    title: "Course réalisée",
    details: `Import Strava : ${formatKm(round1(actualKm))} km${plannedNote}. Le reste de la semaine est recalculé.`,
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
  let remainingKm = Math.max(0, targetKm - actualWeekKm);
  const projectedRows: PlanActivity[] = [...runs];

  return sessions.map((session, index): PlannedSession => {
    const day = startOfDay(session.date);
    const isToday = day.getTime() === today.getTime();
    const actualKm = actuals.get(localDateKey(session.date)) ?? 0;
    if (actualKm > 0.05) return completedSession(session, actualKm, isToday);
    if (day < today) return pastSession(session);

    // Recalculate the remaining volume on usable future dates. A blocked
    // date is removed before allocating, so its kilometres do not disappear.
    const slots: AllocationSlot[] = sessions.flatMap((candidate, candidateIndex) => {
      const candidateDay = startOfDay(candidate.date);
      const hasActual = (actuals.get(localDateKey(candidate.date)) ?? 0) > 0.05;
      if (candidateIndex < index || candidateDay < today || hasActual || candidate.type === "rest") return [];
      const daily = computeTrainingLoad(projectedRows, candidateDay.getTime() === today.getTime() ? now : candidate.date);
      return daily.remainingNow >= 0.5 ? [{ index: candidateIndex, weight: Math.max(candidate.ratio, 0.1), capKm: daily.remainingNow }] : [];
    });
    const allocations = allocateDistance(remainingKm, slots);
    const allocatedKm = allocations.get(index) ?? 0;
    const metrics = computeTrainingLoad(projectedRows, isToday ? now : session.date);
    const acceptedKm = floor1(Math.min(allocatedKm, metrics.remainingNow, remainingKm));
    if (acceptedKm >= 0.5) {
      const type = (session.type === "interval" || session.type === "tempo") && acceptedKm < 5.6
        ? "easy"
        : session.type;
      remainingKm = Math.max(0, remainingKm - acceptedKm);
      projectedRows.push({
        sport_type: "Run",
        distance: acceptedKm * 1000,
        moving_time: Math.round(acceptedKm * 360),
        start_date_local: `${localDateKey(session.date)}T08:00:00`,
      });
      return {
        ...session,
        type,
        title: type === "easy" && session.type !== "easy" ? "Endurance facile" : session.title,
        km: acceptedKm,
        details: normalSessionDetails(type, acceptedKm),
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
          : allocatedKm >= 0.5 && acceptedKm < 0.5
            ? "La charge du jour ne permet pas de proposer une course. Le volume restant est réévalué sur les créneaux suivants, sans dépasser leurs limites."
          : "Séance retirée pour ne pas concentrer les kilomètres manqués en fin de semaine.",
        status: "planned",
        isToday,
      };
    }

    return { ...session, status: "planned", isToday };
  });
}

function expectedWeekKm(sessions: PlannedSession[]) {
  return round1(
    sessions
      .filter((session) => session.type !== "rest" && session.status !== "missed")
      .reduce((sum, session) => sum + session.km, 0)
  );
}

export function buildNormalPlan(rows: PlanActivity[], now = new Date(), rainyDays: ReadonlySet<string> = new Set()) {
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

  const metrics = computeTrainingLoad(rows, now);
  const windowStartKey = localDateKey(addDays(now, -27));
  const todayKey = localDateKey(now);
  const runCount28 = runs.filter((run) => {
    const key = localDateKey(run.date);
    return key >= windowStartKey && key <= todayKey;
  }).length;
  const km7 = metrics.acute7Km;
  const km28 = metrics.chronic28AvgKm * 4;
  const target = computeNormalWeekTarget(km7, km28, runCount28, metrics.weeklyRamp.previousWeekKm);
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
      { day: 6, type: "easy", ratio: 0.4 },
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
  // Move only future template sessions, then recalculate all load limits in date order.
  const actuals = actualKmByDay(rawSessions, runs);
  const today = startOfDay(now);
  for (let index = 0; index < rawSessions.length; index++) {
    const session = rawSessions[index];
    if (session.type === "rest" || session.date < today || !rainyDays.has(localDateKey(session.date)) || actuals.has(localDateKey(session.date))) continue;
    const alternatives = rawSessions.map((candidate, i) => ({ candidate, i }))
      .filter(({ candidate }) => candidate.type === "rest" && candidate.date >= today && !rainyDays.has(localDateKey(candidate.date)) && !actuals.has(localDateKey(candidate.date)))
      .sort((a, b) => Math.abs(a.i - index) - Math.abs(b.i - index) || a.i - b.i);
    const replacement = alternatives[0];
    const rest = replacement?.candidate ?? { ...session, type: "rest" as const, ratio: 0, km: 0 };
    if (replacement) rawSessions[replacement.i] = { ...session, date: replacement.candidate.date };
    rawSessions[index] = { ...rest, date: session.date, title: "Repos · forte pluie", details: "Forte pluie prévue à Genève : séance déplacée si un autre jour et la charge le permettent." };
  }
  const sessions = adaptNormalSessions(rawSessions, runs, now, targetKm);
  const expectedKm = expectedWeekKm(sessions);
  const progressionBaseKm = expectedKm > 0 ? expectedKm : targetKm;
  const growth = level === "high" ? 1.03 : level === "medium" ? 1.04 : 1.05;
  const nextWeekKm = round1(progressionBaseKm * growth);
  const followingWeekKm = round1(nextWeekKm * growth);
  const progression = [
    { label: "Cette semaine", km: expectedKm },
    { label: "S+1", km: nextWeekKm },
    { label: "S+2", km: followingWeekKm },
    { label: "S+3", km: round1(followingWeekKm * 0.9) },
  ];
  const reasons = [
    `Charge 7 jours : ${formatKm(km7)} km • moyenne 28 jours : ${formatKm(chronicWeek)} km/semaine • ACR ${formatKm(acr)}.`,
    metrics.weeklyRamp.previousWeekKm > 0
      ? `Référence hebdomadaire : ${formatKm(metrics.weeklyRamp.previousWeekKm)} km la semaine précédente +10 % = ${formatKm(targetKm)} km.`
      : `Après une semaine sans course, référence de redémarrage limitée à ${formatKm(targetKm)} km.`,
    "L’ACR adapte l’intensité ; le volume normal suit la référence hebdomadaire, avec repos si la fatigue récente le demande.",
    ...(targetKm < 12 ? ["Volume modéré : trois sorties faciles, sans séance intense imposée."] : []),
    "Les kilomètres restants sont répartis à nouveau sur les créneaux utilisables, dans la limite de chaque séance. Aucun reliquat n’est concentré sur une seule sortie.",
    "Après chaque synchronisation Strava, seules les séances à venir sont recalculées.",
  ];
  return { targetKm, level, sessions, progression, reasons };
}

export function buildRehabPlan(rows: PlanActivity[], now = new Date(), rainyDays: ReadonlySet<string> = new Set()) {
  const normalPlan = buildNormalPlan(rows, now, rainyDays);
  if (normalPlan.sessions.length === 0) return normalPlan;

  const metrics = computeTrainingLoad(rows, now);
  const rehab = metrics.periostitis;
  const targetKm = Math.min(normalPlan.targetKm, rehab.weeklyCapKm);
  const runs = getRuns(rows);
  const actuals = actualKmByDay(normalPlan.sessions, runs);
  const actualWeekKm = Array.from(actuals.values()).reduce((sum, km) => sum + km, 0);
  const actualRunDays = Array.from(actuals.values()).filter((km) => km > 0.05).length;
  let remainingKm = Math.max(0, targetKm - actualWeekKm);
  let remainingSessions = Math.max(0, rehab.sessionCount - actualRunDays);
  const projectedRows: PlanActivity[] = [...rows];

  // Pain mode restricts accepted normal sessions. It never adds a session,
  // enlarges one, or moves removed kilometres onto a different day.
  const sessions = normalPlan.sessions.map((session): PlannedSession => {
    if (session.status !== "planned") return session;
    const daily = computeTrainingLoad(projectedRows, session.isToday ? now : session.date);
    const km = session.type === "rest" || remainingSessions === 0
      ? 0
      : floor1(Math.min(session.km * 0.5, daily.periostitis.remainingTodayKm, remainingKm));
    if (km >= 0.5) {
      projectedRows.push({
        sport_type: "Run", distance: km * 1000, moving_time: Math.round(km * 360),
        start_date_local: `${localDateKey(session.date)}T08:00:00`,
      });
      remainingKm = Math.max(0, remainingKm - km);
      remainingSessions--;
      return {
        ...session, type: "easy", km, ratio: targetKm > 0 ? km / targetKm : 0,
        title: "Course-marche très facile",
        details: `${formatKm(km)} km maximum, uniquement sans douleur, sur terrain plat. Arrêt si la douleur apparaît ou augmente.`,
      };
    }
    return {
      ...session, type: "rest", km: 0, ratio: 0, title: "Repos / sans impact",
      details: daily.periostitis.ranYesterday
        ? "Au moins une journée sans course après la sortie précédente."
        : "Séance retirée en mode prudent. Les kilomètres ne sont pas reportés sur les autres jours.",
    };
  });
  const expectedKm = expectedWeekKm(sessions);
  const normalExpectedKm = expectedWeekKm(normalPlan.sessions);
  const progression: WeekTarget[] = normalPlan.progression.map((week, index) => ({
    label: week.label,
    km: index === 0 ? expectedKm : normalExpectedKm > 0
      ? floor1(Math.min(week.km, week.km * expectedKm / normalExpectedKm))
      : 0,
  }));
  const reasons = [
    `Même base que le mode normal : ${formatKm(normalPlan.targetKm)} km de référence, avec un plafond de reprise réduit à ${formatKm(rehab.weeklyCapKm)} km (50 % de la semaine de référence).`,
    `${rehab.sessionCount} jours de course maximum cette semaine, sorties importées comprises, avec au moins une journée sans course entre deux sorties.`,
    "Chaque séance est réduite de moitié par rapport au mode normal, puis limitée par la charge récente et le budget de reprise restant.",
    "Aucun kilomètre retiré n’est redistribué. Aucun fractionné, tempo, côte ni sortie longue.",
    "Le volume prévu correspond aux sorties importées et aux séances réellement proposées, pas au repère théorique.",
    "Séances et projections conditionnelles : uniquement si la reprise reste indolore.",
  ];
  return { targetKm, level: "high" as const, sessions, progression, reasons };
}
