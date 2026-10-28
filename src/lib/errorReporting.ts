import type { BrowserFailureCause } from "./userFacingBrowserError";
import { errorCauseForRef, errorCodeForRef, errorRefsIn, incidentReference, isBackgroundSyncFailure } from "./userFacingError";

// Renderer half of client error reporting. Errors and breadcrumbs go to the
// main process over the preload bridge; the main process scrubs, folds,
// queues and sends them (electron/client-error-reporter.cjs). Nothing here
// may throw: a broken reporter must not become another app error.

export type RendererErrorKind = "exception" | "unhandled_rejection" | "react_render" | "command_failed";

export interface RendererErrorReport {
  kind: RendererErrorKind;
  name: string;
  message: string;
  stack?: string;
  view?: string;
  action?: string;
  context?: Record<string, string>;
}

/** An error the app showed the user, named by identifiers only. */
export interface UserFacingErrorReport {
  /** Where the user saw it, in kebab-case, e.g. "scheduled-run-start". */
  surface: string;
  /** The error code, e.g. "AGENT_START_FAILED". */
  code: string;
  /** The Ref the user read, when the message carried one. */
  ref?: string;
  /** How long the user waited before the failure showed, for a stall. */
  elapsedMs?: number;
  /** What the app was doing when it gave up, in snake_case, e.g. "cli_download". */
  stage?: string;
  /** What nbc reported behind a failed profile start, as codes. */
  cause?: BrowserFailureCause;
}

// Views and UI actions are code identifiers, never user text.
const IDENTIFIER = /^[A-Za-z0-9_.:/-]{1,100}$/;
// The main process accepts exactly these shapes for a user-facing failure
// (electron/client-error-reporter.cjs) and refuses anything else.
const SURFACE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ERROR_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const ERROR_REF = /^NB-[0-9A-F]{8}(?:-[0-9A-F]{4})?$/;
const STAGE = /^[a-z][a-z0-9_]{0,63}$/;
// nextctl's codes are upper case, the backend's lower case (migration_failed).
const CAUSE_CODE = /^[A-Za-z][A-Za-z0-9_]{1,63}$/;
const CAUSE_CLASSES = new Set(["migration", "proxy_check", "launch", "install", "timeout", "other"]);
const RATE_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_WINDOW = 30;
// Chromium raises this for a layout that settles over two frames; it is not a
// failure anyone can act on.
const IGNORED_MESSAGES = /ResizeObserver loop/i;

let currentView = "";
let lastAction = "";
let windowStartedAt = 0;
let reportsInWindow = 0;
// A Ref names one incident, however many places show it.
const reportedRefs = new Set<string>();
// The notice and the report of one uncaught error are made by two listeners.
const unexpectedErrorRefs = new WeakMap<object, string>();

function bridge() {
  return typeof window === "undefined" ? undefined : window.nextbrowser;
}

export function setErrorReportingView(view: string): void {
  if (!IDENTIFIER.test(view) || view === currentView) return;
  currentView = view;
  try {
    bridge()?.breadcrumb?.({ category: "navigation", message: view });
  } catch {
    // Breadcrumbs are context only.
  }
}

/** Records a named UI action (the analytics event name) as a breadcrumb. */
export function recordUiAction(name: string): void {
  if (!IDENTIFIER.test(name)) return;
  lastAction = name;
  try {
    bridge()?.breadcrumb?.({ category: "ui", message: name });
  } catch {
    // Breadcrumbs are context only.
  }
}

export function describeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name || "Error", message: error.message || String(error), ...(error.stack ? { stack: error.stack } : {}) };
  }
  if (typeof error === "string") return { name: "Error", message: error };
  // Other thrown values can hold app data, so only a message string or the
  // value's type is reported.
  const message = error && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  if (typeof message === "string" && message) return { name: "NonErrorObject", message };
  return { name: "NonError", message: `Thrown ${Object.prototype.toString.call(error)}` };
}

/** The text the app's "Unexpected app error" notice is keyed on. */
export function unexpectedErrorDetail(event: ErrorEvent | PromiseRejectionEvent): string {
  if ("reason" in event) {
    const reason = event.reason;
    return reason instanceof Error ? reason.message : String(reason ?? "");
  }
  return event.message;
}

/** The Ref of an uncaught error: the same for its "Unexpected app error" notice and its report. */
export function unexpectedErrorReference(event: ErrorEvent | PromiseRejectionEvent): string {
  let ref = unexpectedErrorRefs.get(event);
  if (!ref) {
    ref = incidentReference(unexpectedErrorDetail(event).trim() || "Unknown renderer error");
    unexpectedErrorRefs.set(event, ref);
  }
  return ref;
}

