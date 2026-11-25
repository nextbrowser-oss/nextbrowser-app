import type { Conversation } from "../types";
import type { ExecutionTarget } from "./executionTarget";
import { hasVPSPromptMarker } from "./vpsPrompt";

const LOCAL_NEXTCTL_PROMPT =
  "[You control the Nextbrowser browser through the installed Clawbrowser CLI. " +
  "Prefer `nbc` when available and fall back to `nextctl`; check with " +
  "`command -v nbc || command -v nextctl`. Use that CLI to open pages, act on them, " +
  "and manage sessions/proxies. Run its `--help` if unsure of a subcommand. " +
  "Inside Nextbrowser, generic requests such as `open the browser`, `use the browser`, " +
  "`открой браузер`, or `используй браузер` use the active profile from the authoritative " +
  "workspace profile context below. If no profile is selected and exactly one profile is " +
  "listed, use that sole profile and its saved runtime. Fall back to ClawBrowser only when " +
  "the workspace has no profile context. " +
  "In browser requests, a dotted hostname such as `999.md` is a website, not a local file; " +
  "open a bare hostname as `https://<host>` unless the user explicitly asks for a file or path. " +
  "Authentication is managed by Nextbrowser: never search for, read, print, copy, " +
  "or ask the user to paste API keys or Clawbrowser configuration. On an authentication " +
  "error, retry once, then ask the user to reconnect their account in Nextbrowser. " +
  "Browser tasks are browser-only: " +
  "do not scan the user's home directory, Library, Documents, Downloads, Desktop, mounted volumes, " +
  "media libraries, or other applications' data; do not use OS automation for Music or other apps. " +
  "Limit filesystem access to the current Nextbrowser workspace and the specific agent/nextctl " +
  "configuration files needed to run the requested browser task. If a task genuinely needs a local " +
  "file outside the workspace, ask the user for that exact file instead of exploring folders.]";

const MISSING_LOCAL_NEXTCTL_PROMPT =
  "[Nextbrowser is installed, but the local `nextctl`/Clawbrowser components are missing or not on PATH. " +
  "Before trying to browse, install `nextctl` and run `nextctl install --no-api-key-prompt`. " +
  "After install, use `nextctl` for browser control.]";

const VPS_NEXTCTL_PROMPT =
  "[Strict VPS remote-only mode is active for this conversation. Run every `nextctl`, Clawbrowser, " +
  "browser, profile, and session command on the selected VPS through SSH. Never run them on localhost " +
  "and never use or fall back to a local Nextbrowser profile/session. Perform only a read-only remote " +
  "preflight, use `NEXTCTL_AUTO_UPDATE=0 nextctl version`, and prefix every later remote `nextctl` " +
  "invocation with `NEXTCTL_AUTO_UPDATE=0`. If remote nextctl or the existing Clawbrowser runtime is " +
  "missing or unusable, stop and tell the user to install Clawbrowser and nextctl on the VPS first. " +
  "Do not install, download, update, configure, initialize, repair, or start anything merely to test " +
  "readiness, and do not fall back to local execution.]";

/** Only messages preceding the user turn paired with this reply belong to its history. */
export function recentChatHistory(conversation: Conversation | undefined, replyId: string, remoteOnly = false) {
  const messages = conversation?.messages ?? [];
  const end = messages.findIndex(message => message.id === replyId);
  const beforeReply = end < 0 ? messages : messages.slice(0, end);
  const userIndex = beforeReply.map(message => message.role).lastIndexOf("user");
  return beforeReply.slice(0, userIndex < 0 ? beforeReply.length : userIndex)
    .flatMap(({ role, text }) => (role === "user" || role === "assistant") && text.trim() &&
      !(remoteOnly && hasVPSPromptMarker(text)) ? [{ role, content: text }] : [])
    .slice(-12);
}

export function composePrompt(
  conversations: Conversation[],
  conversationId: string,
  replyId: string,
  rawText: string,
  selectedProfile?: string,
  opts: { nextctlAvailable?: boolean; executionTarget?: ExecutionTarget; builtinAgent?: boolean } = {},
): string {
  const parts: string[] = [];
  const conv = conversations.find((c) => c.id === conversationId);
  const remoteOnly = opts.executionTarget != null
    ? opts.executionTarget === "vps"
    : conv?.executionTarget === "vps";
  const storedVPSInstructions = conv?.vpsConnectionInstructions &&
    hasVPSPromptMarker(conv.vpsConnectionInstructions)
    ? conv.vpsConnectionInstructions
    : undefined;
  const activeVPSInstructions = storedVPSInstructions;
  // Tell the connected CLI, up front, which tool drives the browser. Without
  // this context it may try to "open" a non-existent app and fail.
  // The built-in agent drives the browser through its tools alone; its system
  // prompt says how. The CLI instructions would send it looking for a shell.
  if (opts.builtinAgent) {
    // Nothing to add.
  } else if (remoteOnly) {
    parts.push(VPS_NEXTCTL_PROMPT);
    if (!hasVPSPromptMarker(rawText) && activeVPSInstructions) {
      parts.push(`Active VPS connection instructions:\n${activeVPSInstructions}`);
    }
  } else if (opts.nextctlAvailable === false) {
    parts.push(MISSING_LOCAL_NEXTCTL_PROMPT);
  } else {
    parts.push(LOCAL_NEXTCTL_PROMPT);
  }
  if (!opts.builtinAgent) {
    parts.push("If a website requires a CAPTCHA or another interactive browser verification, stop the affected task. " +
      "Tell the user which page needs their attention, ask them to complete the check in the browser, and wait for them to tell you to continue. " +
      "If the browser reports a proxy connection failure, stop browser work and report the failure and the affected profile.");
  }
  if (!opts.builtinAgent) {
    const recent = recentChatHistory(conv, replyId, remoteOnly);
    if (recent.length) {
      const lines = recent.map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
      );
      parts.push("Conversation so far:\n" + lines.join("\n\n"));
    }
  }
  if (selectedProfile && !remoteOnly) {
    parts.push(`[Active Nextbrowser profile: ${selectedProfile}]`);
  }
  parts.push(rawText);
  return parts.join("\n\n---\n\n");
}
