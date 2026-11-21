import { describe, expect, it } from "vitest";
import { buildTcx, distanceBudgetSteps, sixByFourHundredSteps } from "./workoutExport";

const totalDistance = (steps: ReturnType<typeof distanceBudgetSteps>) =>
  steps.reduce(
    (sum, step) => sum + (step.durationType === "Distance" ? step.durationValue : 0),
    0
  );

describe("workout exports", () => {
  it("includes warm-up and cool-down inside the announced distance", () => {
    const steps = distanceBudgetSteps("Endurance", 5_000);

    expect(totalDistance(steps)).toBe(5_000);
    expect(steps.every((step) => step.durationType === "Distance")).toBe(true);
  });

  it("keeps the 6 x 400 m workout within its 5.6 km budget", () => {
    const steps = sixByFourHundredSteps(96);

    expect(totalDistance(steps)).toBe(5_600);
  });

  it("escapes workout names in TCX output", () => {
    const xml = buildTcx({
      fileName: "test.tcx",
      workoutName: "Tempo & contrôle",
      steps: distanceBudgetSteps("Bloc <tempo>", 3_000),
    });

    expect(xml).toContain("Tempo &amp; contrôle");
    expect(xml).toContain("Bloc &lt;tempo&gt;");
  });
});
