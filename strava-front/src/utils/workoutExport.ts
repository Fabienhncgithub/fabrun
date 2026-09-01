// Shared with NextSessionCard (today's single session) and
// WeeklyTrainingPlanCard (the full week) so both export to the same TCX
// shape instead of keeping two copies of this logic in sync.

export type WorkoutStep = {
  name: string;
  durationType: "Time" | "Distance";
  durationValue: number;
  intensity: "Active" | "Resting";
};

export type WorkoutExport = {
  fileName: string;
  workoutName: string;
  steps: WorkoutStep[];
};

export function stepTime(name: string, seconds: number, intensity: WorkoutStep["intensity"]): WorkoutStep {
  return { name, durationType: "Time", durationValue: seconds, intensity };
}

export function stepDistance(name: string, meters: number, intensity: WorkoutStep["intensity"]): WorkoutStep {
  return { name, durationType: "Distance", durationValue: meters, intensity };
}

/**
 * Builds a simple run whose warm-up and cool-down are included in the stated
 * distance budget. This keeps an exported 5 km workout at 5 km instead of
 * silently adding timed running before and after the planned distance.
 */
export function distanceBudgetSteps(mainName: string, totalMeters: number): WorkoutStep[] {
  const total = Math.max(1, Math.round(totalMeters));
  const warmup = Math.min(1_000, Math.round(total * 0.2));
  const cooldown = Math.min(600, Math.round(total * 0.1));
  const main = total - warmup - cooldown;

  return [
    stepDistance("Échauffement facile", warmup, "Active"),
    stepDistance(mainName, main, "Active"),
    stepDistance("Retour au calme", cooldown, "Active"),
  ].filter((step) => step.durationValue > 0);
}

/** A complete 6 x 400 m session whose total distance is exactly 5.6 km. */
export function sixByFourHundredSteps(repSeconds: number): WorkoutStep[] {
  const repetitions = Array.from({ length: 6 }, (_, index) => [
    stepDistance(`400 m rapide (~${Math.round(repSeconds)} s) #${index + 1}`, 400, "Active"),
    stepDistance(`Récupération 200 m au trot #${index + 1}`, 200, "Resting"),
  ]).flat();

  return [
    stepDistance("Échauffement facile", 1_000, "Active"),
    ...repetitions,
    stepDistance("Retour au calme", 1_000, "Active"),
  ];
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function workoutXml(workout: { workoutName: string; steps: WorkoutStep[] }): string {
  const stepsXml = workout.steps
    .map((step, index) => {
      const duration =
        step.durationType === "Time"
          ? `<Duration xsi:type="Time_t"><Seconds>${Math.round(step.durationValue)}</Seconds></Duration>`
          : `<Duration xsi:type="Distance_t"><Meters>${Math.round(step.durationValue)}</Meters></Duration>`;

      return `
      <Step xsi:type="Step_t">
        <StepId>${index + 1}</StepId>
        <Name>${escapeXml(step.name)}</Name>
        ${duration}
        <Intensity>${step.intensity}</Intensity>
        <Target xsi:type="None_t" />
      </Step>`;
    })
    .join("");

  return `
    <Workout Sport="Running">
      <Name>${escapeXml(workout.workoutName)}</Name>${stepsXml}
      <Notes>FabRun</Notes>
    </Workout>`;
}

function tcxDocument(workoutsXml: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd" xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Workouts>${workoutsXml}
  </Workouts>
</TrainingCenterDatabase>`;
}

export function buildTcx(workout: WorkoutExport): string {
  return tcxDocument(workoutXml(workout));
}

/** One TCX document containing several workouts, for clients that support bulk workout import. */
export function buildTcxMultiple(workouts: WorkoutExport[]): string {
  return tcxDocument(workouts.map(workoutXml).join(""));
}

export function downloadTextFile(fileName: string, content: string, mime = "application/xml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
