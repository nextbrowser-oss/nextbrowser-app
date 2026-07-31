const fs = require("node:fs/promises");
const path = require("node:path");

const START = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS START -->";
const END = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS END -->";
const MANAGED_INSTRUCTIONS = `${START}
# NextBrowser browser workspace

- For browser tasks, use the connected Clawbrowser MCP tools immediately when they are available. They keep one CDP connection warm. Use the CLI only when MCP is unavailable; then prefer \`nbc\` and fall back to \`nextctl\`.
- Do not probe for the CLI, run a duplicate CLI \`start\`, or switch between CLI and MCP after a successful MCP call.
- Clawbrowser is the only browser integration enabled in Terminal Chat. Read only its browser skill; do not search for or read instructions for another browser integration.
- Start or reuse the requested profile exactly once. Pass the target URL to \`start\`; do not separately open the same URL unless navigation actually failed.
- Include \`wait_for: {"settle": true}\` and \`return_state: true\` in the same MCP \`start\` call when the next step needs page controls; do not issue separate \`wait\` and \`state\` calls.
- For catalogs, listings, and search results, use one \`paginate_extract\` call after the page is ready. Do not manually repeat \`scroll\` → \`wait\` → \`state\`; \`paginate_extract\` scrolls, waits, extracts, deduplicates, filters, and sorts in one operation.
- Combine actions with \`wait_for\` and \`return_state: true\` when another decision is needed. Do not wait for \`load\` after a plain scroll because scrolling does not navigate.
- Do not use another browser integration when the user asks for Clawbrowser or when the task is being run inside NextBrowser.
- Inside NextBrowser, generic requests such as "open the browser", "use the browser", "открой браузер", or "используй браузер" mean Clawbrowser. Use another browser only when the user explicitly names it.
- Use an explicit named profile for commands that act on a browser.
- In a browser request, treat a dotted hostname such as \`999.md\` as a website, never as a local filename. Open bare hostnames as \`https://<host>\` unless the user explicitly says they mean a file or path.
- Authentication is managed by the NextBrowser app. Never search for, read, print, copy, or ask the user to paste API keys, tokens, environment variables, or Clawbrowser configuration files.
- If a Clawbrowser command reports an authentication error, retry that command once. If it still fails, ask the user to reconnect their account in NextBrowser; do not troubleshoot by inspecting secrets.
- Keep filesystem work inside this workspace unless the user explicitly supplies another exact path.
${END}`;

function mergeManagedInstructions(existing = "") {
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${MANAGED_INSTRUCTIONS}${existing.slice(end + END.length)}`;
  }
  return existing.trim()
    ? `${MANAGED_INSTRUCTIONS}\n\n${existing}`
    : `${MANAGED_INSTRUCTIONS}\n`;
}

async function ensureWorkspaceInstructions(workspaceDir) {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(workspaceDir, name);
    let existing = "";
    try {
      existing = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const next = mergeManagedInstructions(existing);
    if (next !== existing) await fs.writeFile(file, next, "utf8");
  }
}

module.exports = {
  END,
  MANAGED_INSTRUCTIONS,
  START,
  ensureWorkspaceInstructions,
  mergeManagedInstructions,
};
