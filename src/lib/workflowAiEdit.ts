import type { BrowserSkillCapability, BrowserWorkflowAction, BrowserWorkflowSkill } from "../types";

export interface WorkflowAiEdit {
  title: string;
  domain: string;
  task: string;
  capability: BrowserSkillCapability;
  actions: BrowserWorkflowAction[];
  summary: string;
}

const CAPABILITIES = new Set<BrowserSkillCapability>(["scrape", "search", "posting", "form", "navigation", "other"]);

function firstJsonObject(raw: string): unknown {
  for (const match of raw.matchAll(/\{/g)) {
    const start = match.index ?? -1;
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
        try { return JSON.parse(raw.slice(start, index + 1)); } catch { break; }
      }
    }
  }
  return undefined;
}

export function workflowAiEditPrompt(workflow: BrowserWorkflowSkill, request: string): string {
  return `You edit a deterministic browser workflow. Do not call tools, browse, inspect files, or explain outside JSON.

Return exactly one JSON object with: title, domain, task, capability, actions, summary.

Rules:
- Apply only the requested change. Preserve working actions and selectors unless the request requires changing them.
- actions must be an array of deterministic steps shaped as {"tool":"...","arguments":{...}}.
- Allowed tools: navigate, open, input, click, press, select, wait, scroll, dismiss, upload, extract, paginate_extract, tabs_extract, form_fill, multi_action, site_recipe_run, act, evaluate, save_artifact.
- Preserve a proven read-only evaluate step when the recorded site needs a page data script. Never add network, cookies/storage access, clicks, form submission, or DOM mutation to it.
- After navigating to dynamic content, add a wait step for the exact result selector before extract/evaluate. A page data script must throw when its required container is missing or when it would return only empty rows.
- Never add an AI/prompt/agent step to the runtime. AI edits the recipe now; replay remains deterministic.
- For extract/paginate_extract/tabs_extract, include container and named fields. Prefer selectors already proven in the current workflow.
- Keep Artifact Center output local. If multiple extracted datasets must be stored together, use save_artifact with source "run_results", format "json".
- Keep the same domain unless the request explicitly changes the website.
- Never add credentials, tokens, cookies, payment data, profile/session lifecycle steps, or results copied from a previous run.
- summary must be one short sentence describing the recipe changes.
- Do not wrap the JSON in markdown.

Requested change:
${request.trim()}

Current workflow:
${JSON.stringify({ title: workflow.title, domain: workflow.domain, task: workflow.task, capability: workflow.capability, actions: workflow.actions }, null, 2)}`;
}

export function parseWorkflowAiEdit(raw: string): WorkflowAiEdit | undefined {
  const value = firstJsonObject(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const domain = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";
  const task = typeof record.task === "string" ? record.task.trim() : "";
  const capability = typeof record.capability === "string" && CAPABILITIES.has(record.capability as BrowserSkillCapability)
    ? record.capability as BrowserSkillCapability : undefined;
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 240) : "";
  if (!title || !task || !capability || !Array.isArray(record.actions) || !record.actions.length || record.actions.length > 100) return undefined;
  const actions: BrowserWorkflowAction[] = [];
  for (const item of record.actions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const action = item as Record<string, unknown>;
    if (typeof action.tool !== "string" || !action.tool.trim() || !action.arguments || typeof action.arguments !== "object" || Array.isArray(action.arguments)) return undefined;
    actions.push({ tool: action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, ""), arguments: structuredClone(action.arguments as Record<string, unknown>) });
  }
  return { title, domain, task, capability, actions, summary: summary || "Workflow steps updated with AI." };
}
