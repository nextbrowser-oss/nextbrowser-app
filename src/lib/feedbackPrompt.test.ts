import { describe, expect, it } from "vitest";
import { feedbackPromptConfig, markFeedbackSubmitted, shouldPromptForFeedback } from "./feedbackPrompt";

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

  it("suppresses prompts for three months after a successful submission then starts a new five-open cycle", () => {
    const local = storage();
    const submittedAt = 1_000_000;
    markFeedbackSubmitted(local, submittedAt);
    expect(shouldPromptForFeedback(local, submittedAt + feedbackPromptConfig.cooldownMs - 1)).toBe(false);
    expect(Array.from({ length: 5 }, (_, index) => shouldPromptForFeedback(local, submittedAt + feedbackPromptConfig.cooldownMs + index))).toEqual([
      false, false, false, false, true,
    ]);
  });
});
