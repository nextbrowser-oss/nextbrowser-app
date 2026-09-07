import type { BrowserWorkflowAction, BrowserWorkflowSkill } from "../types";

export type TrustEffect = "read" | "local_artifact" | "external_upload" | "form_change" | "download" | "authentication" | "publication" | "proxy_change";

export type AutomationTrustSummary = {
  domains: string[];
  effects: TrustEffect[];
  needsConfirmation: boolean;
  savesLocalArtifact: boolean;
  explanation: string[];
};

function actionDomain(action: BrowserWorkflowAction): string | undefined {
  if (!['open', 'navigate'].includes(action.tool) || typeof action.arguments.url !== 'string') return undefined;
  try { return new URL(action.arguments.url).hostname; } catch { return undefined; }
}

function actionIntent(action: BrowserWorkflowAction) {
  return `${action.tool} ${JSON.stringify(action.arguments)}`.toLowerCase();
}

/**
 * Turn a recipe into the small, user-readable contract shown before execution.
 * It is intentionally conservative: an interaction that could send data is
 * called out even when the final page decides not to submit it.
 */
export function automationTrustSummary(workflow: Pick<BrowserWorkflowSkill, "actions" | "domain">): AutomationTrustSummary {
  const domains = [...new Set(workflow.actions.map(actionDomain).filter((value): value is string => !!value))];
  if (!domains.length && workflow.domain.trim()) domains.push(workflow.domain.trim());
  const effects = new Set<TrustEffect>();
  let savesLocalArtifact = false;

  for (const action of workflow.actions) {
    const tool = action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, "");
    const intent = actionIntent(action);
    if (["open", "navigate", "wait", "extract", "paginate_extract", "tabs_extract", "evaluate", "scroll"].includes(tool)) effects.add("read");
    if (tool === "save_artifact") { effects.add("local_artifact"); savesLocalArtifact = true; }
    if (tool === "upload") effects.add("external_upload");
    if (tool === "download" || /\b(download|export|save as)\b/.test(intent)) effects.add("download");
    if (/\b(log\s?in|sign\s?in|signin|password|one[- ]?time|otp|authenticate)\b/.test(intent)) effects.add("authentication");
    if (/\b(publish|post|submit|send|reply|comment|share)\b/.test(intent)) effects.add("publication");
    if (/\b(proxy|residential|datacenter|socks5|http_proxy)\b/.test(intent)) effects.add("proxy_change");
    if (["input", "select", "form_fill", "click", "press", "act", "multi_action", "dismiss"].includes(tool)) effects.add("form_change");
  }

  const explanation: string[] = [];
  if (effects.has("read")) explanation.push("Reads information visible on the selected websites.");
  if (savesLocalArtifact) explanation.push("Saves requested results only in this computer’s Artifact Center.");
  if (effects.has("external_upload")) explanation.push("Uploads a file to the selected website.");
  if (effects.has("download")) explanation.push("Downloads a file to this computer.");
  if (effects.has("authentication")) explanation.push("May sign in or enter authentication details on the selected website.");
  if (effects.has("publication")) explanation.push("May publish or submit data to the selected website.");
  if (effects.has("proxy_change")) explanation.push("May use or change the selected browser proxy.");
  if (effects.has("form_change")) explanation.push("Interacts with website controls; review the steps before any consequential run.");
  return {
    domains,
    effects: [...effects],
    // These are data-boundary or account-affecting actions. The preview is
    // always explicit, and these receive the stronger warning treatment.
    needsConfirmation: ["external_upload", "authentication", "publication", "proxy_change"].some((effect) => effects.has(effect as TrustEffect)),
    savesLocalArtifact,
    explanation,
  };
}

export function trustEffectLabel(effect: TrustEffect): string {
  return ({
    read: "Read page data",
    local_artifact: "Save local artifact",
    external_upload: "Upload file",
    form_change: "Use page controls",
    download: "Download file",
    authentication: "Sign in or authenticate",
    publication: "Publish or submit",
    proxy_change: "Use or change proxy",
  })[effect];
}
