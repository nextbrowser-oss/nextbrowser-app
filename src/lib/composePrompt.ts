import type { Conversation } from "../types";

export function composePrompt(
  conversations: Conversation[],
  conversationId: string,
  replyId: string,
  rawText: string,
  selectedProfile?: string,
  opts: { clawctlAvailable?: boolean } = {},
): string {
  const parts: string[] = [];
  // Tell the connected CLI, up front, which tool drives the browser. Without
  // this context it may try to "open" a non-existent app and fail.
  if (opts.clawctlAvailable === false) {
    parts.push(
      "[NextBrowser is installed, but the local `clawctl`/Clawbrowser components are missing or not on PATH. " +
        "Before trying to browse, install `clawctl` and run `clawctl install --no-api-key-prompt`. " +
        "After install, use `clawctl` for browser control.]",
    );
  } else {
    parts.push(
      "[You control the NextBrowser browser through the `clawctl` command-line tool, " +
        "which is already installed. Use it (e.g. `clawctl open <url>`, " +
        "`clawctl click`, `clawctl input`, `clawctl status`, `clawctl start`, " +
        "`clawctl rotate`) to open pages, act on them, and manage sessions/proxies. " +
        "Run `clawctl --help` if unsure of a subcommand.]",
    );
  }
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
