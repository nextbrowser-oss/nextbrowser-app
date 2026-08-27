const REPAIRABLE_STEP_TOOLS = new Set([
  "click", "input", "press", "select", "wait", "scroll", "dismiss", "upload",
  "extract", "paginate_extract", "tabs_extract", "form_fill", "multi_action",
  "site_recipe_run", "act", "evaluate",
]);

const INFRASTRUCTURE_FAILURE = /(?:\b401\b|\b403\b|unauthori[sz]ed|forbidden|account token|authentication|reconnect|backend|fetch failed|network|proxy|profile|session|runtime|launch|cdp|browser exited|cancelled|canceled|stopped by user)/i;

export function shouldAutoRepairAutomation(tool: string | undefined, error: unknown): boolean {
  const normalizedTool = String(tool || "").replace(/^(?:clawbrowser|nextbrowser)\./, "");
  if (!REPAIRABLE_STEP_TOOLS.has(normalizedTool)) return false;
  const message = error instanceof Error ? error.message : String(error || "");
  return !!message && !INFRASTRUCTURE_FAILURE.test(message);
}
