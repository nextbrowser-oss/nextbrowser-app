const { saveAutomationArtifact } = require("./automation-artifact.cjs");

const AGENT_ARTIFACT_BODY_LIMIT = 8 * 1024 * 1024;

async function saveAgentArtifact({ workspaceId, payload, store }) {
  const format = String(payload?.format || "json").toLowerCase();
  const name = String(payload?.name || "agent-result").trim();
  if (!Object.prototype.hasOwnProperty.call(payload || {}, "content")) {
    throw new Error("Artifact content is required.");
  }
  return saveAutomationArtifact({
    action: { tool: "save_artifact", arguments: { source: "last_result", format, name } },
    results: [{ index: 0, tool: "agent", ok: true, output: payload.content }],
    workspaceId,
    store,
  });
}

module.exports = { AGENT_ARTIFACT_BODY_LIMIT, saveAgentArtifact };
