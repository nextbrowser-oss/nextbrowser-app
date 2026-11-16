import { describe, expect, it } from "vitest";
import { chatLiveSession } from "./profileNavigation";
import type { LiveSessionOption } from "./liveSessions";
import type { Conversation } from "../types";

const chat: Conversation = { id: "chat-a", title: "Project", agent: "codex", messages: [], createdAt: 0, updatedAt: 0, profileNames: ["mine"] };
const local = (profile: string, running = false): LiveSessionOption => ({ key: `clawbrowser:${profile}`, label: profile, running, target: { runtime: "camoufox", profile } });
describe("direct browser navigation from a chat", () => {
  it("prefers the current session's browser over the last workspace-wide selection", () => {
    expect(chatLiveSession([local("other", true), local("mine", true)], chat, { mine: chat.id }, "other")?.key).toBe("clawbrowser:mine");
  });
  it("opens an assigned stopped profile directly instead of choosing a different running browser", () => {
    expect(chatLiveSession([local("other", true), local("mine")], chat, {}, "other")?.key).toBe("clawbrowser:mine");
  });
  it("does not take over a running profile owned by another chat", () => {
    expect(chatLiveSession([local("other", true)], chat, { other: "chat-b" }, "other")).toBeUndefined();
  });
  it("uses the selected browser for a new session without a prior browser association", () => {
    expect(chatLiveSession([local("other"), local("mine")], { ...chat, profileNames: [] }, {}, "mine")?.key).toBe("clawbrowser:mine");
  });
  it("respects an active Multilogin selection and leaves an empty workspace to the creator", () => {
    const multi: LiveSessionOption = { key: "multilogin:browser:m", label: "ML", running: false, target: { runtime: "multilogin", selection: { id: "m", kind: "browser", name: "ML", active: true } } };
    expect(chatLiveSession([local("other", true), multi], undefined, {})?.key).toBe(multi.key);
    expect(chatLiveSession([], chat, {})).toBeUndefined();
  });
});
