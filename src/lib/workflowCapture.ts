const PROMPT_MARKER = /^\s*›\s*(.+)$/gm;
const CLAWBROWSER_CALL = /clawbrowser\.([a-z_]+)/g;

interface CapturedCall {
  name: string;
  args: Record<string, unknown>;
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
      calls.push({ name, args });
    } catch {
      // Truncated calls still contribute their tool name to the generic workflow.
    }
  }
  return calls;
}

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
}

function fastPath(transcript: string): string[] {
  return capturedCalls(transcript).flatMap(({ name, args }) => {
    if (["start", "prepare"].includes(name)) {
      return [`clawbrowser.${name}(${JSON.stringify(pick(args, ["profile", "country", "url", "verify", "wait_for"]))})`];
    }
    if (name === "multi_action") {
      return [`clawbrowser.multi_action(${JSON.stringify(pick(args, ["actions", "stop_on_navigation", "wait_for", "state_mode"]))})`];
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
  if (unique.some((tool) => ["paginate_extract", "extract", "state"].includes(tool))) {
    steps.push("Extract all matching results, paginate or scroll as needed, deduplicate by canonical URL, and exclude irrelevant matches.");
  }
  steps.push("Return a concise result list with titles, URLs, and the important details requested by the user.");
  const calls = fastPath(transcript);
  const technical = calls.length
    ? `\n\nTechnical fast path:\nRun these operations in order. Reuse the saved arguments first; inspect the page and adapt only if an operation fails or the page structure changed.\n\n${calls.map((call, index) => `${index + 1}. ${call}`).join("\n")}\n\nTreat saved element_id values as short-lived hints. Resolve the element again by role, label, text, or selector if the id no longer matches.`
    : "";
  return `Task pattern:\n${task || "Repeat the saved browser task on the selected website."}\n\nWorkflow:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}${technical}`;
}
