import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  describeError,
  installErrorReporting,
  recordUiAction,
  reportRendererError,
  reportUserFacingError,
  reportUserFacingMessage,
  resetErrorReportingForTests,
  setErrorReportingView,
  unexpectedErrorReference,
  type RendererErrorReport,
} from "./errorReporting";
import { trackEvent } from "./analytics";
import { errorReference, errorRefsIn, internalError } from "./userFacingError";

type Listener = (event: unknown) => void;

function fakeWindow() {
  const reports: RendererErrorReport[] = [];
  const crumbs: { category: string; message: string }[] = [];
  const listeners = new Map<string, Listener>();
  const page = {
    nextbrowser: {
      invoke: vi.fn(),
      on: vi.fn(),
      reportError: (report: RendererErrorReport) => { reports.push(report); },
      breadcrumb: (crumb: { category: string; message: string }) => { crumbs.push(crumb); },
    },
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  return { page, reports, crumbs, listeners };
}

describe("renderer error reporting", () => {
  let env: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    resetErrorReportingForTests();
    env = fakeWindow();
    vi.stubGlobal("window", env.page);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends uncaught errors with the view, last action and the Ref the user sees", () => {
    setErrorReportingView("chat");
    recordUiAction("chat_request_submitted");
    const uninstall = installErrorReporting(env.page as unknown as Window);
    const error = new TypeError("Cannot read properties of undefined (reading 'map')");
    env.listeners.get("error")?.({ message: `Uncaught ${error.name}: ${error.message}`, error, filename: "file:///app/dist/assets/index.js", lineno: 10, colno: 4 });
    expect(env.reports).toHaveLength(1);
    const [report] = env.reports;
    expect(report).toMatchObject({
      kind: "exception",
      name: "TypeError",
      message: error.message,
      view: "chat",
      action: "chat_request_submitted",
      context: { source_file: "file:///app/dist/assets/index.js", line: "10", column: "4" },
    });
    expect(report.context?.ref).toMatch(new RegExp(`^${errorReference(`Uncaught ${error.name}: ${error.message}`)}-[0-9A-F]{4}$`));
    expect(report.stack).toContain("TypeError");
    expect(env.crumbs).toEqual([
      { category: "navigation", message: "chat" },
      { category: "ui", message: "chat_request_submitted" },
    ]);
    uninstall();
    expect(env.listeners.size).toBe(0);
  });

  it("reports unhandled rejections, but not background sync or layout noise", () => {
    installErrorReporting(env.page as unknown as Window);
    env.listeners.get("unhandledrejection")?.({ reason: new Error("Project sync failed (401).") });
    env.listeners.get("error")?.({ message: "ResizeObserver loop completed with undelivered notifications.", error: null });
    const rejection = { reason: new Error("socket closed") };
    env.listeners.get("unhandledrejection")?.(rejection);
    expect(env.reports).toHaveLength(1);
    // The notice for the same event shows the Ref the report carries.
    expect(env.reports[0]).toMatchObject({
      kind: "unhandled_rejection",
      message: "socket closed",
      context: { ref: unexpectedErrorReference(rejection as unknown as PromiseRejectionEvent) },
    });
    expect(unexpectedErrorReference({ reason: new Error("socket closed") } as unknown as PromiseRejectionEvent))
      .not.toBe(env.reports[0].context?.ref);
  });

  it("never serializes non-Error values that may hold app data", () => {
    expect(describeError({ prompt: "secret prompt", token: "x" })).toEqual({ name: "NonError", message: "Thrown [object Object]" });
    expect(describeError({ message: "plain object failure", data: "secret" })).toEqual({ name: "NonErrorObject", message: "plain object failure" });
    expect(describeError("text")).toEqual({ name: "Error", message: "text" });
  });

  it("only accepts identifiers as views and UI actions", () => {
    setErrorReportingView("chat with free text");
    recordUiAction("user typed this");
    expect(env.crumbs).toEqual([]);
  });

  it("uses analytics event names as UI breadcrumbs", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    });
    vi.stubGlobal("document", { createElement: () => ({}), head: { appendChild: () => undefined } });
    Object.assign(env.page, { setTimeout: () => 0 });
    trackEvent("profile_start_requested", { profile_count: 2 });
    trackEvent("screen_view", { screen_name: "chat" });
    expect(env.crumbs).toEqual([{ category: "ui", message: "profile_start_requested" }]);
  });

  it("rate-limits a renderer error loop", () => {
    for (let index = 0; index < 100; index += 1) reportRendererError("exception", new Error(`loop ${index}`));
    expect(env.reports).toHaveLength(30);
  });

  it("reports an error the user saw by surface, code and Ref only", () => {
    setErrorReportingView("chat");
    recordUiAction("chat_request_submitted");
    expect(reportUserFacingError({ surface: "agent-turn", code: "AGENT_START_FAILED", ref: "NB-6F2C1A9B-04D2" })).toBe(true);
    expect(env.reports).toEqual([{
      kind: "command_failed",
      name: "AGENT_START_FAILED",
      message: "agent-turn: AGENT_START_FAILED",
      view: "chat",
      action: "chat_request_submitted",
      context: { surface: "agent-turn", code: "AGENT_START_FAILED", ref: "NB-6F2C1A9B-04D2" },
    }]);
  });

  it("reports each Ref once and needs no Ref", () => {
    const shown = { surface: "live-view", code: "LIVE_VIEW_CONNECT_FAILED", ref: "NB-1234ABCD-00FF" };
    expect(reportUserFacingError(shown)).toBe(true);
    expect(reportUserFacingError(shown)).toBe(false);
    expect(reportUserFacingError({ ...shown, surface: "chat-system" })).toBe(false);
    expect(reportUserFacingError({ surface: "startup", code: "STARTUP_LOCAL_TIMED_OUT" })).toBe(true);
    expect(reportUserFacingError({ surface: "startup", code: "STARTUP_LOCAL_TIMED_OUT" })).toBe(true);
    expect(env.reports.map((report) => report.context)).toEqual([
      shown,
      { surface: "startup", code: "STARTUP_LOCAL_TIMED_OUT" },
      { surface: "startup", code: "STARTUP_LOCAL_TIMED_OUT" },
    ]);
  });

  it("reports a stall with how long it lasted and the stage it stalled in", () => {
    expect(reportUserFacingError({ surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT", elapsedMs: 180_000.4, stage: "cli_download" })).toBe(true);
    expect(reportUserFacingError({ surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT", elapsedMs: Number.NaN, stage: "C:\\Users\\alice" })).toBe(true);
    expect(env.reports.map((report) => report.context)).toEqual([
      { surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT", elapsed_ms: "180000", stage: "cli_download" },
      { surface: "startup", code: "STARTUP_ACCOUNT_TIMED_OUT" },
    ]);
  });

  it("sends no free text as a surface, code or Ref", () => {
    expect(reportUserFacingError({ surface: "We couldn't start the agent.", code: "AGENT_START_FAILED" })).toBe(false);
    expect(reportUserFacingError({ surface: "agent_turn", code: "AGENT_START_FAILED" })).toBe(false);
    expect(reportUserFacingError({ surface: "agent-turn", code: "start failed: ENOENT /Users/alice" })).toBe(false);
    expect(reportUserFacingError({ surface: "agent-turn", code: "AGENT_START_FAILED", ref: "NB-1234ABCD and the reply" })).toBe(true);
    expect(env.reports).toHaveLength(1);
    expect(env.reports[0].context).toEqual({ surface: "agent-turn", code: "AGENT_START_FAILED" });
    expect(JSON.stringify(env.reports)).not.toContain("reply");
  });

  it("reports a shown message by the code behind its Ref, or else by the caller's code", () => {
    const shown = `Could not start: ${internalError("We couldn't connect Codex.", "AGENT_CONNECT_FAILED")}`;
    const [ref] = errorRefsIn(shown);
    expect(reportUserFacingMessage("scheduled-run-start", shown, "SCHEDULED_AGENT_NOT_CONNECTED")).toBe(true);
    // The incident is reported once; the schedule's own failure still counts.
    expect(reportUserFacingMessage("scheduled-run-start", shown, "SCHEDULED_AGENT_NOT_CONNECTED")).toBe(true);
    expect(reportUserFacingMessage("agent-chat", shown)).toBe(false);
    // A Ref the window did not make says nothing about the code.
    expect(reportUserFacingMessage("x-monitor-pass", "Failed. Ref: NB-0000ABCD", "X_MONITOR_PASS_FAILED")).toBe(true);
    expect(reportUserFacingMessage("x-monitor-pass", "Failed. Ref: NB-0000ABCD")).toBe(false);
    expect(env.reports.map((report) => report.context)).toEqual([
      { surface: "scheduled-run-start", code: "AGENT_CONNECT_FAILED", ref },
      { surface: "scheduled-run-start", code: "SCHEDULED_AGENT_NOT_CONNECTED" },
      { surface: "x-monitor-pass", code: "X_MONITOR_PASS_FAILED" },
    ]);
    expect(JSON.stringify(env.reports)).not.toContain("Codex");
  });

  it("is a no-op without the bridge and never throws", () => {
    vi.stubGlobal("window", { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    expect(reportRendererError("exception", new Error("x"))).toBe(false);
    vi.stubGlobal("window", { nextbrowser: { reportError: () => { throw new Error("ipc down"); } } });
    expect(reportRendererError("exception", new Error("x"))).toBe(false);
  });
});
