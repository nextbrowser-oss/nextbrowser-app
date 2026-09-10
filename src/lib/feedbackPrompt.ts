const STATE_KEY = "nextbrowser.feedbackPrompt.v1";
const PROMPT_EVERY_OPENS = 5;
// A feedback request is intentionally rare after a successful submission.
const FEEDBACK_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1_000;

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
export function shouldPromptForFeedback(storage: Storage, now = Date.now()): boolean {
  let state = load(storage);
  if (state.submittedAt && now - state.submittedAt < FEEDBACK_COOLDOWN_MS) return false;

  // After three months, forget the previous response and start a fresh cycle.
  if (state.submittedAt) state = { opens: 0 };
  const opens = state.opens + 1;
  save(storage, { opens });
  return opens % PROMPT_EVERY_OPENS === 0;
}

/** Stops automatic prompts for three months after an actual successful send. */
export function markFeedbackSubmitted(storage: Storage, now = Date.now()): void {
  save(storage, { opens: 0, submittedAt: now });
}

export const feedbackPromptConfig = {
  everyOpens: PROMPT_EVERY_OPENS,
  cooldownMs: FEEDBACK_COOLDOWN_MS,
};
