const fs = require("node:fs/promises");
const path = require("node:path");

const START = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS START -->";
const END = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS END -->";
const MANAGED_INSTRUCTIONS = `${START}
# NextBrowser browser workspace

- For browser tasks, use the installed Clawbrowser CLI immediately. Prefer \`nbc\` when available and fall back to \`nextctl\`; check with \`command -v nbc || command -v nextctl\`.
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
