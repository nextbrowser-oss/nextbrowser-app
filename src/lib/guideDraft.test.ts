import { describe, expect, it } from "vitest";
import { GUIDE_DRAFT_KEY, saveGuideDraft, takeGuideDraft } from "./guideDraft";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    values,
  };
}

describe("Guide chat drafts", () => {
  it("stages a trimmed example without sending it", () => {
    const storage = memoryStorage();

    expect(saveGuideDraft(storage, "  Check the page  ")).toBe("Check the page");
    expect(storage.values.get(GUIDE_DRAFT_KEY)).toBe("Check the page");
  });

  it("consumes a staged example once", () => {
    const storage = memoryStorage();
    saveGuideDraft(storage, "Check the page");

    expect(takeGuideDraft(storage)).toBe("Check the page");
    expect(takeGuideDraft(storage)).toBeUndefined();
  });
});
