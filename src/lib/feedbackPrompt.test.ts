import { describe, expect, it } from "vitest";
import { markFeedbackSubmitted, shouldPromptForFeedback } from "./feedbackPrompt";

function storage(): Storage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
    get length() { return values.size; },
  };
}

describe("feedback prompt cadence", () => {
  it("asks on every fifth usable opening until the user submits feedback", () => {
    const local = storage();
    expect(Array.from({ length: 10 }, () => shouldPromptForFeedback(local))).toEqual([
      false, false, false, false, true,
      false, false, false, false, true,
    ]);
  });

  it("never prompts again after a successful submission, including legacy submissions", () => {
    const local = storage();
    markFeedbackSubmitted(local, 1_000_000);
    expect(Array.from({ length: 100 }, () => shouldPromptForFeedback(local))).toEqual(Array(100).fill(false));
    expect(JSON.parse(local.getItem("nextbrowser.feedbackPrompt.v1")!).submittedAt).toBe(1_000_000);
  });
});