/** Hands one report to the main process, within the renderer's rate limit. */
function send(build: () => RendererErrorReport): boolean {
  try {
    const target = bridge();
    if (!target?.reportError) return false;
    const now = Date.now();
    if (now - windowStartedAt > RATE_WINDOW_MS) {
      windowStartedAt = now;
      reportsInWindow = 0;
    }
    if (reportsInWindow >= MAX_REPORTS_PER_WINDOW) return false;
    reportsInWindow += 1;
    target.reportError(build());
    return true;
  } catch {
    return false;
  }
}

export function reportRendererError(
  kind: RendererErrorKind,
  error: unknown,
  context: Record<string, string> = {},
  componentStack?: string | null,
): boolean {
  return send(() => {
    const described = describeError(error);
    const stack = [described.stack, componentStack ? `Component stack:${componentStack}` : ""].filter(Boolean).join("\n\n");
    return {
      kind,
      name: described.name,
      message: described.message,
      ...(stack ? { stack } : {}),
      ...(currentView ? { view: currentView } : {}),
      ...(lastAction ? { action: lastAction } : {}),
      context,
    };
  });
}

/**
 * Reports a failure the app caught and showed the user, which therefore never
 * reached the global error handlers. The report names the failure by
 * identifiers only: the message the user read can quote an agent's reply, a
 * page or a file name, so its text is never sent. Each Ref is reported once.
 */
export function reportUserFacingError({ surface, code, ref, elapsedMs, stage, cause }: UserFacingErrorReport): boolean {
  if (typeof surface !== "string" || surface.length > 64 || !SURFACE.test(surface) || !ERROR_CODE.test(code)) return false;
  const safeRef = ref && ERROR_REF.test(ref) ? ref : undefined;
  if (safeRef && reportedRefs.has(safeRef)) return false;
  const elapsed = typeof elapsedMs === "number" && Number.isFinite(elapsedMs) && elapsedMs >= 0 ? String(Math.round(elapsedMs)) : undefined;
  const safeStage = stage && STAGE.test(stage) ? stage : undefined;
  const safeCause = cause && ERROR_CODE.test(cause.nbcCode) && CAUSE_CLASSES.has(cause.cause)
    && (cause.causeCode === undefined || CAUSE_CODE.test(cause.causeCode)) ? cause : undefined;
  const sent = send(() => ({
    kind: "command_failed",
    name: code,
    message: `${surface}: ${code}`,
    ...(currentView ? { view: currentView } : {}),
    ...(lastAction ? { action: lastAction } : {}),
    context: {
      surface,
      code,
      ...(safeRef ? { ref: safeRef } : {}),
      ...(elapsed ? { elapsed_ms: elapsed } : {}),
      ...(safeStage ? { stage: safeStage } : {}),
      ...(safeCause ? { nbc_code: safeCause.nbcCode, ...(safeCause.causeCode ? { cause_code: safeCause.causeCode } : {}), cause: safeCause.cause } : {}),
    },
  }));
  if (sent && safeRef) reportedRefs.add(safeRef);
  return sent;
}

/**
 * Reports a message the app showed, by the last Ref in it that this window
 * made (the Ref says which error code it stands for). Without such a Ref, or
 * when that Ref was already reported, `fallbackCode` is reported instead,
 * if given. A Ref from elsewhere, such as one in a message saved before a
 * restart or in a profile start failure the main process worded, is never
 * reported here. The message text is never sent; what nbc reported behind
 * a failed profile start goes along as codes.
 */
export function reportUserFacingMessage(surface: string, message: string, fallbackCode?: string): boolean {
  try {
    const refs = errorRefsIn(message);
    for (let index = refs.length - 1; index >= 0; index -= 1) {
      const ref = refs[index];
      const code = errorCodeForRef(ref);
      if (!code) continue;
      if (!reportedRefs.has(ref)) return reportUserFacingError({ surface, code, ref, cause: errorCauseForRef(ref) });
      break;
    }
    return fallbackCode ? reportUserFacingError({ surface, code: fallbackCode }) : false;
  } catch {
    return false;
  }
}

/** Reports uncaught renderer errors and unhandled promise rejections. */
export function installErrorReporting(target: Window = window): () => void {
  const onError = (event: ErrorEvent) => {
    const detail = unexpectedErrorDetail(event);
    if (IGNORED_MESSAGES.test(detail) || isBackgroundSyncFailure(detail)) return;
    reportRendererError("exception", event.error ?? event.message, {
      ref: unexpectedErrorReference(event),
      ...(event.filename ? { source_file: event.filename, line: String(event.lineno || 0), column: String(event.colno || 0) } : {}),
    });
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    const detail = unexpectedErrorDetail(event);
    // Background project sync failures are already handled (and their 5xx
    // reported with a trace id by the main process).
    if (isBackgroundSyncFailure(detail)) return;
    reportRendererError("unhandled_rejection", event.reason, { ref: unexpectedErrorReference(event) });
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

/** Test hook: forget the view, last action and rate window. */
export function resetErrorReportingForTests(): void {
  currentView = "";
  lastAction = "";
  windowStartedAt = 0;
  reportsInWindow = 0;
  reportedRefs.clear();
}
