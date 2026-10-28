import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The tests run without a DOM, so the component is called as a function and
// its effect runs at once, as it would after each mount.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (effect: () => void) => { effect(); },
}));

import { resetErrorReportingForTests, type RendererErrorReport } from "../lib/errorReporting";
import { actionFailureMessage, errorRefsIn, internalError } from "../lib/userFacingError";
import { UserFacingError } from "./UserFacingError";

describe("UserFacingError reports", () => {
  let reports: RendererErrorReport[];

  beforeEach(() => {
    resetErrorReportingForTests();
    reports = [];
    vi.stubGlobal("window", { nextbrowser: { reportError: (report: RendererErrorReport) => reports.push(report) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an internal error it shows by surface, code and Ref", () => {
    const message = internalError("We couldn't sign you out.", "ACCOUNT_SIGN_OUT_FAILED");
    const [ref] = errorRefsIn(message);
    UserFacingError({ message, surface: "account_sign_out" });
    expect(reports).toEqual([{
      kind: "command_failed",
      name: "ACCOUNT_SIGN_OUT_FAILED",
      message: "account-sign-out: ACCOUNT_SIGN_OUT_FAILED",
      context: { surface: "account-sign-out", code: "ACCOUNT_SIGN_OUT_FAILED", ref },
    }]);
  });

  it("reports each Ref once, however often it is shown", () => {
    const message = internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED");
    UserFacingError({ message, surface: "live_view" });
    UserFacingError({ message, surface: "live_view" });
    UserFacingError({ message, surface: "agent_chat" });
    expect(reports).toHaveLength(1);
    UserFacingError({ message: internalError("We couldn't connect Live View.", "LIVE_VIEW_CONNECT_FAILED"), surface: "live_view" });
    expect(reports).toHaveLength(2);
    expect(reports[0].context?.ref).not.toBe(reports[1].context?.ref);
  });

  it("reports a failed profile start with what nbc reported, as codes, never the message", () => {
    // nbc 1.2.38 in production, 28.10.2026: the report said PROFILE_START_FAILED
    // and nothing else; the cause was only in the backend's logs.
    const raw = "Could not start Nextbrowser: VERIFY_FAILED: migrate NodeMaven account before profile startup: migrate proxy traffic: unexpected status 502 Bad Gateway: {\"code\":\"migration_failed\",\"message\":\"Could not safely migrate the proxy account; browser startup was stopped\"} [VERIFY_FAILED] — The proxy account was not ready; the profile was not started. Retry to resume migration.";
    const message = actionFailureMessage("We couldn't start “Alice's shop”.", "PROFILE_START_FAILED", raw);
    const [ref] = errorRefsIn(message);
    UserFacingError({ message, surface: "profile_action" });
    expect(reports).toEqual([{
      kind: "command_failed",
      name: "PROFILE_START_FAILED",
      message: "profile-action: PROFILE_START_FAILED",
      context: { surface: "profile-action", code: "PROFILE_START_FAILED", ref, nbc_code: "VERIFY_FAILED", cause_code: "migration_failed", cause: "migration" },
    }]);
    expect(JSON.stringify(reports)).not.toMatch(/Alice|NodeMaven|502|proxy account|couldn/);
    // A start that failed before its check: the wrapped code and its class.
    const launch = actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", "VERIFY_FAILED: browser stopped: LAUNCH_FAILED: launch failed (Camoufox exited before becoming ready) [VERIFY_FAILED]");
    UserFacingError({ message: launch, surface: "profile_action" });
    expect(reports[1].context).toEqual({ surface: "profile-action", code: "PROFILE_START_FAILED", ref: errorRefsIn(launch)[0], nbc_code: "VERIFY_FAILED", cause_code: "LAUNCH_FAILED", cause: "launch" });
  });

  it("never sends the text of a chat turn", () => {
    const message = `The page says: card 4111 1111 1111 1111 for alice@example.com\n${internalError("We couldn't start the agent.", "AGENT_START_FAILED")}`;
    UserFacingError({ message, surface: "agent_turn" });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ name: "AGENT_START_FAILED", message: "agent-turn: AGENT_START_FAILED" });
    expect(JSON.stringify(reports)).not.toMatch(/4111|alice|page says/);
  });

  it("reports nothing for input errors and Refs it did not make", () => {
    UserFacingError({ message: "Enter a valid proxy URL.", surface: "manual_proxy" });
    // A message saved before a restart, and a profile failure worded by the main process.
    UserFacingError({ message: "We couldn't start the agent. Ref: NB-6F2C1A9B-04D2", surface: "agent_turn" });
    UserFacingError({ message: "The Work profile couldn't start: proxy. Retry once. Ref: NB-0000ABCD", surface: "agent_turn" });
    expect(reports).toEqual([]);
  });
});
