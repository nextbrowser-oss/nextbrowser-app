import { describe, expect, it, vi } from "vitest";
import { GUIDE_DRAFT_KEY, openGuideChatDraft, saveGuideDraft, takeGuideDraft } from "./guideDraft";

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

  it("switches a Terminal project to visible Chat before opening a guided draft", () => {
    const storage = memoryStorage();
    const setTerminalChat = vi.fn();
    const setTab = vi.fn();
    const dispatch = vi.fn();

    expect(openGuideChatDraft(storage, "  Open example.com  ", {
      setTerminalChat,
      setTab,
      dispatch,
    })).toBe("Open example.com");
    expect(setTerminalChat).toHaveBeenCalledWith(false);
    expect(dispatch).toHaveBeenCalledWith("Open example.com");
    expect(setTab).toHaveBeenCalledWith("chat");
  });
});
