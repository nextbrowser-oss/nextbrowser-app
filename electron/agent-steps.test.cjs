const assert = require("node:assert/strict");
const test = require("node:test");

const { createClaudeStreamDecoder, createCodexStepDecoder, claudeToolStep } = require("./agent-steps.cjs");

function claudeRun(lines, { split = false } = {}) {
  const text = [];
  const steps = [];
  const decoder = createClaudeStreamDecoder({ onText: (value) => text.push(value), onStep: (value) => steps.push(value) });
  const payload = lines.map((line) => (typeof line === "string" ? line : JSON.stringify(line))).join("\n") + "\n";
  if (split) {
    // Pipes cut events anywhere: inside a JSON string, even inside a character.
    const bytes = Buffer.from(payload);
    for (let index = 0; index < bytes.length; index += 7) decoder.write(bytes.subarray(index, index + 7));
  } else {
    decoder.write(Buffer.from(payload));
  }
  const final = decoder.end();
  return { text: text.join(""), steps, final };
}

const assistant = (...content) => ({ type: "assistant", message: { content } });

const BROWSER_TURN = [
  { type: "system", subtype: "init", session_id: "s" },
  assistant({ type: "text", text: "I'll check which profiles are running first." }),
  assistant({ type: "tool_use", id: "t1", name: "Bash", input: { command: "nbc profiles list --json", description: "List profiles" } }),
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "[]" }] } },
  assistant({ type: "tool_use", id: "t2", name: "mcp__clawbrowser__start", input: { profile: "Cookie automation (2)" } }),
  { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", is_error: true, content: [{ type: "text", text: "VERIFY_FAILED: cdp read: i/o timeout\nmore detail" }] }] } },
  assistant({ type: "text", text: "The German proxy did not pass verification." }),
  { type: "result", subtype: "success", is_error: false, result: "The German proxy did not pass verification." },
];

test("claude stream: the reply is the result, the rest becomes steps", () => {
  const run = claudeRun(BROWSER_TURN);
  assert.equal(run.text, "The German proxy did not pass verification.");
  assert.equal(run.final, "The German proxy did not pass verification.");
  assert.deepEqual(run.steps, [
    "I'll check which profiles are running first.",
    "List profiles — nbc profiles list --json",
    "clawbrowser: start Cookie automation (2)",
    "Failed: VERIFY_FAILED: cdp read: i/o timeout",
  ]);
});

test("claude stream: events split across chunks decode the same", () => {
  assert.deepEqual(claudeRun(BROWSER_TURN, { split: true }), claudeRun(BROWSER_TURN));
});

test("claude stream: a character split between chunks survives", () => {
  const run = claudeRun([{ type: "result", subtype: "success", is_error: false, result: "Профиль запущен" }], { split: true });
  assert.equal(run.final, "Профиль запущен");
});

test("claude stream: a sign-in failure still reaches the reply text", () => {
  // Captured from claude 2.1 with an expired login; exit code 1.
  const run = claudeRun([
    { type: "system", subtype: "init" },
    assistant({ type: "text", text: "Failed to authenticate: OAuth session expired and could not be refreshed" }),
    { type: "result", subtype: "success", is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed" },
  ]);
  assert.equal(run.final, "Failed to authenticate: OAuth session expired and could not be refreshed");
  assert.deepEqual(run.steps, []);
});

test("claude stream: a turn stopped before its result keeps the last thing said", () => {
  const run = claudeRun([
    assistant({ type: "text", text: "Opening DasBrowser now." }),
    assistant({ type: "tool_use", id: "t1", name: "Bash", input: { command: "nbc start dasbrowser" } }),
  ]);
  assert.equal(run.final, "Opening DasBrowser now.");
  assert.deepEqual(run.steps, ["Opening DasBrowser now.", "Ran nbc start dasbrowser"]);
});

test("claude stream: output that is not an event passes through as text", () => {
  const run = claudeRun(["Error: unknown option '--output-format'"]);
  assert.equal(run.final, "Error: unknown option '--output-format'\n");
  assert.equal(run.text, "Error: unknown option '--output-format'\n");
});

test("claude tool steps stay short and readable", () => {
  assert.equal(claudeToolStep("Read", { file_path: "/Users/me/.nextbrowser/workspace/AGENTS.md" }), "Read AGENTS.md");
  assert.equal(claudeToolStep("mcp__clawbrowser__navigate", { url: "https://example.com" }), "clawbrowser: navigate https://example.com");
  assert.ok(claudeToolStep("Bash", { command: "x".repeat(400) }).length <= 160);
});

test("codex stderr: commands, tools and thinking become steps, the answer does not", () => {
  const steps = [];
  const decoder = createCodexStepDecoder({ onStep: (step) => steps.push(step) });
  // Shape captured from codex-cli 0.158 `codex exec`.
  decoder.write(`OpenAI Codex v0.158.0
--------
workdir: /tmp/run
model: gpt-6-astra
--------
user
Run the shell command 'echo hi', then reply with the single word: done

2026-10-07T14:07:47.831641Z ERROR codex_memories_write::phase2: Phase 2 no changes
thinking
**Checking the profiles**
codex
I’ll run the command.

exec
/bin/zsh -lc 'echo hi' in /tmp/run
 succeeded in 0ms:
hi

tool clawbrowser.open({"profile":"Cookie automation (3)"})
codex
done
tokens used
23 649
`);
  decoder.end();
  assert.deepEqual(steps, [
    "Thinking: Checking the profiles",
    "I’ll run the command.",
    "Ran echo hi",
    "clawbrowser: open Cookie automation (3)",
  ]);
});
