const assert = require("node:assert/strict");
const test = require("node:test");
const { parseAgentControlBody, resolveScopedProfile } = require("./agent-control-scope.cjs");

test("reads the start request from every shell the agent may run it in", () => {
  // The app's start command: form fields, unchanged by any shell.
  assert.deepEqual(parseAgentControlBody("profile=Clawbrowser%20profile"), { profile: "Clawbrowser profile" });
  assert.deepEqual(parseAgentControlBody("profile=HEY%21"), { profile: "HEY!" });
  // JSON, also with Windows line endings, a byte-order mark, or cmd.exe's literal quotes.
  assert.deepEqual(parseAgentControlBody('{"profile":"Work"}\r\n'), { profile: "Work" });
  assert.deepEqual(parseAgentControlBody('﻿{"profile":"Work"}'), { profile: "Work" });
  assert.deepEqual(parseAgentControlBody(`'{"profile":"Work"}'`), { profile: "Work" });
  assert.deepEqual(parseAgentControlBody(""), {});
  assert.deepEqual(parseAgentControlBody("null"), {});
  assert.deepEqual(parseAgentControlBody('["Work"]'), {});
});

test("a body the shell mangled beyond reading throws the parser's SyntaxError", () => {
  // Windows PowerShell 5.1 strips the inner quotes of '{"profile":"Clawbrowser profile"}'
  // and splits the argument at the space.
  for (const body of ["{profile:Clawbrowser", "{profile:Work}", "'{profile:Work}'"]) {
    assert.throws(() => parseAgentControlBody(body), SyntaxError, body);
  }
});

test("a profile outside the scope is never chosen, except as the only one", () => {
  const scope = new Map([["Work", {}], ["Home", {}]]);
  assert.equal(resolveScopedProfile(scope, "Work"), "Work");
  assert.equal(resolveScopedProfile(scope, "Other"), "");
  assert.equal(resolveScopedProfile(new Map([["Work", {}]]), "Other"), "Work");
});
