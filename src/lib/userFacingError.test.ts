import { describe, expect, it } from "vitest";
import {
  actionFailureMessage,
  agentFailureDetail,
  errorCauseForRef,
  errorCodeForRef,
  errorReference,
  errorRefsIn,
  incidentReference,
  internalError,
  needsSupportLink,
} from "./userFacingError";
import { PROXY_ACCOUNT_SETUP_FAILED, userFacingBrowserError } from "./userFacingBrowserError";

// nbc 1.2.38 in production, 28.10.2026, as the app sees it: the backend refused
// to migrate the proxy account before the start.
const MIGRATION_FAILED = "Could not start Nextbrowser: VERIFY_FAILED: migrate NodeMaven account before profile startup: migrate proxy traffic: unexpected status 502 Bad Gateway: {\"code\":\"migration_failed\",\"message\":\"Could not safely migrate the proxy account; browser startup was stopped\"} [VERIFY_FAILED] — The proxy account was not ready; the profile was not started. Retry to resume migration.";

/** The message with each Ref cut back to the part that names the error code. */
function withCodeRef(message: string): string {
  return message.replace(/(Ref: NB-[A-F0-9]{8})-[A-F0-9]{4}\b/g, "$1");
}

describe("user-facing internal errors", () => {
  it("never exposes technical error details", () => {
    expect(withCodeRef(internalError("We couldn't start Live View.", "LIVE_VIEW_CONNECT_FAILED"))).toBe(
      `We couldn't start Live View. Ref: ${errorReference("LIVE_VIEW_CONNECT_FAILED")}`,
    );
  });

  it("does not render untrusted error codes", () => {
    expect(withCodeRef(internalError("Failed.", "bad code"))).toBe(`Failed. Ref: ${errorReference("INTERNAL_ERROR")}`);
  });

  it("gives every incident its own Ref that still names the error code", () => {
    const first = errorRefsIn(internalError("We couldn't start the agent.", "AGENT_START_FAILED"));
    const second = errorRefsIn(actionFailureMessage("We couldn't start the agent.", "AGENT_START_FAILED", "spawn failed"));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]).toMatch(new RegExp(`^${errorReference("AGENT_START_FAILED")}-[0-9A-F]{4}$`));
    expect(second[0]).toMatch(new RegExp(`^${errorReference("AGENT_START_FAILED")}-[0-9A-F]{4}$`));
    const many = new Set(Array.from({ length: 20 }, () => incidentReference("AGENT_START_FAILED")));
    expect(many.size).toBeGreaterThan(1);
  });

  it("remembers which error code each Ref it made stands for", () => {
    const [ref] = errorRefsIn(internalError("We couldn't sign you out.", "ACCOUNT_SIGN_OUT_FAILED"));
    const [failedRef] = errorRefsIn(actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", "Proxy check failed"));
    const [untrustedRef] = errorRefsIn(internalError("Failed.", "bad code"));
    expect(errorCodeForRef(ref)).toBe("ACCOUNT_SIGN_OUT_FAILED");
    expect(errorCodeForRef(failedRef)).toBe("PROFILE_START_FAILED");
    expect(errorCodeForRef(untrustedRef)).toBe("INTERNAL_ERROR");
    // A Ref from another source (a reload, the main process) is not ours.
    expect(errorCodeForRef("NB-25647DEA-0000")).toBeUndefined();
    expect(errorCodeForRef(errorReference("ACCOUNT_SIGN_OUT_FAILED"))).toBeUndefined();
  });

  it("remembers what nbc reported behind a Ref, as codes", () => {
    const [sidebarRef] = errorRefsIn(actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", MIGRATION_FAILED));
    expect(errorCauseForRef(sidebarRef)).toEqual({ nbcCode: "VERIFY_FAILED", causeCode: "migration_failed", cause: "migration" });
    const [chatRef] = errorRefsIn(internalError("Browser setup stopped.", "VERIFY_FAILED", new Error(MIGRATION_FAILED)));
    expect(errorCauseForRef(chatRef)).toEqual({ nbcCode: "VERIFY_FAILED", causeCode: "migration_failed", cause: "migration" });
    const [checkRef] = errorRefsIn(actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", "VERIFY_FAILED: browser stopped: VERIFY_REQUIRED: failed browser checks: proxy; the profile cannot be used [VERIFY_FAILED]"));
    expect(errorCauseForRef(checkRef)).toEqual({ nbcCode: "VERIFY_FAILED", cause: "proxy_check" });
    // Errors that did not come from nbc, and Refs without a reason.
    const [plainRef] = errorRefsIn(actionFailureMessage("We couldn't prepare this profile.", "PROFILE_ASSIGNMENT_FAILED", "workspace revision conflict"));
    expect(errorCauseForRef(plainRef)).toBeUndefined();
    const [bareRef] = errorRefsIn(internalError("We couldn't sign you out.", "ACCOUNT_SIGN_OUT_FAILED"));
    expect(errorCauseForRef(bareRef)).toBeUndefined();
    expect(errorCauseForRef("NB-25647DEA-0000")).toBeUndefined();
  });

  it("finds every Ref in a message, old and new formats alike", () => {
    expect(errorRefsIn("The Work profile couldn't start: proxy. Retry once. Ref: NB-0000ABCD")).toEqual(["NB-0000ABCD"]);
    expect(errorRefsIn("We couldn't start “Work”. Ref: NB-0000ABCD Ref: NB-25647DEA-1A2B")).toEqual(["NB-0000ABCD", "NB-25647DEA-1A2B"]);
    expect(errorRefsIn("NB-25647DEA-1A2B without the label")).toEqual([]);
  });

  it("adds support only to internal errors", () => {
    expect(needsSupportLink(internalError("Failed.", "ACTION_FAILED"))).toBe(true);
    // Refs written before Refs had an incident part, and by the main process.
    expect(needsSupportLink("We couldn't sign you out. Ref: NB-25647DEA")).toBe(true);
    expect(needsSupportLink("We couldn't sign you out. Ref: NB-25647DEA-1A2B")).toBe(true);
    expect(needsSupportLink("Enter a valid proxy URL.")).toBe(false);
  });

  it("explains the sanitized reason beside the support reference", () => {
    const message = actionFailureMessage("We couldn't prepare this profile.", "PROFILE_ASSIGNMENT_FAILED", "workspace revision conflict");
    expect(withCodeRef(message)).toBe(
      "We couldn't prepare this profile. The selected workspace is no longer available. Select or create a workspace, then try again. "
      + `Ref: ${errorReference("PROFILE_ASSIGNMENT_FAILED")}`,
    );
    // The reference the user reported must keep decoding to this action.
    expect(errorReference("PROFILE_ASSIGNMENT_FAILED")).toBe("NB-25647DEA");
  });

  it("explains an Error object from a failed Live View command", () => {
    const message = actionFailureMessage(
      "We couldn't start Live View.",
      "LIVE_VIEW_START_FAILED",
      new Error("detached Remote Control child failed: Proxy traffic limit reached; see log /Users/person/private/child.log"),
    );
    expect(message).toContain("Proxy traffic limit reached. Open Proxy usage to add more traffic, then retry Live View.");
    expect(message).not.toContain("/Users/");
  });

  it("keeps private filesystem locations out of the visible reason", () => {
    const message = actionFailureMessage(
      "We couldn't prepare this profile.",
      "PROFILE_ASSIGNMENT_FAILED",
      "Error invoking remote method 'x': Error: open /Users/someone/secret/workspaces.json failed",
    );
    expect(message).not.toContain("/Users/");
    expect(message).toContain("Ref: NB-25647DEA");
  });

  it("tells the sidebar and the chat the same thing when the proxy account could not be set up", () => {
    // The sidebar words a failed start with actionFailureMessage, the chat
    // with internalError around the browser-error mapping (store.ts
    // preflightFailureMessage); the verification dialog does not open for
    // this failure (preflight.ts), so these two are all the user sees.
    const sidebar = actionFailureMessage("We couldn't start “Work”.", "PROFILE_START_FAILED", MIGRATION_FAILED);
    const chat = internalError(`Browser setup stopped. ${userFacingBrowserError(MIGRATION_FAILED)}`, "VERIFY_FAILED");
    expect(withCodeRef(sidebar)).toBe(`We couldn't start “Work”. ${PROXY_ACCOUNT_SETUP_FAILED} Ref: ${errorReference("PROFILE_START_FAILED")}`);
    expect(withCodeRef(chat)).toBe(`Browser setup stopped. ${PROXY_ACCOUNT_SETUP_FAILED} Ref: ${errorReference("VERIFY_FAILED")}`);
    for (const message of [sidebar, chat]) {
      expect(message).not.toMatch(/safety check|through its proxy|VERIFY|migrat|502|NodeMaven/i);
      expect(needsSupportLink(message)).toBe(true);
    }
  });

  it("falls back to the bare reference when no reason is available", () => {
    expect(withCodeRef(actionFailureMessage("Failed.", "ACTION_FAILED"))).toBe(`Failed. Ref: ${errorReference("ACTION_FAILED")}`);
    expect(withCodeRef(actionFailureMessage("Failed.", "ACTION_FAILED", "   "))).toBe(`Failed. Ref: ${errorReference("ACTION_FAILED")}`);
  });
});

describe("agent failure detail", () => {
  it("turns the CLI's error line into a sentence", () => {
    expect(agentFailureDetail("ERROR: You've hit your usage limit. Try again later.")).toBe("You've hit your usage limit. Try again later.");
    expect(agentFailureDetail("ERROR: stream disconnected before completion")).toBe("Stream disconnected before completion.");
    expect(agentFailureDetail("API Error: 529 Overloaded")).toBe("API Error: 529 Overloaded.");
    expect(agentFailureDetail("2026-10-23T07:02:11.831641Z ERROR codex_core::client: unexpected status 400 Bad Request"))
      .toBe("codex_core::client: unexpected status 400 Bad Request.");
  });

  it("is empty without a reason", () => {
    expect(agentFailureDetail(undefined)).toBe("");
    expect(agentFailureDetail("ERROR:  ")).toBe("");
  });

  it("keeps the reference after the reason", () => {
    const message = internalError(`Codex stopped unexpectedly. ${agentFailureDetail("ERROR: stream disconnected")}`, "AGENT_STOPPED_UNEXPECTEDLY");
    expect(withCodeRef(message)).toBe(`Codex stopped unexpectedly. Stream disconnected. Ref: ${errorReference("AGENT_STOPPED_UNEXPECTEDLY")}`);
    expect(needsSupportLink(message)).toBe(true);
  });
});
