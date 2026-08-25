import { describe, expect, it } from "vitest";
import { entityNameLimits, validateEntityName } from "./entityValidation";

describe("entity name validation", () => {
  it("trims valid names", () => {
    expect(validateEntityName("workspace", "  Research  ")).toBe("Research");
  });

  it.each(["workspace", "project", "profile"] as const)("reports the visible %s limit", (kind) => {
    expect(() => validateEntityName(kind, "x".repeat(entityNameLimits[kind] + 1)))
      .toThrow(`maximum ${entityNameLimits[kind]} characters`);
  });
});
