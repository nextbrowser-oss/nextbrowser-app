const { saveAutomationArtifact } = require("./automation-artifact.cjs");

const AGENT_ARTIFACT_BODY_LIMIT = 8 * 1024 * 1024;

function normalizeAgentContent(content, format) {
  if (format !== "json" || typeof content !== "string") return content;
  const candidate = content.trim();
  if (!candidate) return content;
  try {
    return JSON.parse(candidate);
  } catch {
    return content;
  }
}

async function saveAgentArtifact({ workspaceId, payload, store }) {
  const format = String(payload?.format || "json").toLowerCase();
  const name = String(payload?.name || "agent-result").trim();
  if (!Object.prototype.hasOwnProperty.call(payload || {}, "content")) {
    throw new Error("Artifact content is required.");
  }
  return saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: { source: "last_result", format, name } },
    results: [{ index: 0, tool: "agent", ok: true, output: normalizeAgentContent(payload.content, format) }],
    workspaceId,
    store,
  });
}

module.exports = { AGENT_ARTIFACT_BODY_LIMIT, normalizeAgentContent, saveAgentArtifact };
