// Periodisation towards the next goal race: which phase this calendar week
// belongs to, counted backwards from race week.

export type GoalLike = { id?: string; label: string; distanceKm: number; targetDate: string };
export type Phase = "base" | "build" | "specific" | "taper" | "race-week";

export type RacePlan = {
  goal: GoalLike;
  daysToRace: number;
  weeksToRace: number;
  phase: Phase;
  phaseLabel: string;
  focus: string;
  /** Multiplier applied to the weekly volume reference (1 = unchanged). */
  volumeFactor: number;
  recoveryWeek: boolean;
  previousWeekWasRecovery: boolean;
  goalPace: number | null;
  timeline: { phase: Phase; label: string; weeks: number; current: boolean }[];
};

const PHASE_LABEL: Record<Phase, string> = {
  base: "Base",
  build: "Développement",
  specific: "Spécifique",
  taper: "Affûtage",
  "race-week": "Semaine de course",
};

const PHASE_FOCUS: Record<Phase, string> = {
  base: "Construire le volume en endurance, avec un peu de vitesse courte pour garder du rythme.",
  build: "Développer la VMA et le seuil : une séance de fractionné et un tempo par semaine.",
  specific: "Travailler à l’allure de course et allonger la sortie longue.",
  taper: "Réduire le volume en gardant un peu d’intensité pour arriver frais.",
  "race-week": "Arriver reposé : très peu de volume, un déblocage, puis la course.",
};

function monday(date: Date) {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = copy.getDay();
  copy.setDate(copy.getDate() + (day === 0 ? -6 : 1 - day));
  return copy;
}

export function parseGoalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The soonest goal that has not happened yet. */
export function nextGoal<T extends GoalLike>(goals: T[] | null | undefined, now = new Date()): T | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return (goals ?? [])
    .map(goal => ({ goal, date: parseGoalDate(goal.targetDate) }))
    .filter((item): item is { goal: T; date: Date } => item.date != null && item.date.getTime() >= today && item.goal.distanceKm > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime())[0]?.goal ?? null;
}

function phaseLengths(distanceKm: number) {
  if (distanceKm >= 30) return { taper: 2, specific: 6, build: 6 };
  if (distanceKm >= 15) return { taper: 1, specific: 5, build: 4 };
  return { taper: 0, specific: 4, build: 4 };
}

function phaseAt(weeksToRace: number, lengths: ReturnType<typeof phaseLengths>): Phase {
  if (weeksToRace <= 0) return "race-week";
  if (weeksToRace <= lengths.taper) return "taper";
  if (weeksToRace <= lengths.taper + lengths.specific) return "specific";
  if (weeksToRace <= lengths.taper + lengths.specific + lengths.build) return "build";
  return "base";
}

export function racePlan(goal: GoalLike, now = new Date(), goalPace: number | null = null): RacePlan | null {
  const raceDate = parseGoalDate(goal.targetDate);
  if (!raceDate) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const daysToRace = Math.round((raceDate.getTime() - today.getTime()) / 86_400_000);
  if (daysToRace < 0) return null;
  const weeksToRace = Math.round((monday(raceDate).getTime() - monday(now).getTime()) / (7 * 86_400_000));
  const lengths = phaseLengths(goal.distanceKm);
  const phase = phaseAt(weeksToRace, lengths);
  // Every fourth week before the taper is lighter so the load can be absorbed.
  const isRecovery = (weeks: number) => {
    const current = phaseAt(weeks, lengths);
    return current !== "taper" && current !== "race-week" && (weeks - lengths.taper) % 4 === 0;
  };
  const recoveryWeek = isRecovery(weeksToRace);
  const volumeFactor = phase === "race-week" ? 0.5
    : phase === "taper" ? (weeksToRace === 1 ? 0.7 : 0.85)
    : recoveryWeek ? 0.8 : 1;
  const baseWeeks = Math.max(0, weeksToRace - lengths.taper - lengths.specific - lengths.build);
  const timeline = ([
    ["base", baseWeeks],
    ["build", Math.min(lengths.build, Math.max(0, weeksToRace - lengths.taper - lengths.specific))],
    ["specific", Math.min(lengths.specific, Math.max(0, weeksToRace - lengths.taper))],
    ["taper", Math.min(lengths.taper, Math.max(0, weeksToRace))],
    ["race-week", 1],
  ] as [Phase, number][])
    .filter(([, weeks]) => weeks > 0)
    .map(([key, weeks]) => ({ phase: key, label: PHASE_LABEL[key], weeks, current: key === phase }));
  return {
    goal, daysToRace, weeksToRace, phase,
    phaseLabel: recoveryWeek ? `${PHASE_LABEL[phase]} · semaine allégée` : PHASE_LABEL[phase],
    focus: recoveryWeek ? "Semaine allégée : −20 % de volume pour assimiler les trois semaines précédentes." : PHASE_FOCUS[phase],
    volumeFactor, recoveryWeek,
    previousWeekWasRecovery: isRecovery(weeksToRace + 1),
    goalPace, timeline,
  };
}
