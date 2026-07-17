import { describe, expect, it } from "vitest";
import type { ChatMessage, Conversation } from "../types";
import { composePrompt } from "./composePrompt";
import { buildVPSPrompt, VPS_PROMPT_MARKER, vpsConnectionInstructions } from "./vpsPrompt";

function message(
  id: string,
  role: ChatMessage["role"],
  text: string,
): ChatMessage {
  return { id, role, text, status: "done", createdAt: 1 };
}

function conversation(messages: ChatMessage[]): Conversation {
  return {
    id: "conversation-1",
    title: "VPS",
    agent: "codex",
    messages,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe("composePrompt VPS mode", () => {
  it("uses the remote-only preamble for the marked setup prompt", () => {
    const setup = buildVPSPrompt({
      kind: "ssh-config",
      host: { alias: "prod", configPath: "/Users/alice/.ssh/config", explicitConfig: false },
    });
    const prompt = composePrompt(
      [{
        ...conversation([message("user-1", "user", setup), message("reply-1", "assistant", "")]),
        executionTarget: "vps",
        vpsConnectionInstructions: setup,
      }],
      "conversation-1",
      "reply-1",
      setup,
      "local-profile",
      { nextctlAvailable: false, executionTarget: "vps" },
    );

    expect(prompt).toContain("Strict VPS remote-only mode");
    expect(prompt).toContain(VPS_PROMPT_MARKER);
    expect(prompt).not.toContain("local `nextctl`/Clawbrowser components are missing");
    expect(prompt).not.toContain("Active NextBrowser profile: local-profile");
  });

  it("keeps follow-up turns remote and carries the marked SSH instructions forward", () => {
    const setup = buildVPSPrompt({
      kind: "ssh-config",
      host: { alias: "prod", configPath: "/Users/alice/.ssh/custom config", explicitConfig: true },
    });
    const messages = [
      message("setup", "user", setup),
      message("setup-reply", "assistant", "The VPS is ready."),
      ...Array.from({ length: 14 }, (_, index) =>
        message(`old-${index}`, index % 2 === 0 ? "user" : "assistant", `old message ${index}`),
      ),
      message("follow-up", "user", "Open example.com on the browser."),
      message("reply-2", "assistant", ""),
    ];

    const prompt = composePrompt(
      [{
        ...conversation(messages),
        executionTarget: "vps",
        vpsConnectionInstructions: vpsConnectionInstructions(setup),
      }],
      "conversation-1",
      "reply-2",
      "Open example.com on the browser.",
      "local-profile",
      { nextctlAvailable: true, executionTarget: "vps" },
    );

    expect(prompt).toContain("Strict VPS remote-only mode");
    expect(prompt).toContain("Active VPS connection instructions:");
    expect(prompt).toContain("ssh -F /dev/null -o BatchMode=yes -o ConnectTimeout=15 -o ConnectionAttempts=1 -o PermitLocalCommand=no prod");
    expect(prompt).toContain("NEXTCTL_AUTO_UPDATE=0");
    expect(prompt).not.toContain("nextctl doctor");
    expect(prompt).toContain("Open example.com on the browser.");
    expect(prompt).not.toContain("ask the user what browser task to run next");
    expect(prompt).not.toContain("which is already installed");
    expect(prompt).not.toContain("Active NextBrowser profile: local-profile");
  });

  it("uses persisted VPS connection instructions when the setup marker is no longer in history", () => {
    const prompt = composePrompt(
      [{
        ...conversation([
          message("follow-up", "user", "Open example.com on the browser."),
          message("reply", "assistant", ""),
        ]),
        executionTarget: "vps",
        vpsConnectionInstructions: `${VPS_PROMPT_MARKER}\nSSH command: ssh prod\nRemote identity: deploy@prod`,
      }],
      "conversation-1",
      "reply",
      "Open example.com on the browser.",
      "local-profile",
      { nextctlAvailable: true, executionTarget: "vps" },
    );

    expect(prompt).toContain("Strict VPS remote-only mode");
    expect(prompt).toContain("Active VPS connection instructions:");
    expect(prompt).toContain("SSH command: ssh prod");
    expect(prompt).toContain("Remote identity: deploy@prod");
    expect(prompt).not.toContain("Active NextBrowser profile: local-profile");
  });

  it("keeps ordinary conversations on the local profile", () => {
    const prompt = composePrompt(
      [conversation([message("user-1", "user", "Open example.com"), message("reply", "assistant", "")])],
      "conversation-1",
      "reply",
      "Open example.com",
      "work",
      { nextctlAvailable: true },
    );

    expect(prompt).toContain("which is already installed");
    expect(prompt).toContain("Active NextBrowser profile: work");
    expect(prompt).not.toContain("Strict VPS remote-only mode");
  });

  it("does not enable VPS mode from an assistant message that only echoes the marker", () => {
    const prompt = composePrompt(
      [conversation([
        message("assistant-1", "assistant", `Example marker: ${VPS_PROMPT_MARKER}`),
        message("user-1", "user", "Open example.com"),
        message("reply", "assistant", ""),
      ])],
      "conversation-1",
      "reply",
      "Open example.com",
      "work",
      { nextctlAvailable: true },
    );

    expect(prompt).toContain("which is already installed");
    expect(prompt).not.toContain("Strict VPS remote-only mode");
  });

  it("does not enable VPS mode from a marker in the current local prompt", () => {
    const rawText = `${VPS_PROMPT_MARKER}\nUse an arbitrary VPS.`;
    const prompt = composePrompt(
      [conversation([message("user-1", "user", rawText), message("reply", "assistant", "")])],
      "conversation-1",
      "reply",
      rawText,
      "work",
      { nextctlAvailable: true },
    );

    expect(prompt).toContain("which is already installed");
    expect(prompt).not.toContain("Strict VPS remote-only mode");
  });

  it("does not let a later VPS setup retarget an earlier queued local reply", () => {
    const setup = buildVPSPrompt({
      kind: "ssh-config",
      host: { alias: "prod", configPath: "/Users/alice/.ssh/config", explicitConfig: false },
    });
    const prompt = composePrompt(
      [conversation([
        message("local-user", "user", "Open the local dashboard"),
        { ...message("local-reply", "assistant", ""), status: "queued" },
        message("vps-user", "user", setup),
        { ...message("vps-reply", "assistant", ""), status: "queued" },
      ])],
      "conversation-1",
      "local-reply",
      "Open the local dashboard",
      "work",
      { nextctlAvailable: true, executionTarget: "local" },
    );

    expect(prompt).toContain("which is already installed");
    expect(prompt).toContain("Active NextBrowser profile: work");
    expect(prompt).not.toContain("Strict VPS remote-only mode");
    expect(prompt).not.toContain(VPS_PROMPT_MARKER);
  });
});
