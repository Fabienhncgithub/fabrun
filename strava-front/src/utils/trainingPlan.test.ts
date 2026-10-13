import { describe, expect, it } from "vitest";
import { computeNormalWeekTarget } from "./trainingPlan";

describe("computeNormalWeekTarget", () => {
  it("requires at least three recent runs", () => {
    const result = computeNormalWeekTarget(6, 24, 2);

    expect(result.hasEnoughData).toBe(false);
    expect(result.targetKm).toBe(0);
  });

  it("does not impose a 10 km floor on a low-volume runner", () => {
    const result = computeNormalWeekTarget(2, 8, 4);

    expect(result.hasEnoughData).toBe(true);
    expect(result.targetKm).toBeLessThanOrEqual(2.2);
  });

  it("progresses a low acute load conservatively from the chronic baseline", () => {
    const result = computeNormalWeekTarget(4, 40, 8);

    expect(result.level).toBe("low");
    expect(result.targetKm).toBe(10.4);
  });

  it("reduces a high acute load instead of adding more volume", () => {
    const result = computeNormalWeekTarget(20, 40, 8);

    expect(result.level).toBe("high");
    expect(result.targetKm).toBe(18);
  });
  it("uses previous calendar week +10% as the normal reference when supplied", () => {
    const result = computeNormalWeekTarget(25.2, 68, 14, 20.9);
    expect(result.targetKm).toBe(23);
    expect(result.level).toBe("high"); // high recent load changes intensity, not the weekly reference
  });

  it("restarts gently after a completed week without running", () => {
    expect(computeNormalWeekTarget(0, 80, 8, 0).targetKm).toBe(5);
  });

});
