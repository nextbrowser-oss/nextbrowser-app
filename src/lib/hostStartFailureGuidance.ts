/**
 * How an agent reports a failed host profile start. The host answers with
 * { ok: false, error: { message, nextAction, retryable, ref, ... },
 * diagnostics }, and error.message is already written for the user.
 */
export const HOST_START_FAILURE_GUIDANCE = "A failed host start returns {\"ok\":false,\"error\":{...},\"diagnostics\":{...}}. Tell the user error.message: it already names the profile, the reason, the next step and a Ref. Never paste the raw JSON or quote diagnostics unless the user asks for technical details. If error.retryable is true, you may run that same start command once more before reporting. If it is false, the problem is configuration or installation: do not retry, and give the user error.nextAction. When several profiles fail, report each profile with its own reason.";
