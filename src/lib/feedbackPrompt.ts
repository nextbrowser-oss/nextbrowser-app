const STATE_KEY = "nextbrowser.feedbackPrompt.v1";
const PROMPT_EVERY_OPENS = 5;

interface FeedbackPromptState {
  opens: number;
  submittedAt?: number;
}

function load(storage: Storage): FeedbackPromptState {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STATE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object") return { opens: 0 };
    const value = parsed as Partial<FeedbackPromptState>;
    return {
      opens: Number.isInteger(value.opens) && value.opens! >= 0 ? value.opens! : 0,
      ...(Number.isFinite(value.submittedAt) && value.submittedAt! > 0 ? { submittedAt: value.submittedAt } : {}),
    };
  } catch {
    return { opens: 0 };
  }
}

function save(storage: Storage, state: FeedbackPromptState): void {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Feedback is optional. Private browsing or a full storage quota must not
    // interfere with opening the application.
  }
}

/** Records one usable app opening and returns true on every fifth opening. */
export function shouldPromptForFeedback(storage: Storage): boolean {
  const state = load(storage);
  if (state.submittedAt) return false;
  const opens = state.opens + 1;
  save(storage, { opens });
  return opens % PROMPT_EVERY_OPENS === 0;
}

/** Stops automatic prompts after an actual successful send. */
export function markFeedbackSubmitted(storage: Storage, now = Date.now()): void {
  save(storage, { opens: 0, submittedAt: now });
}

export const feedbackPromptConfig = {
  everyOpens: PROMPT_EVERY_OPENS,
};
