const PROMPT_MARKER = /^\s*›\s*(.+)$/gm;
const CLAWBROWSER_CALL = /clawbrowser\.([a-z_]+)/g;

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
  return `Task pattern:\n${task || "Repeat the saved browser task on the selected website."}\n\nWorkflow:\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`;
}
