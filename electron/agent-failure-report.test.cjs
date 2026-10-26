const assert = require("node:assert/strict");
const test = require("node:test");
const os = require("node:os");
const { agentFailureReason, describeAgentResult, describeTerminalExit } = require("./agent-failure-report.cjs");
const { createClaudeStreamDecoder } = require("./agent-steps.cjs");

const codexLog = [
  "OpenAI Codex v0.163.0 (research preview)",
  "--------",
  "workdir: /Users/a/Nextbrowser/workspace",
  "--------",
  "user",
  "Open the shop page and read the price.",
  "2026-10-23T07:02:11.831641Z ERROR codex_memories_write::phase2: Phase 2 no changes",
  "thinking",
  "Error handling on the page looks odd.",
].join("\n");

test("the reason is the line the CLI printed when it gave up", () => {
  assert.equal(agentFailureReason(`${codexLog}\nERROR: You've hit your usage limit. Try again later.\n`), "ERROR: You've hit your usage limit. Try again later.");
  assert.equal(agentFailureReason("\x1b[31mError: unknown option '--output-format'\x1b[0m\n"), "Error: unknown option '--output-format'");
  assert.equal(agentFailureReason("API Error: 529 Overloaded\n"), "API Error: 529 Overloaded");
  assert.equal(agentFailureReason("thread 'main' panicked at codex-rs/exec/src/lib.rs:88:5:\nboom\n"), "thread 'main' panicked at codex-rs/exec/src/lib.rs:88:5:");
});

test("an internal error log line is the reason only when nothing fatal was printed", () => {
  assert.equal(agentFailureReason(codexLog), "2026-10-23T07:02:11.831641Z ERROR codex_memories_write::phase2: Phase 2 no changes");
  assert.equal(agentFailureReason("user\nhello\n"), "");
  assert.equal(agentFailureReason(""), "");
});

test("a long reason is cut", () => {
  const reason = agentFailureReason(`ERROR: ${"x".repeat(1000)}`);
  assert.equal(reason.length, 300);
  assert.ok(reason.endsWith("…"));
});

test("a failed run is reported with the error line and without the transcript or the reply", () => {
  const { reason, event } = describeAgentResult({
    agentId: "codex",
    result: { code: 1, stdout: "The price is 42 EUR", stderr: `${codexLog}\nERROR: stream disconnected before completion\n` },
    durationMs: 5321.4,
  });
  assert.equal(reason, "ERROR: stream disconnected before completion");
  assert.deepEqual(event, {
    source: "agent",
    kind: "command_failed",
    name: "AGENT_STOPPED_UNEXPECTEDLY",
    message: "codex exited with code 1: ERROR: stream disconnected before completion",
    context: { agent: "codex", exit_code: "1", run: "chat", duration_ms: "5321" },
    fingerprintExtra: "codex",
  });
  assert.ok(!JSON.stringify(event).includes("shop page"));
  assert.ok(!JSON.stringify(event).includes("42 EUR"));
});

test("a failure without an error line is still reported", () => {
  const { reason, event } = describeAgentResult({ agentId: "claude", result: { code: 3221225477, stdout: "", stderr: "" }, plain: true });
  assert.equal(reason, "");
  assert.equal(event.message, "claude exited with code 3221225477: no error line in its output");
  assert.equal(event.context.run, "plain");
});

test("a failed Claude Code run is reported with the API error it printed to standard output", () => {
  const { reason, event } = describeAgentResult({
    agentId: "claude",
    result: { code: 1, stdout: "API Error: Connection refused\n", stderr: "" },
    durationMs: 1200,
  });
  assert.equal(event.name, "AGENT_STOPPED_UNEXPECTEDLY");
  assert.equal(event.message, "claude exited with code 1: API Error: Connection refused");
  // The chat already shows standard output as the reply, so it does not repeat the line.
  assert.equal(reason, "");
});

