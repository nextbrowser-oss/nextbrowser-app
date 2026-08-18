export interface DistilledWorkflow {
  title: string;
  domain: string;
  instructions: string;
  reusable: boolean;
  reason: string;
  capability: "scrape" | "search" | "posting" | "form" | "navigation" | "other";
  parametersSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  recipe: { version: 1; capability: DistilledWorkflow["capability"]; actions: Array<{ tool: string; arguments: Record<string, unknown> }> };
}

export function workflowDistillationPrompt(input: DistilledWorkflow): string {
  return `You are converting an observed successful browser run into a reusable private skill.
Do not call tools, browse, or inspect files. Use only the supplied cleaned trace.

Return exactly one JSON object with fields: title, domain, instructions, reusable, reason, capability, parameters_schema, output_schema.

Rules:
- Preserve the real domain and only browser tools/arguments present in the cleaned trace.
- Keep only task-specific website actions through final results. NextBrowser prepares profiles, proxy, and sessions; omit start/prepare lifecycle steps.
- Parameterize user-specific search values when useful, while retaining their current defaults.
- Separate the proven fast path from fallback behavior.
- Do not include results, IDs, endpoints, dashboard URLs, timestamps, tokens, or credentials.
- Do not wrap JSON in markdown.
- Set reusable to true only if the trace shows a completed, repeatable browser task with meaningful successful actions.
- Set reusable to false for empty, failed, trivial, interrupted, or result-only traces. Explain why in reason.

Current title: ${JSON.stringify(input.title)}
Domain: ${JSON.stringify(input.domain)}
Cleaned trace and deterministic fallback:
${input.instructions}`;
}

export function parseDistilledWorkflow(raw: string, fallback: DistilledWorkflow): DistilledWorkflow | undefined {
  let value: unknown;
  const starts = [...raw.matchAll(/\{/g)].map((match) => match.index ?? -1).filter((index) => index >= 0);
  for (const start of starts) {
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; index < raw.length; index += 1) {
      const char = raw[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
      } else if (char === '"') quoted = true;
      else if (char === "{") depth += 1;
      else if (char === "}" && --depth === 0) {
        try { value = JSON.parse(raw.slice(start, index + 1)); } catch { /* try the next object */ }
        break;
      }
    }
    if (value) break;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 64) : "";
  const domain = typeof record.domain === "string" ? record.domain.trim().toLowerCase() : "";
  const instructions = typeof record.instructions === "string" ? record.instructions.trim() : "";
  const reusable = typeof record.reusable === "boolean" ? record.reusable : undefined;
  const reason = typeof record.reason === "string" ? record.reason.trim().slice(0, 240) : "";
  if (reusable === false) return { ...fallback, reusable: false, reason: reason || "The browser workflow was not completed successfully." };
  if (reusable !== true || !title || domain !== fallback.domain || instructions.length < 80 || instructions.length > 16_000) return undefined;
  if (/(?:dashboard_url\s*[:=]|rs_[a-z0-9]+|127\.0\.0\.1:\d+|localhost:\d+|api[_-]?key\s*[:=]|bearer\s+[a-z0-9._-]+)/i.test(instructions)) return undefined;
  const allowedTools = new Set([...fallback.instructions.matchAll(/(?:clawbrowser|nextbrowser)\.([a-z_]+)/g)].map((match) => match[1]));
  const producedTools = [...instructions.matchAll(/(?:clawbrowser|nextbrowser)\.([a-z_]+)/g)].map((match) => match[1]);
  if (producedTools.some((tool) => !allowedTools.has(tool))) return undefined;
  const allowedCapabilities = new Set(["scrape", "search", "posting", "form", "navigation", "other"]);
  const capability = typeof record.capability === "string" && allowedCapabilities.has(record.capability) ? record.capability as DistilledWorkflow["capability"] : fallback.capability;
  const parametersSchema = record.parameters_schema && typeof record.parameters_schema === "object" && !Array.isArray(record.parameters_schema) ? record.parameters_schema as Record<string, unknown> : fallback.parametersSchema;
  const outputSchema = record.output_schema && typeof record.output_schema === "object" && !Array.isArray(record.output_schema) ? record.output_schema as Record<string, unknown> : fallback.outputSchema;
  return { title, domain, instructions, reusable: true, reason, capability, parametersSchema, outputSchema, recipe: { ...fallback.recipe, capability } };
}
