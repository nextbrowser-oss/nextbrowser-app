import { describe, expect, it } from "vitest";
import { shouldDismissProfileActionsMenu } from "./profileActionsMenu";

describe("profile actions menu keyboard behavior", () => {
  it("dismisses only on Escape", () => {
    expect(shouldDismissProfileActionsMenu({ key: "Escape" })).toBe(true);
    expect(shouldDismissProfileActionsMenu({ key: "Enter" })).toBe(false);
  });
});
