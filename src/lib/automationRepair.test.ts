import { describe, expect, it } from "vitest";
import { shouldAutoRepairAutomation } from "./automationRepair";

describe("automatic automation repair", () => {
  it("repairs saved page selectors and extraction scripts automatically", () => {
    expect(shouldAutoRepairAutomation("click", "No element matches the saved locator")).toBe(true);
    expect(shouldAutoRepairAutomation("evaluate", "Expected 5 populated trending rows")).toBe(true);
    expect(shouldAutoRepairAutomation("paginate_extract", "The saved extraction returned only empty rows")).toBe(true);
  });

  it("does not spend an AI run on infrastructure or user-controlled failures", () => {
    expect(shouldAutoRepairAutomation("evaluate", "Project sync failed (401). The account token is invalid")).toBe(false);
    expect(shouldAutoRepairAutomation("click", "Profile Worker session is missing")).toBe(false);
    expect(shouldAutoRepairAutomation("wait", "Automation execution was cancelled")).toBe(false);
    expect(shouldAutoRepairAutomation("open", "No element matches")).toBe(false);
    expect(shouldAutoRepairAutomation("save_artifact", "Artifact storage failed")).toBe(false);
  });
});
