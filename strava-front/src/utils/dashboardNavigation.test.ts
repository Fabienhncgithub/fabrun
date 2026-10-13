import { describe, expect, it } from "vitest";
import { dashboardPageFromHash, dashboardPages } from "./dashboardNavigation";

describe("dashboard navigation", () => {
  it("keeps links to today's advice, the weekly plan and shoes working", () => {
    expect(dashboardPageFromHash("#plan-semaine")).toBe("entrainement");
    expect(dashboardPageFromHash("#aujourdhui")).toBe("entrainement");
    expect(dashboardPageFromHash("#chaussures")).toBe("equipement");
  });
  it("opens each destination and falls back to training for unknown links", () => {
    for (const page of dashboardPages) expect(dashboardPageFromHash(`#${page.id}`)).toBe(page.id);
    expect(dashboardPageFromHash("")).toBe("entrainement");
    expect(dashboardPageFromHash("#obsolete")).toBe("entrainement");
  });
});
