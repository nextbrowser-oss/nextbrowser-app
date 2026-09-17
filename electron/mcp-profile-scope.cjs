// Scope for MCP is distinct from the app's local start/stop control scope.
// Multilogin's selected remote ID and its local session alias denote one profile.
function mcpProfileScope(profiles, selection) {
  const scope = Object.fromEntries([...profiles.entries()].map(([name, access]) => [name, access.runtime]));
  if (selection?.kind === "browser" && typeof selection.id === "string" && selection.id.trim()) {
    const id = selection.id.trim();
    const safe = id.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const session = `mlx-browser-${safe || "profile"}`.slice(0, 120);
    const access = { runtime: "multilogin", identity: id };
    scope[id] = access;
    scope[session] = access;
  }
  return scope;
}
module.exports = { mcpProfileScope };