test("a chat run's stream-json output yields the same API error line", () => {
  // main.cjs reports the decoded reply of a `--output-format stream-json` run as its standard output.
  const decoder = createClaudeStreamDecoder({ onText: () => {}, onStep: () => {} });
  decoder.write(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Opening the shop page for alice." }] } })}\n`);
  decoder.write(`${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "API Error: Connection refused" }] } })}\n`);
  decoder.write(`${JSON.stringify({ type: "result", subtype: "success", is_error: true, result: "API Error: Connection refused" })}\n`);
  const { event } = describeAgentResult({ agentId: "claude", result: { code: 1, stdout: decoder.end(), stderr: "" } });
  assert.equal(event.message, "claude exited with code 1: API Error: Connection refused");
  assert.ok(!JSON.stringify(event).includes("alice"));
});

test("only the error line of Claude Code's standard output is reported, not the reply", () => {
  const reply = [
    "I opened the shop page for alice and the price is 42 EUR.",
    "Error handling on the page looks odd.",
    "Error: the checkout button did not respond",
    "Next I will try the cart page.",
  ].join("\n");
  const partial = describeAgentResult({
    agentId: "claude",
    result: { code: 1, stdout: `${reply}\nAPI Error: The response stalled before a response was produced. Try again.\n`, stderr: "" },
  }).event;
  assert.equal(partial.message, "claude exited with code 1: API Error: The response stalled before a response was produced. Try again.");
  assert.ok(!JSON.stringify(partial).includes("shop page"));
  assert.ok(!JSON.stringify(partial).includes("42 EUR"));
  assert.ok(!JSON.stringify(partial).includes("Next I will"));

  assert.equal(describeAgentResult({ agentId: "claude", result: { code: 1, stdout: "\x1b[31mError: Reached max turns (5)\x1b[0m", stderr: "" } }).event.message,
    "claude exited with code 1: Error: Reached max turns (5)");
  assert.equal(describeAgentResult({ agentId: "claude", result: { code: 1, stdout: "Execution error\n", stderr: "" } }).event.message,
    "claude exited with code 1: Execution error");

  const answerOnly = describeAgentResult({ agentId: "claude", result: { code: 1, stdout: "The price is 42 EUR.\nAn error: the page froze", stderr: "" } }).event;
  assert.equal(answerOnly.message, "claude exited with code 1: no error line in its output");
});

test("standard error comes first, and other agents' standard output is never read", () => {
  assert.equal(describeAgentResult({ agentId: "claude", result: { code: 1, stdout: "API Error: Connection refused", stderr: "Error: unknown option '--verbose'" } }).event.message,
    "claude exited with code 1: Error: unknown option '--verbose'");
  assert.equal(describeAgentResult({ agentId: "gemini", result: { code: 1, stdout: "Error: the cart for alice@shop.example is empty", stderr: "" } }).event.message,
    "gemini exited with code 1: no error line in its output");
});

test("success, a stop, quitting and a sign-in are not reported", () => {
  assert.deepEqual(describeAgentResult({ agentId: "codex", result: { code: 0, stdout: "done", stderr: "ERROR: ignored" } }), { reason: "", event: null });
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: -1, stdout: "", stderr: "" }, outcome: { stopped: true } }).event, null);
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: 1, stdout: "", stderr: "" }, outcome: { quitting: true } }).event, null);
  const signIn = describeAgentResult({ agentId: "claude", result: { code: 1, stdout: "Failed to authenticate: OAuth session expired and could not be refreshed", stderr: "" } });
  assert.equal(signIn.event, null);
});

test("an unexpected agent id is not sent as is", () => {
  assert.equal(describeAgentResult({ agentId: "../../etc", result: { code: 1, stdout: "", stderr: "" } }).event.context.agent, "unknown");
});

