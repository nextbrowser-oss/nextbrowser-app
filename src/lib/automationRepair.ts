const REPAIRABLE_STEP_TOOLS = new Set([
  "open", "navigate", "click", "input", "press", "select", "wait", "scroll", "dismiss", "upload",
  "extract", "paginate_extract", "tabs_extract", "form_fill", "multi_action",
  "site_recipe_run", "act", "evaluate", "save_artifact",
]);

const INFRASTRUCTURE_FAILURE = /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|account token|authentication|reconnect|backend|fetch failed|network|proxy|profile|session|runtime (?:launch|startup|exited|unavailable)|launch failed|cdp|browser exited|cancelled|canceled|stopped by user)/i;
const USER_INTERVENTION_FAILURE = /(?:captcha|two[- ]factor|\b2fa\b|one[- ]time (?:code|password)|verification code|access denied|account locked|rate limit)/i;
const ARTIFACT_REPAIRABLE_FAILURE = /(?:dataset|rows?|field|contract|missing|populated|empty|previous step|completed workflow result|named datasets?)/i;
const REPAIRABLE_TOOLS = new Set(REPAIRABLE_STEP_TOOLS);
export const AUTOMATION_REPAIR_MARKER = "NEXTBROWSER_REPAIRED_RECIPE:";

export interface RepairedAutomationRecipe {
  version: 1;
  actions: Array<{ tool: string; arguments: Record<string, unknown> }>;
}

function firstJsonObject(raw: string): unknown {
  const marker = raw.indexOf(AUTOMATION_REPAIR_MARKER);
  if (marker < 0) return undefined;
  const start = raw.indexOf("{", marker + AUTOMATION_REPAIR_MARKER.length);
  if (start < 0) return undefined;
  let depth = 0; let quoted = false; let escaped = false;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try { return JSON.parse(raw.slice(start, index + 1)); } catch { return undefined; }
    }
  }
  return undefined;
}

function actionOrigins(actions: RepairedAutomationRecipe["actions"]): Set<string> {
  const origins = new Set<string>();
  for (const action of actions) {
    if (!["open", "navigate"].includes(action.tool) || typeof action.arguments.url !== "string") continue;
    try { origins.add(new URL(action.arguments.url).origin); } catch { /* workflow validation reports malformed URLs */ }
  }
  return origins;
}

export function parseAutomationRepairRecipe(raw: string, originalActions: RepairedAutomationRecipe["actions"] = []): RepairedAutomationRecipe | undefined {
  const value = firstJsonObject(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.actions) || !record.actions.length || record.actions.length > 100) return undefined;
  const actions: RepairedAutomationRecipe["actions"] = [];
  for (const item of record.actions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const action = item as Record<string, unknown>;
    const tool = typeof action.tool === "string" ? action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, "") : "";
    if (!REPAIRABLE_TOOLS.has(tool) || !action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) return undefined;
    actions.push({ tool, arguments: structuredClone(action.arguments as Record<string, unknown>) });
  }
  const originalOrigins = actionOrigins(originalActions);
  if (originalOrigins.size) {
    const repairedOrigins = actionOrigins(actions);
    if ([...repairedOrigins].some((origin) => !originalOrigins.has(origin))) return undefined;
  }
  const expectedArtifact = [...originalActions].reverse().find((action) => action.tool === "save_artifact")?.arguments.name;
  if (typeof expectedArtifact === "string" && !actions.some((action) => action.tool === "save_artifact" && action.arguments.name === expectedArtifact)) return undefined;
  return { version: 1, actions };
}

export function automationRepairTask(
  task: string,
  actions: RepairedAutomationRecipe["actions"],
  failedStep: number | undefined,
  error: string,
): string {
  const failedAction = failedStep == null ? undefined : actions[failedStep];
  return `${task}\n\nThe fast deterministic replay failed${failedStep == null ? "" : ` at step ${failedStep + 1}`}: ${error}.
Complete the original user goal in the current browser. Inspect the live page and adapt stale URLs, locators, waits, extraction fields, or read-only page scripts as needed. Do not stop after explaining the failure.
The repaired path must stay on the same website origins already present in the workflow and must preserve the requested Artifact Center file name and output shape.
After the task succeeds, include one final machine-readable line containing only this marker followed by the exact successful deterministic recipe:
${AUTOMATION_REPAIR_MARKER} {"version":1,"actions":[{"tool":"wait","arguments":{"selector":"body"}}]}
Include the complete successful action list, not only the changed step. Use only browser actions and save_artifact; omit profile/session lifecycle, state inspection, shell, curl, credentials, result values, and failed attempts.
Evaluate steps must remain read-only. For a JSON API already open in the browser, a GET of exactly fetch(location.href) is allowed; never fetch another URL or specify a method, body, headers, or credentials.

Original recipe:
${JSON.stringify({ version: 1, actions }, null, 2)}${failedAction ? `\n\nFailed action:\n${JSON.stringify(failedAction, null, 2)}` : ""}`;
}

export function shouldAutoRepairAutomation(tool: string | undefined, error: unknown): boolean {
  const normalizedTool = String(tool || "").replace(/^(?:clawbrowser|nextbrowser)\./, "");
  if (!REPAIRABLE_STEP_TOOLS.has(normalizedTool)) return false;
  const message = error instanceof Error ? error.message : String(error || "");
  if (!message || INFRASTRUCTURE_FAILURE.test(message) || USER_INTERVENTION_FAILURE.test(message)) return false;
  return normalizedTool !== "save_artifact" || ARTIFACT_REPAIRABLE_FAILURE.test(message);
}
