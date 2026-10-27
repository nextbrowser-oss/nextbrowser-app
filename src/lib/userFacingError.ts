import { userFacingBrowserError } from "./userFacingBrowserError";

const errorCodePattern = /^[A-Z][A-Z0-9_]{2,63}$/;
// "Ref: NB-<hash>-<incident>". The main process words a failed profile start
// with "Ref: NB-<random>" (electron/profile-start-failure.cjs).
const refPattern = /\bRef: (NB-[A-F0-9]{8}(?:-[A-F0-9]{4})?)\b/g;
const MAX_REMEMBERED_REFS = 200;
const refCodes = new Map<string, string>();

/** The stable part of a Ref: a hash of what failed (an error code or message). */
export function errorReference(value: string): string {
  let hash = 2166136261;
  for (const char of value || "INTERNAL_ERROR") {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `NB-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function incidentPart(): string {
  const bytes = new Uint8Array(2);
  try {
    globalThis.crypto.getRandomValues(bytes);
  } catch {
    bytes[0] = Math.floor(Math.random() * 256);
    bytes[1] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, "0")).join("");
}

/**
 * The Ref of one occurrence of a failure: the hash of what failed, which
 * support maps back to the error code, then a random part that finds this
 * very incident among the error reports.
 */
export function incidentReference(value: string): string {
  return `${errorReference(value)}-${incidentPart()}`;
}

function codeReference(code: string): string {
  const ref = incidentReference(code);
  refCodes.set(ref, code);
  if (refCodes.size > MAX_REMEMBERED_REFS) refCodes.delete(refCodes.keys().next().value as string);
  return ref;
}

/** The error code behind a Ref this window made, so a component that has only the text can report it. */
export function errorCodeForRef(ref: string): string | undefined {
  return refCodes.get(ref);
}

/** Every Ref a message carries, in the order they appear. */
export function errorRefsIn(message: string): string[] {
  return Array.from(String(message || "").matchAll(refPattern), (match) => match[1]);
}

export function internalError(action: string, code: string): string {
  const context = action.trim() || "The action failed.";
  const safeCode = errorCodePattern.test(code) ? code : "INTERNAL_ERROR";
  return `${context} Ref: ${codeReference(safeCode)}`;
}

/**
 * Cloud project sync is best-effort. Its authentication failures are not app
 * errors: they neither cover the active chat nor become error reports.
 */
export function isBackgroundSyncFailure(detail: string): boolean {
  return /project sync failed\s*\(\d+\)|unauthorized.*project/i.test(detail);
}

export function needsSupportLink(message: string): boolean {
  return errorRefsIn(message).length > 0;
}

/**
 * The line an agent CLI printed when it gave up (picked out of its error
 * output by electron/agent-failure-report.cjs), as a sentence for the chat:
 * without the "ERROR:" label or a log line's timestamp and level.
 */
export function agentFailureDetail(reason?: string): string {
  const text = String(reason || "")
    .replace(/^\S*\d{2}:\d{2}:\d{2}\S*\s+(?:ERROR|FATAL)\s+/, "")
    .replace(/^(?:\[[^\]]*\]\s*)?(?:error|fatal)\s*:\s*/i, "")
    .trim();
  if (!text) return "";
  // A plain word starts the sentence; a module path such as codex_core::x keeps its case.
  const sentence = /^[a-z]+(?:\s|$)/.test(text) ? text[0].toUpperCase() + text.slice(1) : text;
  return /[.!?…:]$/.test(sentence) ? sentence : `${sentence}.`;
}

/**
 * A failed action must stay diagnosable: the reference maps back to the error
 * code, and the sanitized reason tells the user what actually failed instead of
 * leaving them with a hash alone. A hint (what to change on this computer)
 * goes after the reason.
 */
export function actionFailureMessage(action: string, code: string, detail?: unknown, hint?: string): string {
  const context = action.trim() || "The action failed.";
  const safeCode = errorCodePattern.test(code) ? code : "INTERNAL_ERROR";
  const reason = (detail instanceof Error ? detail.message : typeof detail === "string" ? detail : "").trim();
  const advice = (hint || "").trim();
  return `${context}${reason ? ` ${userFacingBrowserError(reason)}` : ""}${advice ? ` ${advice}` : ""} Ref: ${codeReference(safeCode)}`;
}
