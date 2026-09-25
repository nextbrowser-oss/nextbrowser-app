const fs = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { mcpProfileScope } = require("./mcp-profile-scope.cjs");

// nbc reads the scope file on every MCP call. Publish a new complete file
// after the desktop has persisted the profile's workspace assignment so an
// agent can start the profile it just requested in the same turn.
async function addChatWorkspaceProfile(record, name, runtime) {
  const next = new Map(record.profileScope);
  next.set(name, { runtime, conversationId: record.conversationId, ownerConversationId: "", wasRunning: false });
  const temp = `${record.profileScopeFile}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(mcpProfileScope(next, record.multiloginSelection)), { mode: 0o600 });
    await fs.rename(temp, record.profileScopeFile);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
  record.profileScope = next;
  return next;
}

module.exports = { addChatWorkspaceProfile };
