import type { Conversation } from "../types";
import type { ExecutionTarget } from "./executionTarget";
import { hasVPSPromptMarker } from "./vpsPrompt";

const LOCAL_NEXTCTL_PROMPT =
  "[You control the NextBrowser browser through the installed Clawbrowser CLI. " +
  "Prefer `nbc` when available and fall back to `nextctl`; check with " +
  "`command -v nbc || command -v nextctl`. Use that CLI to open pages, act on them, " +
  "and manage sessions/proxies. Run its `--help` if unsure of a subcommand. " +
  "In browser requests, a dotted hostname such as `999.md` is a website, not a local file; " +
  "open a bare hostname as `https://<host>` unless the user explicitly asks for a file or path. " +
  "Authentication is managed by NextBrowser: never search for, read, print, copy, " +
  "or ask the user to paste API keys or Clawbrowser configuration. On an authentication " +
  "error, retry once, then ask the user to reconnect their account in NextBrowser. " +
  "Browser tasks are browser-only: " +
  "do not scan the user's home directory, Library, Documents, Downloads, Desktop, mounted volumes, " +
  "media libraries, or other applications' data; do not use OS automation for Music or other apps. " +
  "Limit filesystem access to the current NextBrowser workspace and the specific agent/nextctl " +
  "configuration files needed to run the requested browser task. If a task genuinely needs a local " +
  "file outside the workspace, ask the user for that exact file instead of exploring folders.]";

const MISSING_LOCAL_NEXTCTL_PROMPT =
  "[NextBrowser is installed, but the local `nextctl`/Clawbrowser components are missing or not on PATH. " +
  "Before trying to browse, install `nextctl` and run `nextctl install --no-api-key-prompt`. " +
  "After install, use `nextctl` for browser control.]";

const VPS_NEXTCTL_PROMPT =
  "[Strict VPS remote-only mode is active for this conversation. Run every `nextctl`, Clawbrowser, " +
  "browser, profile, and session command on the selected VPS through SSH. Never run them on localhost " +
  "and never use or fall back to a local NextBrowser profile/session. Perform only a read-only remote " +
  "preflight, use `NEXTCTL_AUTO_UPDATE=0 nextctl version`, and prefix every later remote `nextctl` " +
  "invocation with `NEXTCTL_AUTO_UPDATE=0`. If remote nextctl or the existing Clawbrowser runtime is " +
  "missing or unusable, stop and tell the user to install Clawbrowser and nextctl on the VPS first. " +
  "Do not install, download, update, configure, initialize, repair, or start anything merely to test " +
  "readiness, and do not fall back to local execution.]";

export function composePrompt(
  conversations: Conversation[],
  conversationId: string,
  replyId: string,
  rawText: string,
  selectedProfile?: string,
  opts: { nextctlAvailable?: boolean; executionTarget?: ExecutionTarget } = {},
): string {
  const parts: string[] = [];
  const conv = conversations.find((c) => c.id === conversationId);
  const replyIndex = conv?.messages.findIndex((message) => message.id === replyId) ?? -1;
  const messagesBeforeReply = replyIndex >= 0
    ? conv?.messages.slice(0, replyIndex) ?? []
    : conv?.messages ?? [];
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
  if (remoteOnly) {
    parts.push(VPS_NEXTCTL_PROMPT);
    if (!hasVPSPromptMarker(rawText) && activeVPSInstructions) {
      parts.push(`Active VPS connection instructions:\n${activeVPSInstructions}`);
    }
  } else if (opts.nextctlAvailable === false) {
    parts.push(MISSING_LOCAL_NEXTCTL_PROMPT);
  } else {
    parts.push(LOCAL_NEXTCTL_PROMPT);
  }
  if (conv) {
    let prior = messagesBeforeReply.filter(
      (m) =>
        m.role !== "system" &&
        m.text.trim(),
    );
    const lastUser = prior.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user").pop();
    if (lastUser) prior = prior.filter((_, i) => i !== lastUser.i);
    if (remoteOnly) prior = prior.filter((message) => !hasVPSPromptMarker(message.text));
    const recent = prior.slice(-12);
    if (recent.length) {
      const lines = recent.map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
      );
      parts.push("Conversation so far:\n" + lines.join("\n\n"));
    }
  }
  if (selectedProfile && !remoteOnly) {
    parts.push(`[Active NextBrowser profile: ${selectedProfile}]`);
  }
  parts.push(rawText);
  return parts.join("\n\n---\n\n");
}
