import type { GarminRecovery } from "../api";
import { addDays, localDateKey } from "./dateBuckets";
import type { GenevaForecast } from "./genevaWeather";
import { paceZones, racePace, type PaceZones } from "./paces";
import { nextGoal, racePlan, type GoalLike, type RacePlan } from "./racePhase";
import { computeReadiness, type Readiness } from "./readiness";
import { analyzeRecentRuns, type FeedbackActivity, type SessionFeedback } from "./sessionFeedback";
import { computeTrainingLoad } from "./trainingLoad";
import { buildNormalPlan, buildRehabPlan, type PlanActivity, type PlannedSession } from "./weeklyPlan";

type Predictions = Parameters<typeof paceZones>[0];

export type CoachInput = {
  rows: (PlanActivity & FeedbackActivity)[];
  predictions?: Predictions;
  hasShinPain: boolean;
  goalRaces?: GoalLike[] | null;
  recovery?: GarminRecovery | null;
  weather?: GenevaForecast | null;
  weatherError?: boolean;
  now?: Date;
};

export type Coach = {
  plan: ReturnType<typeof buildNormalPlan>;
  /** Same plan without the weather, to tell which sessions the rain moved. */
  basePlan: ReturnType<typeof buildNormalPlan>;
  today: PlannedSession | undefined;
  paces: PaceZones | null;
  race: RacePlan | null;
  readiness: Readiness;
  feedback: SessionFeedback;
  weather: GenevaForecast | null;
  weatherError: boolean;
};

/** One consistent view of the week for every training card: plan, paces, goal phase, recovery and weather. */
export function buildCoach(input: CoachInput): Coach {
  const now = input.now ?? new Date();
  const { rows, hasShinPain } = input;
  const feedback = analyzeRecentRuns(rows, paceZones(input.predictions), now);
  const paces = paceZones(input.predictions, feedback.adjustmentPct);
  const goal = nextGoal(input.goalRaces, now);
  const race = goal ? racePlan(goal, now, racePace(input.predictions, goal.distanceKm)) : null;
  const readiness = computeReadiness(input.recovery, localDateKey(now), computeTrainingLoad(rows, now).acr);
  const yesterday = feedback.byDay.get(localDateKey(addDays(now, -1)));
  const planCoach = { paces, race, readiness, hardYesterday: yesterday?.kind === "quality" };
  const build = hasShinPain ? buildRehabPlan : buildNormalPlan;
  const plan = build(rows, now, input.weather?.rainyDays, planCoach);
  return {
    plan,
    basePlan: build(rows, now, undefined, planCoach),
    today: plan.sessions.find(session => session.isToday),
    paces, race, readiness, feedback,
    weather: input.weather ?? null,
    weatherError: input.weatherError ?? false,
  };
}
