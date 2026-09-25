const test = require("node:test");
const assert = require("node:assert/strict");
const { workspaceProjects, deleteWorkspaceProject } = require("./agent-project-control.cjs");

const projects = [
  { id: "one", title: "Shared", workspace_id: "current", chat_mode: "chat" },
  { id: "two", title: "Shared", workspace_id: "current", chat_mode: "terminal" },
  { id: "foreign", title: "Other", workspace_id: "elsewhere", chat_mode: "chat" },
];

test("agent sees only projects in its workspace", async () => {
  const actual = await workspaceProjects({ workspaceId: "current" }, {}, {
    listProjects: async () => ({ projects }),
  });
  assert.deepEqual(actual, [
    { id: "one", name: "Shared", mode: "chat" },
    { id: "two", name: "Shared", mode: "terminal" },
  ]);
});

test("agent deletion requires a unique project in its workspace and waits for backend", async () => {
  const deleted = [];
  const operations = {
    listProjects: async () => ({ projects }),
    deleteProject: async (id) => deleted.push(id),
  };
  const scope = { workspaceId: "current", conversationId: "agent-chat" };
  await assert.rejects(deleteWorkspaceProject(scope, { name: "Shared" }, {}, operations), /More than one/);
  await assert.rejects(deleteWorkspaceProject(scope, { id: "foreign" }, {}, operations), /not found/);
  await assert.rejects(deleteWorkspaceProject({ ...scope, conversationId: "one" }, { id: "one" }, {}, operations), /own project/);
  await assert.rejects(deleteWorkspaceProject(scope, { id: "one", name: "Wrong" }, {}, operations), /different projects/);
  assert.deepEqual(deleted, []);
  assert.equal((await deleteWorkspaceProject(scope, { id: "two" }, {}, operations)).id, "two");
  assert.equal((await deleteWorkspaceProject(scope, { name: "one" }, {}, operations)).id, "one");
  assert.deepEqual(deleted, ["two", "one"]);
});
