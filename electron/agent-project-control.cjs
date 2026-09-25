const { listProjects, deleteProject } = require("./project-sync.cjs");

async function workspaceProjects(scope, deps, operations = { listProjects }) {
  if (!scope?.workspaceId) throw new Error("This agent has no current NextBrowser workspace.");
  const response = await operations.listProjects(deps);
  return (Array.isArray(response?.projects) ? response.projects : [])
    .filter((project) => project?.workspace_id === scope.workspaceId && typeof project.id === "string")
    .map((project) => ({
      id: project.id,
      name: String(project.title || ""),
      mode: project.chat_mode === "terminal" ? "terminal" : "chat",
    }));
}

async function deleteWorkspaceProject(scope, selector, deps, operations = { listProjects, deleteProject }) {
  const id = String(selector?.id || "").trim();
  const name = String(selector?.name || "").trim();
  if ((!id && !name) || id.length > 200 || name.length > 200) {
    throw new Error("Specify one project ID or exact name from the current workspace.");
  }
  const projects = await workspaceProjects(scope, deps, operations);
  // The CLI accepts one ID_OR_NAME argument. Resolve an exact ID first, then
  // an exact name; MCP callers can supply an explicit id or name.
  const exactId = id || (name && projects.some((project) => project.id === name) ? name : "");
  const matches = projects.filter((project) => (exactId ? project.id === exactId : project.name === name));
  if (matches.length === 0) throw new Error("Project not found in the current workspace.");
  if (matches.length > 1) throw new Error("More than one project has this name. Use its exact ID.");
  const project = matches[0];
  if (id && name && project.name !== name) throw new Error("Project ID and name refer to different projects.");
  if (project.id === scope.conversationId) throw new Error("The active agent cannot delete its own project while running. Use another project chat.");
  await operations.deleteProject(project.id, deps);
  return project;
}

module.exports = { workspaceProjects, deleteWorkspaceProject };