test("a run that exits 0 without a reply is reported without its error output", () => {
  const { reason, event } = describeAgentResult({
    agentId: "antigravity",
    result: { code: 0, stdout: "  \n", stderr: `${codexLog}\nwarning: quota low for alice@shop.example` },
    durationMs: 812,
  });
  assert.equal(reason, "");
  assert.deepEqual(event, {
    source: "agent",
    kind: "command_failed",
    name: "AGENT_EMPTY_REPLY",
    message: "antigravity exited with code 0 without a reply",
    context: { agent: "antigravity", exit_code: "0", run: "chat", duration_ms: "812" },
    fingerprintExtra: "antigravity",
  });
  assert.ok(!JSON.stringify(event).includes("shop"));
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: 0, stdout: "", stderr: "" }, outcome: { stopped: true } }).event, null, "a stopped run");
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: 0, stdout: "", stderr: "" }, outcome: { quitting: true } }).event, null, "quitting");
});

test("a run the app stopped for taking too long is reported as a timeout", () => {
  const { event } = describeAgentResult({ agentId: "claude", result: { code: -1, stdout: "partial draft about the post", stderr: "" }, outcome: { timedOut: true }, plain: true, durationMs: 180_000 });
  assert.equal(event.name, "AGENT_TIMED_OUT");
  assert.equal(event.message, "claude did not finish in time and was stopped");
  assert.deepEqual(event.context, { agent: "claude", exit_code: "-1", run: "plain", duration_ms: "180000" });
  assert.ok(!JSON.stringify(event).includes("draft"));
  assert.equal(describeAgentResult({ agentId: "claude", result: { code: -1, stdout: "", stderr: "" }, outcome: { timedOut: true, quitting: true } }).event, null);
});

test("a workflow author run is reported as its own run", () => {
  const failed = describeAgentResult({ agentId: "codex", result: { code: 1, stdout: "", stderr: "Error: unknown option '--json'" }, run: "workflow_author" });
  assert.equal(failed.event.name, "AGENT_STOPPED_UNEXPECTEDLY");
  assert.equal(failed.event.context.run, "workflow_author");
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: 0, stdout: "", stderr: "" }, run: "workflow_author" }).event.name, "AGENT_EMPTY_REPLY");
  assert.equal(describeAgentResult({ agentId: "codex", result: { code: 1, stdout: "", stderr: "" }, run: "anything" }).event.context.run, "chat");
});

test("a terminal CLI that ends with an error or a crash is reported", () => {
  const { event } = describeTerminalExit({ agentId: "codex", exitCode: 1, signal: 0, uptimeMs: 2310.6 });
  assert.deepEqual(event, {
    source: "agent",
    kind: "command_failed",
    name: "TERMINAL_EXITED_UNEXPECTEDLY",
    message: "codex terminal exited with code 1",
    context: { agent: "codex", exit_code: "1", run: "terminal", uptime_ms: "2311" },
    fingerprintExtra: "codex",
  });
  const segfault = describeTerminalExit({ agentId: "claude", exitCode: 0, signal: os.constants.signals.SIGSEGV }).event;
  assert.equal(segfault.message, "claude terminal exited with signal SIGSEGV");
  assert.equal(segfault.context.signal, "SIGSEGV");
  assert.equal(describeTerminalExit({ agentId: "claude", exitCode: 0, signal: os.constants.signals.SIGABRT }).event.context.signal, "SIGABRT", "not its SIGIOT alias");
});

test("a terminal the app closed, the user ended or interrupted is not reported", () => {
  assert.equal(describeTerminalExit({ agentId: "codex", exitCode: 1, closedByApp: true }).event, null);
  assert.equal(describeTerminalExit({ agentId: "codex", exitCode: 0 }).event, null);
  assert.equal(describeTerminalExit({ agentId: "codex", exitCode: 0, signal: os.constants.signals.SIGHUP }).event, null);
  assert.equal(describeTerminalExit({ agentId: "codex", exitCode: 130 }).event, null);
  assert.equal(describeTerminalExit({ agentId: "codex", exitCode: 3221225786 }).event, null);
  assert.equal(describeTerminalExit({ agentId: "../evil", exitCode: 2 }).event.context.agent, "unknown");
});
