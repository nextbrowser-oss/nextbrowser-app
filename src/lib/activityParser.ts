export interface ToolEvent {
  id: string;
  name: string;
  detail?: string;
  createdAt: number;
}

export type AgentActivity =
  | "Thinking"
  | "Driving browser"
  | "Configuring proxy"
  | "Parsing data"
  | "Solving captcha"
  | "Running tool";

export function activityFromText(text: string): AgentActivity | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("captcha") || lower.includes("recaptcha") || lower.includes("hcaptcha")) {
    return "Solving captcha";
  }
  if (
    lower.includes("pars") ||
    lower.includes("extract") ||
    lower.includes("scrape") ||
    lower.includes("listing")
  ) {
    return "Parsing data";
  }
  if (lower.includes("rotate") && (lower.includes("country") || lower.includes("proxy"))) {
    return "Configuring proxy";
  }
  if (
    lower.includes("nextctl") ||
    lower.includes("nextbrowser") ||
    lower.includes("navigat") ||
    lower.includes("opening") ||
    lower.includes("browser")
  ) {
    return "Driving browser";
  }
  if (lower.includes("tool") || lower.includes("bash") || lower.includes("running ")) {
    return "Running tool";
  }
  if (text.length > 40) return "Thinking";
  return undefined;
}

// Keep only the most recent tool events — the strip renders a handful and an
// hours-long run would otherwise grow this array without bound.
const MAX_TOOL_EVENTS = 50;

export function extractToolEvents(chunk: string, existing: ToolEvent[]): ToolEvent[] {
  const found = [...existing];
  for (const line of chunk.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    if (s.startsWith("nextctl ")) {
      const cmd = s.slice(0, 80);
      if (!found.some((e) => e.name === "nextctl" && e.detail === cmd)) {
        found.push({ id: crypto.randomUUID(), name: "nextctl", detail: cmd, createdAt: Date.now() });
      }
    } else if (s.includes("●") || s.includes("⏺")) {
      const cleaned = s.replace(/[●⏺]/g, "").trim();
      if (cleaned.length > 3 && !found.some((e) => e.detail === cleaned)) {
        found.push({
          id: crypto.randomUUID(),
          name: "tool",
          detail: cleaned.slice(0, 120),
          createdAt: Date.now(),
        });
      }
    }
  }
  return found.length > MAX_TOOL_EVENTS ? found.slice(found.length - MAX_TOOL_EVENTS) : found;
}
