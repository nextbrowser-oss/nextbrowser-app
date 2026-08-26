const PROMPT_MARKER = /^\s*›\s*(.+)$/gm;
const CLAWBROWSER_CALL = /(?:clawbrowser|nextbrowser)\.([a-z_]+)/g;
const MAX_RECORDED_ACTIONS = 100;
const REPLAYABLE_TOOLS = new Set([
  "open", "navigate", "click", "input", "press", "select", "scroll", "dismiss", "wait",
  "act", "multi_action", "form_fill", "upload", "extract", "paginate_extract", "tabs_extract", "site_recipe_run",
  "evaluate", "save_artifact",
]);

export interface CapturedCall {
  name: string;
  args: Record<string, unknown>;
  start: number;
  end: number;
  score: number;
}

function capturedCalls(transcript: string): CapturedCall[] {
  const calls: CapturedCall[] = [];
  for (const match of transcript.matchAll(CLAWBROWSER_CALL)) {
    const name = match[1];
    const open = transcript.indexOf("(", (match.index ?? 0) + match[0].length);
    if (open < 0) continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    let close = -1;
    for (let index = open; index < transcript.length; index += 1) {
      const char = transcript[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === "(") depth += 1;
      else if (char === ")" && --depth === 0) {
        close = index;
        break;
      }
    }
    if (close < 0) continue;
    try {
      const args = JSON.parse(transcript.slice(open + 1, close)) as Record<string, unknown>;
      calls.push({ name, args, start: match.index ?? 0, end: close + 1, score: 0 });
    } catch {
      // Truncated calls still contribute their tool name to the generic workflow.
    }
  }
  return calls.map((call, index) => {
    // Tool status is emitted immediately after the call. Do not classify the
    // complete assistant answer: extracted page content may legitimately contain
    // words such as "failed" or "error" and would create a false failure.
    const result = transcript.slice(call.end, calls[index + 1]?.start ?? transcript.length).slice(0, 512);
    let score = 0;
    if (/\b(error|failed|failure)\b/i.test(result) || /"(?:count|executed)"\s*:\s*0\b/.test(result) || /"rows"\s*:\s*\[\s*\]/.test(result)) score -= 10;
    if (/"ok"\s*:\s*true/.test(result) || /"count"\s*:\s*[1-9]\d*/.test(result) || /"rows"\s*:\s*\[\s*\{/.test(result) || /Наш[её]л|found\s+[1-9]/i.test(result)) score += 10;
    return { ...call, score };
  });
}

export type WorkflowCapability = "scrape" | "search" | "posting" | "form" | "navigation" | "other";

export function workflowCapability(task: string, transcript: string): WorkflowCapability {
  const tools = capturedCalls(transcript).map((call) => call.name);
  if (/\b(post|publish|comment|reply|send)\b|опубли|отправ|коммент/i.test(task)) return "posting";
  if (tools.some((tool) => ["paginate_extract", "extract", "evaluate"].includes(tool))) return /\b(find|search)\b|найди|поиск/i.test(task) ? "search" : "scrape";
  if (tools.some((tool) => ["act", "input", "upload"].includes(tool))) return "form";
  if (tools.some((tool) => ["open", "navigate", "click", "press"].includes(tool))) return "navigation";
  return "other";
}

export function workflowRecipe(task: string, transcript: string) {
  const capability = workflowCapability(task, transcript);
  const actions = optimizedReplayableActions(transcript).slice(0, MAX_RECORDED_ACTIONS);
  return { version: 1 as const, capability, actions };
}

/** All task-relevant calls, used to explain a recording without exposing setup noise. */
export function recordedBrowserActions(transcript: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  return optimizedReplayableActions(transcript);
}

/** Raw successful calls are used while merging page events with agent telemetry. */
export function rawRecordedBrowserActions(transcript: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  return replayableCalls(transcript).map(({ name, args }) => ({ tool: name, arguments: args }));
}

function replayableCalls(transcript: string): CapturedCall[] {
  return capturedCalls(transcript).filter((call) => REPLAYABLE_TOOLS.has(call.name) && call.score >= 0);
}

const DATA_TOOLS = new Set(["evaluate", "extract", "paginate_extract", "tabs_extract"]);

function selectorFromDataCall(call: CapturedCall): string | undefined {
  if (typeof call.args.container === "string" && call.args.container.trim()) return call.args.container.trim();
  if (call.name !== "evaluate" || typeof call.args.expression !== "string") return undefined;
  return call.args.expression.match(/querySelector(?:All)?\(\s*(['"`])([^'"`]+)\1\s*\)/)?.[2];
}

/** Keep the result of selector discovery, not every exploratory probe the agent made. */
function optimizedReplayableActions(transcript: string): Array<{ tool: string; arguments: Record<string, unknown> }> {
  const calls = replayableCalls(transcript);
  const optimized: CapturedCall[] = [];
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const previous = optimized.at(-1);
    if (["open", "navigate"].includes(call.name) && previous && ["open", "navigate"].includes(previous.name)) {
      // Redirect recovery and the page that was open before recording can
      // produce adjacent navigations. Nothing consumed the first page, so the
      // last target is the only deterministic replay step.
      optimized[optimized.length - 1] = call;
      continue;
    }
    if (call.name === "click" && typeof call.args.selector === "string"
      && /^(?:button|a|input|div|span)$/i.test(call.args.selector.trim())) {
      // A bare tag selects an arbitrary first element and can change with any
      // layout update. Omit it from generated workflows; users can pick the
      // intended element visually if the interaction is actually required.
      continue;
    }
    if (!DATA_TOOLS.has(call.name)) {
      optimized.push(call);
      continue;
    }
    let finalDataCall = call;
    while (index + 1 < calls.length && DATA_TOOLS.has(calls[index + 1].name)) finalDataCall = calls[++index];
    const dataPrevious = optimized.at(-1);
    const selector = selectorFromDataCall(finalDataCall);
    if (selector && dataPrevious && ["open", "navigate", "click", "press", "select"].includes(dataPrevious.name)) {
      optimized.push({ name: "wait", args: { selector, timeout: 30 }, start: finalDataCall.start, end: finalDataCall.start, score: 10 });
    }
    optimized.push(finalDataCall);
  }
  return optimized.map(({ name, args }) => ({ tool: name, arguments: args }));
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function best(calls: CapturedCall[]): CapturedCall | undefined {
  return calls.reduce<CapturedCall | undefined>((selected, call) =>
    !selected || call.score >= selected.score ? call : selected, undefined);
}

function selectedFastPath(transcript: string): CapturedCall[] {
  const calls = capturedCalls(transcript);
  return [
    best(calls.filter((call) => ["start", "prepare"].includes(call.name))),
    best(calls.filter((call) => ["open", "navigate"].includes(call.name))),
    best(calls.filter((call) => ["act", "multi_action", "input", "click", "press"].includes(call.name))),
    best(calls.filter((call) => ["paginate_extract", "extract"].includes(call.name))),
  ].filter((call): call is CapturedCall => !!call && call.score >= 0);
}

function fastPath(transcript: string): string[] {
  return replayableCalls(transcript).slice(0, MAX_RECORDED_ACTIONS).flatMap(({ name, args }) => {
    if (name === "multi_action") {
      return [`clawbrowser.multi_action(${JSON.stringify(pick(args, ["actions", "stop_on_navigation", "wait_for", "state_mode"]))})`];
    }
    if (["open", "navigate"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["url", "new_tab", "wait_for"]))})`];
    }
    if (["paginate_extract", "extract"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["container", "fields", "filters", "dedupe_by", "transform", "scroll", "max_pages", "limit", "initial_wait", "timeout"]))})`];
    }
    return [`clawbrowser.${name}(${JSON.stringify(args)})`];
  });
}

export function workflowDomain(text: string): string {
  const explicit = text.match(/https?:\/\/(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[/:?#\s]|$)/i);
  if (explicit?.[1]) return explicit[1].toLowerCase();
  const bare = text.match(/\b(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[/:?#\s]|$)/i);
  return bare?.[1]?.toLowerCase() ?? "";
}

const INTERNAL_BROWSER_HOSTS = new Set([
  "app.clawbrowser.ai",
  "api.nextbrowser.com",
  "app.nextbrowser.com",
]);

function publicDomainFromURL(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (host === "localhost" || host === "127.0.0.1" || INTERNAL_BROWSER_HOSTS.has(host)) return "";
    return workflowDomain(host);
  } catch {
    return "";
  }
}

function publicDomainsInText(text: string): string[] {
  const domains: string[] = [];
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    const domain = publicDomainFromURL(match[0].replace(/[.,;:!?]+$/, ""));
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

/** Resolve the task's website without accidentally selecting verification/API URLs from tool output. */
export function capturedWorkflowDomain(task: string, transcript: string): string {
  // An explicit URL in the request is authoritative. For bare dotted tokens,
  // prefer the URL that was actually opened: artifact names such as report.csv
  // otherwise look like hostnames and leak into recording cards and titles.
  const explicitRequested = publicDomainsInText(task)[0];
  if (explicitRequested) return explicitRequested;
  for (const call of capturedCalls(transcript)) {
    const domain = publicDomainFromURL(call.args.url);
    if (domain) return domain;
  }
  const requested = workflowDomain(task);
  if (requested) return requested;
  // Normal chat messages may keep tool events outside the rendered answer. Result
  // links are still a reliable fallback once internal verification hosts are removed.
  return publicDomainsInText(transcript)[0] ?? "";
}

export function workflowQuality(task: string, transcript: string, domain = capturedWorkflowDomain(task, transcript)): { reusable: boolean; reason: string } {
  if (!domain) return { reusable: false, reason: "The website could not be identified." };
  if (transcript.includes("{{redacted}}")) return { reusable: false, reason: "The run contained credentials or payment data. It was redacted and cannot be saved as a replayable workflow." };
  const calls = capturedCalls(transcript);
  if (calls.length === 0) return { reusable: false, reason: "No browser actions were captured." };
  const meaningful = replayableCalls(transcript);
  if (meaningful.length === 0) return { reusable: false, reason: "The run only inspected the browser and did not perform a reusable task." };
  if (meaningful.length > MAX_RECORDED_ACTIONS) return { reusable: false, reason: `The run contains more than ${MAX_RECORDED_ACTIONS} browser actions. Split it into smaller workflows.` };
  const last = calls.at(-1);
  if (last && last.score < 0) return { reusable: false, reason: "The browser workflow ended with a failed action." };
  const successfulExtraction = calls.some((call) => ["extract", "paginate_extract", "evaluate"].includes(call.name) && call.score > 0);
  const postingConfirmation = /\b(posted|published|submitted|saved draft|commented|sent successfully)\b|опубликован|отправлен|сохран[её]н\s+черновик/i.test(transcript);
  const interaction = calls.some((call) => ["act", "multi_action", "input", "click", "press", "upload"].includes(call.name));
  const navigation = calls.some((call) => ["start", "prepare", "open", "navigate"].includes(call.name));
  if (!successfulExtraction && !postingConfirmation && !(interaction && navigation)) {
    return { reusable: false, reason: "No successful extraction, posting confirmation, or complete browser interaction was captured." };
  }
  return { reusable: true, reason: "The trace contains a completed, repeatable browser workflow." };
}

export function terminalBrowserTask(transcript: string): string {
  const lastTool = Math.max(
    transcript.lastIndexOf("clawbrowser."),
    transcript.lastIndexOf("nextbrowser."),
    transcript.lastIndexOf("nbc "),
    transcript.lastIndexOf("nextctl "),
  );
  if (lastTool < 0) return "";
  const beforeTool = transcript.slice(0, lastTool);
  const prompts = [...beforeTool.matchAll(PROMPT_MARKER)];
  return prompts.at(-1)?.[1]?.trim() ?? "";
}

export function workflowTitle(task: string, domain: string): string {
  const subject = task.match(/(?:найди|find|search(?:\s+for)?)\s+(?:все\s+|all\s+)?(.+?)(?:\s+(?:на|on|with|с)\s+|$)/i)?.[1]
    ?.replace(/[.,;:!?]+$/g, "")
    .trim();
  if (domain && subject) return `${domain} — ${subject}`.slice(0, 64);
  if (domain) return `${domain} browser workflow`;
  return "Browser workflow";
}

export function workflowInstructions(task: string, transcript: string): string {
  const tools = [...transcript.matchAll(CLAWBROWSER_CALL)].map((match) => match[1]);
  const unique = tools.filter((tool, index) => tools.indexOf(tool) === index);
  const steps: string[] = [];
  if (unique.some((tool) => ["open", "navigate"].includes(tool))) {
    steps.push("Open the target website in the verified browser session.");
  }
  if (unique.some((tool) => ["act", "multi_action", "input", "click", "press"].includes(tool))) {
    steps.push("Use the site's controls to apply the requested search and filters, waiting for navigation or page settlement when needed.");
  }
  const selected = selectedFastPath(transcript);
  const hasSearchAction = selected.some((call) => ["act", "multi_action", "input", "click", "press"].includes(call.name));
  const selectedURL = selected
    .map((call) => typeof call.args.url === "string" ? call.args.url : "")
    .find((url) => /[?&](?:q|query|search)=/i.test(url));
  const searchTask = /\b(find|search)\b|найди|поиск/i.test(task);
  if (searchTask && !hasSearchAction && !selectedURL) {
    steps.push("Before extraction, apply the requested search on the site and wait until the results page is loaded; the recorded run started from browser state that was not fully self-contained.");
  }
  if (unique.some((tool) => ["paginate_extract", "extract", "evaluate", "state"].includes(tool))) {
    steps.push("Extract all matching results, paginate or scroll as needed, deduplicate by canonical URL, and exclude irrelevant matches.");
  }
  steps.push("Return a concise result list with titles, URLs, and the important details requested by the user.");
  const calls = fastPath(transcript);
  const hasElementHints = calls.some((call) => call.includes('"element_id"'));
  const incomplete = searchTask && !hasSearchAction && !selectedURL;
  const technical = calls.length
    ? `\n\nTechnical fast path:\nRun these operations in order. Reuse the saved arguments first; inspect the page and adapt only if an operation fails or the page structure changed.\n\n${calls.map((call, index) => `${index + 1}. ${call}`).join("\n")}${incomplete ? "\n\nThis fast path is partial: reproduce the requested site search before running extraction." : ""}${hasElementHints ? "\n\nTreat saved element_id values as short-lived hints. Resolve the element again by role, label, text, or selector if the id no longer matches." : ""}`
    : "";
  return `Task pattern:\n${task || "Repeat the saved browser task on the selected website."}\n\nWorkflow:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}${technical}`;
}
