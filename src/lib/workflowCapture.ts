const PROMPT_MARKER = /^\s*›\s*(.+)$/gm;
const CLAWBROWSER_CALL = /clawbrowser\.([a-z_]+)/g;

interface CapturedCall {
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
    const result = transcript.slice(call.end, calls[index + 1]?.start ?? transcript.length);
    let score = 0;
    if (/\b(error|failed|failure)\b/i.test(result) || /"(?:count|executed)"\s*:\s*0\b/.test(result) || /"rows"\s*:\s*\[\s*\]/.test(result)) score -= 10;
    if (/"ok"\s*:\s*true/.test(result) || /"count"\s*:\s*[1-9]\d*/.test(result) || /"rows"\s*:\s*\[\s*\{/.test(result) || /Наш[её]л|found\s+[1-9]/i.test(result)) score += 10;
    return { ...call, score };
  });
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
    best(calls.filter((call) => ["multi_action", "input", "click", "press"].includes(call.name))),
    best(calls.filter((call) => ["paginate_extract", "extract"].includes(call.name))),
  ].filter((call): call is CapturedCall => !!call && call.score >= 0);
}

function fastPath(transcript: string): string[] {
  return selectedFastPath(transcript).flatMap(({ name, args }) => {
    if (["start", "prepare"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["profile", "country", "url", "verify", "wait_for"]))})`];
    }
    if (name === "multi_action") {
      return [`clawbrowser.multi_action(${JSON.stringify(pick(args, ["actions", "stop_on_navigation", "wait_for", "state_mode"]))})`];
    }
    if (["open", "navigate"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["url", "new_tab", "wait_for"]))})`];
    }
    if (["paginate_extract", "extract"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["container", "fields", "filters", "dedupe_by", "transform", "scroll", "max_pages", "limit", "initial_wait", "timeout"]))})`];
    }
    return [];
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

/** Resolve the task's website without accidentally selecting verification/API URLs from tool output. */
export function capturedWorkflowDomain(task: string, transcript: string): string {
  const requested = workflowDomain(task);
  if (requested) return requested;
  for (const call of capturedCalls(transcript)) {
    const domain = publicDomainFromURL(call.args.url);
    if (domain) return domain;
  }
  return "";
}

export function terminalBrowserTask(transcript: string): string {
  const lastTool = Math.max(
    transcript.lastIndexOf("clawbrowser."),
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
  if (unique.includes("start") || unique.includes("prepare")) {
    steps.push("Start or reattach the requested Clawbrowser profile and verify the requested proxy country before interacting with the site.");
  }
  if (unique.some((tool) => ["open", "navigate"].includes(tool))) {
    steps.push("Open the target website in the verified browser session.");
  }
  if (unique.some((tool) => ["multi_action", "input", "click", "press"].includes(tool))) {
    steps.push("Use the site's controls to apply the requested search and filters, waiting for navigation or page settlement when needed.");
  }
  const selected = selectedFastPath(transcript);
  const hasSearchAction = selected.some((call) => ["multi_action", "input", "click", "press"].includes(call.name));
  const selectedURL = selected
    .map((call) => typeof call.args.url === "string" ? call.args.url : "")
    .find((url) => /[?&](?:q|query|search)=/i.test(url));
  const searchTask = /\b(find|search)\b|найди|поиск/i.test(task);
  if (searchTask && !hasSearchAction && !selectedURL) {
    steps.push("Before extraction, apply the requested search on the site and wait until the results page is loaded; the recorded run started from browser state that was not fully self-contained.");
  }
  if (unique.some((tool) => ["paginate_extract", "extract", "state"].includes(tool))) {
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
