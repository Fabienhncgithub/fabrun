import { formatClock, formatPace, formatPaceRange, midPace, type PaceRange, type PaceZones } from "./paces";
import type { Phase } from "./racePhase";
import { distanceBudgetSteps, stepDistance, type WorkoutStep } from "./workoutExport";

export type WorkoutType = "easy" | "long" | "tempo" | "interval";

export type SessionWorkout = {
  /** One-sentence summary, e.g. "6 × 800 m en 3:44 (4:40/km), récup 400 m au trot". */
  headline: string;
  /** Target pace shown next to the session title. */
  paceLabel: string | null;
  lines: { label: string; text: string }[];
  steps: WorkoutStep[];
  estimatedMinutes: number | null;
};

export type WorkoutContext = {
  paces: PaceZones | null;
  phase?: Phase | null;
  goalPace?: number | null;
  goalKm?: number | null;
  /** Used to alternate interval formats from one week to the next. */
  weekIndex?: number;
};

const kmFormatter = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const km = (value: number) => `${kmFormatter.format(Math.round(value * 10) / 10)} km`;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const half = (value: number) => Math.round(value * 2) / 2;

function minutes(parts: [number, number | null][]) {
  if (parts.some(([, pace]) => pace == null)) return null;
  return Math.round(parts.reduce((sum, [distance, pace]) => sum + distance * pace!, 0) / 60);
}

function easyWorkout(distance: number, zone: PaceRange | null, label: string): SessionWorkout {
  return {
    headline: zone ? `${km(distance)} à ${formatPaceRange(zone)}, en aisance respiratoire.` : `${km(distance)} faciles, respiration aisée.`,
    paceLabel: zone ? formatPaceRange(zone) : null,
    lines: [
      { label: "Allure", text: zone ? `${formatPaceRange(zone)} — tu dois pouvoir parler en phrases complètes.` : "Facile : tu dois pouvoir parler en phrases complètes." },
    ],
    steps: distanceBudgetSteps(zone ? `${label} ${formatPaceRange(zone)}` : label, distance * 1000),
    estimatedMinutes: minutes([[distance, zone ? midPace(zone) : null]]),
  };
}

function longWorkout(distance: number, context: WorkoutContext): SessionWorkout {
  const zone = context.paces?.long ?? null;
  const base = easyWorkout(distance, zone, "Sortie longue");
  const finishKm = context.phase === "specific" && (context.goalKm ?? 0) >= 15 && context.goalPace && distance >= 10
    ? Math.round(distance * 0.25) : 0;
  if (!finishKm || !zone) {
    return { ...base, headline: zone ? `${km(distance)} à ${formatPaceRange(zone)}, régulier, sans forcer.` : `${km(distance)} en endurance régulière, sans forcer.` };
  }
  const goal = context.goalPace!;
  const steady = distance - finishKm;
  return {
    headline: `${km(distance)} dont les ${finishKm} derniers km à allure objectif (${formatPace(goal)}/km).`,
    paceLabel: formatPaceRange(zone),
    lines: [
      { label: "Endurance", text: `${km(steady)} à ${formatPaceRange(zone)}.` },
      { label: "Final", text: `${finishKm} km à ${formatPace(goal)}/km, ton allure de course.` },
    ],
    steps: [
      stepDistance(`Endurance ${formatPaceRange(zone)}`, Math.round(steady * 1000), "Active"),
      stepDistance(`Allure objectif ${formatPace(goal)}/km`, finishKm * 1000, "Active"),
    ],
    estimatedMinutes: minutes([[steady, midPace(zone)], [finishKm, goal]]),
  };
}

