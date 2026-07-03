import type { Conversation } from "../types";

export function composePrompt(
  conversations: Conversation[],
  conversationId: string,
  replyId: string,
  rawText: string,
  selectedProfile?: string,
): string {
  const parts: string[] = [];
  // Tell the agent, up front, which tool drives the browser. Claude Code / Codex
  // don't know about NextBrowser out of the box, so without this they try to
  // "open" a non-existent app and fail. clawctl is installed and authenticated.
  parts.push(
    "[You control the NextBrowser browser through the `clawctl` command-line tool, " +
      "which is already installed and signed in. Use it (e.g. `clawctl open <url>`, " +
      "`clawctl click`, `clawctl input`, `clawctl status`, `clawctl start`, " +
      "`clawctl rotate`) to open pages, act on them, and manage sessions/proxies. " +
      "Run `clawctl --help` if unsure of a subcommand.]",
  );
  const conv = conversations.find((c) => c.id === conversationId);
  if (conv) {
    let prior = conv.messages.filter(
      (m) => m.id !== replyId && m.role !== "system" && m.text.trim(),
    );
    const lastUser = prior.map((m, i) => ({ m, i })).filter(({ m }) => m.role === "user").pop();
    if (lastUser) prior = prior.filter((_, i) => i !== lastUser.i);
    const recent = prior.slice(-12);
    if (recent.length) {
      const lines = recent.map(
        (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.text}`,
      );
      parts.push("Conversation so far:\n" + lines.join("\n\n"));
    }
  }
  if (selectedProfile) parts.push(`[Active NextBrowser profile: ${selectedProfile}]`);
  parts.push(rawText);
  return parts.join("\n\n---\n\n");
}
