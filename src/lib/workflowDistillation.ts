export interface DistilledWorkflow {
  title: string;
  domain: string;
  instructions: string;
}

export function workflowDistillationPrompt(input: DistilledWorkflow): string {
  return `You are converting an observed successful browser run into a reusable private skill.
Do not call tools, browse, or inspect files. Use only the supplied cleaned trace.

Return exactly one JSON object with string fields: title, domain, instructions.

Rules:
- Preserve the real domain and only browser tools/arguments present in the cleaned trace.
- Keep the workflow self-contained from proxy/session preparation through final results.
- Parameterize user-specific search values when useful, while retaining their current defaults.
- Separate the proven fast path from fallback behavior.
- Do not include results, IDs, endpoints, dashboard URLs, timestamps, tokens, or credentials.
- Do not wrap JSON in markdown.

Current title: ${JSON.stringify(input.title)}
Domain: ${JSON.stringify(input.domain)}
Cleaned trace and deterministic fallback:
${input.instructions}`;
}

export function parseDistilledWorkflow(raw: string, fallback: DistilledWorkflow): DistilledWorkflow | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  let value: unknown;
  try { value = JSON.parse(raw.slice(start, end + 1)); } catch { return undefined; }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 64) : "";
  const domain = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";
  const instructions = typeof record.instructions === "string" ? record.instructions.trim() : "";
  if (!title || domain !== fallback.domain || instructions.length < 80 || instructions.length > 16_000) return undefined;
  if (/(?:dashboard_url|endpoint|rs_[a-z0-9]+|127\.0\.0\.1:\d+|localhost:\d+|api[_-]?key|bearer\s+)/i.test(instructions)) return undefined;
  const allowedTools = new Set([...fallback.instructions.matchAll(/clawbrowser\.([a-z_]+)/g)].map((match) => match[1]));
  const producedTools = [...instructions.matchAll(/clawbrowser\.([a-z_]+)/g)].map((match) => match[1]);
  if (producedTools.some((tool) => !allowedTools.has(tool))) return undefined;
  return { title, domain, instructions };
}