function intervalWorkout(distance: number, context: WorkoutContext): SessionWorkout {
  const { paces, phase, goalPace, goalKm } = context;
  const warmup = distance < 7 ? 1 : 1.5;
  const budget = Math.max(0, distance - warmup - 1);
  const short = phase === "base" || phase === "taper" || budget < 3.6
    || (phase == null && (context.weekIndex ?? 0) % 2 === 0);
  const format = short
    ? { rep: 0.4, jog: 0.2, max: phase === "taper" ? 5 : 10, min: 4, zone: paces?.repetition ?? null, name: "400 m" }
    : phase === "specific"
      ? { rep: 1, jog: 0.4, max: 6, min: 3, zone: paces?.interval ?? null, name: "1 000 m" }
      : { rep: 0.8, jog: 0.4, max: 6, min: 3, zone: paces?.interval ?? null, name: "800 m" };
  const atGoalPace = phase === "specific" && !short && goalPace != null && (goalKm ?? 99) <= 10.5;
  const pace = atGoalPace ? goalPace! : format.zone ? midPace(format.zone) : null;
  const reps = clamp(Math.floor(budget / (format.rep + format.jog)), format.min, format.max);
  const cooldown = Math.max(0.5, distance - warmup - reps * (format.rep + format.jog));
  const target = pace == null
    ? "à ton allure 5 km"
    : `en ${formatClock(pace * format.rep)} (${formatPace(pace)}/km${atGoalPace ? ", allure objectif" : ""})`;
  const recovery = `${Math.round(format.jog * 1000)} m au trot`;
  const easy = paces?.easy ?? null;
  return {
    headline: `${reps} × ${format.name} ${target}, récup ${recovery}.`,
    paceLabel: pace == null ? null : `${formatPace(pace)}/km`,
    lines: [
      { label: "Échauffement", text: `${km(warmup)} facile${easy ? ` (${formatPaceRange(easy)})` : ""}, puis 3 lignes droites.` },
      { label: "Séance", text: `${reps} × ${format.name} ${target}. Récupération : ${recovery}.` },
      { label: "Retour au calme", text: `${km(cooldown)} très facile.` },
    ],
    steps: [
      stepDistance("Échauffement facile", Math.round(warmup * 1000), "Active"),
      ...Array.from({ length: reps }, (_, index) => [
        stepDistance(`${format.name}${pace == null ? "" : ` ${formatPace(pace)}/km`} #${index + 1}`, format.rep * 1000, "Active"),
        stepDistance(`Récupération trot #${index + 1}`, format.jog * 1000, "Resting"),
      ]).flat(),
      stepDistance("Retour au calme", Math.round(cooldown * 1000), "Active"),
    ],
    estimatedMinutes: minutes([
      [warmup + cooldown + reps * format.jog, easy ? easy.slow : null],
      [reps * format.rep, pace],
    ]),
  };
}

function tempoWorkout(distance: number, context: WorkoutContext): SessionWorkout {
  const { paces, phase, goalPace, goalKm } = context;
  const warmup = distance < 7 ? 1 : 1.5;
  const atGoalPace = phase === "specific" && goalPace != null && (goalKm ?? 0) >= 15;
  const maxBlock = phase === "taper" ? 3 : phase === "base" ? 4 : 8;
  const tempoKm = half(clamp(distance - warmup - 1, 2, maxBlock));
  const blocks = tempoKm >= 5 ? 2 : 1;
  const blockKm = half(tempoKm / blocks);
  const jog = blocks > 1 ? 0.4 : 0;
  const cooldown = Math.max(0.5, distance - warmup - blocks * blockKm - jog);
  const zone = paces?.tempo ?? null;
  const pace = atGoalPace ? goalPace! : zone ? midPace(zone) : null;
  const target = atGoalPace
    ? `à allure objectif (${formatPace(goalPace!)}/km)`
    : zone ? `au seuil (${formatPaceRange(zone)})` : "à allure soutenue mais contrôlée";
  const body = blocks > 1 ? `2 × ${km(blockKm)} ${target}, récup 400 m au trot` : `${km(blockKm)} ${target}`;
  const easy = paces?.easy ?? null;
  return {
    headline: `${body}.`,
    paceLabel: atGoalPace ? `${formatPace(goalPace!)}/km` : zone ? formatPaceRange(zone) : null,
    lines: [
      { label: "Échauffement", text: `${km(warmup)} facile${easy ? ` (${formatPaceRange(easy)})` : ""}.` },
      { label: "Séance", text: `${body}. Effort soutenu : quelques mots possibles, pas une conversation.` },
      { label: "Retour au calme", text: `${km(cooldown)} très facile.` },
    ],
    steps: [
      stepDistance("Échauffement facile", Math.round(warmup * 1000), "Active"),
      ...Array.from({ length: blocks }, (_, index) => [
        stepDistance(`${atGoalPace ? "Allure objectif" : "Seuil"}${pace == null ? "" : ` ${formatPace(pace)}/km`} #${index + 1}`, blockKm * 1000, "Active"),
        ...(index < blocks - 1 ? [stepDistance("Récupération trot", 400, "Resting")] : []),
      ]).flat(),
      stepDistance("Retour au calme", Math.round(cooldown * 1000), "Active"),
    ],
    estimatedMinutes: minutes([
      [warmup + cooldown + jog, easy ? easy.slow : null],
      [blocks * blockKm, pace],
    ]),
  };
}

export function buildSessionWorkout(type: WorkoutType, distanceKm: number, context: WorkoutContext): SessionWorkout {
  if (type === "interval") return intervalWorkout(distanceKm, context);
  if (type === "tempo") return tempoWorkout(distanceKm, context);
  if (type === "long") return longWorkout(distanceKm, context);
  return easyWorkout(distanceKm, context.paces?.easy ?? null, "Endurance");
}
