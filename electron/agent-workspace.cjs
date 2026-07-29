const path = require("node:path");

function agentWorkspaceDir(homeDir) {
  const resolvedHome = String(homeDir || "").trim();
  if (!resolvedHome) throw new Error("A home directory is required for the agent workspace.");
  return path.join(resolvedHome, ".nextbrowser", "workspace");
}

module.exports = { agentWorkspaceDir };
