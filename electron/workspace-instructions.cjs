const fs = require("node:fs/promises");
const path = require("node:path");

const START = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS START -->";
const END = "<!-- NEXTBROWSER MANAGED INSTRUCTIONS END -->";
function managedInstructions(browserContext = "") {
  return `${START}
# NextBrowser browser workspace

- For browser tasks, use the connected NextBrowser MCP tools immediately when they are available. They reuse the selected profile's native control channel (Playwright for Camoufox, CDP where supported). Use the CLI only when MCP is unavailable; then prefer \`nbc\` and fall back to \`nextctl\`.
- Do not probe for the CLI, run a duplicate CLI \`start\`, or switch between CLI and MCP after a successful MCP call.
- Use the authoritative NextBrowser profile runtime context below when present. Never infer a profile's browser from generic MCP or nextctl profile metadata.
- Existing profiles in the current workspace always take priority. Match an explicitly named profile exactly, otherwise use the selected profile, otherwise use the sole available profile. If several profiles remain plausible, ask which existing profile to use. Never invent, clone, or create a profile merely from a site name or task; create one only when the user explicitly asks to create a profile, and direct that action through the NextBrowser UI.
- Start or reuse the requested profile exactly once. Pass the target URL to \`start\`; do not separately open the same URL unless navigation actually failed.
- Include \`wait_for: {"settle": true}\` and \`return_state: true\` in the same MCP \`start\` call when the next step needs page controls; do not issue separate \`wait\` and \`state\` calls.
- For catalogs, listings, and search results, use one \`paginate_extract\` call after the page is ready. Do not manually repeat \`scroll\` → \`wait\` → \`state\`; \`paginate_extract\` scrolls, waits, extracts, deduplicates, filters, and sorts in one operation.
- Combine actions with \`wait_for\` and \`return_state: true\` when another decision is needed. Do not wait for \`load\` after a plain scroll because scrolling does not navigate.
- Do not use another browser integration when the user asks for a specific runtime or profile.
- Do not read or invoke Chrome, browser-control, or another browser skill when a NextBrowser profile is available; the profile's saved runtime and NextBrowser MCP are authoritative.
- Inside NextBrowser, generic requests such as "open the browser", "use the browser", "открой браузер", or "используй браузер" use the selected profile from the authoritative workspace context below. If no profile is selected and exactly one profile is listed, use that sole profile and its saved runtime. Fall back to ClawBrowser only when no workspace profile context exists.
- Use an explicit named profile for commands that act on a browser.
- In a browser request, treat a dotted hostname such as \`999.md\` as a website, never as a local filename. Open bare hostnames as \`https://<host>\` unless the user explicitly says they mean a file or path.
- Authentication is managed by the NextBrowser app. Never search for, read, print, copy, or ask the user to paste API keys, tokens, environment variables, or browser configuration files.
- If a NextBrowser command reports an authentication error, retry that command once. If it still fails, ask the user to reconnect their account in NextBrowser; do not troubleshoot by inspecting secrets.
- Keep filesystem work inside this workspace unless the user explicitly supplies another exact path.
${browserContext.trim() ? `\n${browserContext.trim()}\n` : ""}
${END}`;
}

const MANAGED_INSTRUCTIONS = managedInstructions();

function mergeManagedInstructions(existing = "", browserContext = "") {
  const instructions = managedInstructions(browserContext);
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  if (start >= 0 && end >= start) {
    return `${existing.slice(0, start)}${instructions}${existing.slice(end + END.length)}`;
  }
  return existing.trim()
    ? `${instructions}\n\n${existing}`
    : `${instructions}\n`;
}

async function ensureWorkspaceInstructions(workspaceDir, browserContext = "") {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const file = path.join(workspaceDir, name);
    let existing = "";
    try {
      existing = await fs.readFile(file, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const next = mergeManagedInstructions(existing, browserContext);
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
