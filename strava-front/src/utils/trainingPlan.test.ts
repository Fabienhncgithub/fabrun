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
});
