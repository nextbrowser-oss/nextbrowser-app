const assert = require("node:assert/strict");
const test = require("node:test");
const { describeAutomationResult } = require("./automation-failure-report.cjs");

const failedAt = (index, tool, error) => ({
  status: "failed",
  failedStep: index,
  error,
  results: [...Array.from({ length: index }, (_, step) => ({ index: step, tool: "open", ok: true, output: { title: "Alice's orders" } })), { index, tool, ok: false, error }],
});

test("a failed step is reported with its number, tool and error code", () => {
  const { event } = describeAutomationResult({ result: failedAt(2, "click", "No element matches the saved button Buy for Alice"), runtime: "camoufox" });
  assert.deepEqual(event, {
    source: "main",
    kind: "command_failed",
    name: "AUTOMATION_STEP_FAILED",
    message: "Automation step 3 (click) failed: LOCATOR_FAILED",
    context: { error_code: "LOCATOR_FAILED", step: "3", tool: "click", runtime: "camoufox" },
    fingerprintExtra: "click LOCATOR_FAILED",
  });
  const codes = {
    "CDP_UNREACHABLE: cdp tab endpoint http://127.0.0.1:9222 unreachable": "CDP_UNREACHABLE",
    "page.goto: net::ERR_CERT_DATE_INVALID at https://shop.example/": "ERR_CERT_DATE_INVALID",
    "tools/call timed out after 120 seconds.": "RUNNER_TIMEOUT",
    "The saved extraction returned only empty rows. Wait for the page data or repair its field selectors before saving the result.": "DATA_INCOMPLETE",
    "Price: SOLD_OUT for Alice": "UNCLASSIFIED",
  };
  for (const [message, code] of Object.entries(codes)) {
    assert.equal(describeAutomationResult({ result: failedAt(0, "extract", message) }).event.context.error_code, code, message);
  }
});

test("a runner that fails before the first step is reported", () => {
  const { event } = describeAutomationResult({ result: { status: "failed", results: [], error: "initialize timed out after 30 seconds." }, runtime: "clawbrowser" });
  assert.equal(event.message, "Automation runner failed before the first step: RUNNER_TIMEOUT");
  assert.deepEqual(event.context, { error_code: "RUNNER_TIMEOUT", runtime: "clawbrowser" });
  assert.equal(describeAutomationResult({ result: { status: "failed", results: [], error: "Browser runner exited with code 2." } }).event.context.error_code, "RUNNER_EXITED");
});

test("completed and stopped runs, and the profile's proxy or an offline machine, are not reported", () => {
  assert.equal(describeAutomationResult({ result: { status: "completed", results: [] } }).event, null);
  assert.equal(describeAutomationResult({ result: { status: "cancelled", results: [], error: "Automation execution was cancelled." } }).event, null);
  assert.equal(describeAutomationResult({ result: failedAt(0, "open", "page.goto: net::ERR_TUNNEL_CONNECTION_FAILED") }).event, null);
  assert.equal(describeAutomationResult({ result: failedAt(0, "open", "dial tcp: lookup shop.example: no such host") }).event, null);
  assert.equal(describeAutomationResult({ result: undefined }).event, null);
});

test("the step's output and the error text never reach the report", () => {
  const { event } = describeAutomationResult({ result: failedAt(1, "evaluate", "Error: Alice Smith <alice@shop.example> owes 42 EUR"), runtime: "secret-runtime" });
  const sent = JSON.stringify(event);
  for (const fragment of ["Alice", "alice@", "42 EUR", "orders", "secret-runtime"]) assert.ok(!sent.includes(fragment), fragment);
  assert.equal(describeAutomationResult({ result: failedAt(0, "Alice's tool", "x") }).event.context.tool, "unknown");
});

test("a JavaScript error the runner threw is reported by class and message, without quoted values", () => {
  const typeError = { ...failedAt(1, "extract", "Cannot read properties of undefined (reading 'rows')"), errorName: "TypeError" };
  const { event } = describeAutomationResult({ result: typeError, runtime: "clawbrowser" });
  assert.equal(event.message, "Automation step 2 (extract) failed: TypeError: Cannot read properties of undefined (reading 'rows')");
  assert.deepEqual(event.context, { error_code: "TypeError", step: "2", tool: "extract", runtime: "clawbrowser" });
  assert.equal(event.fingerprintExtra, "extract TypeError");
  const parse = { status: "failed", results: [], error: 'Unexpected token \'<\', "<html>Alice"... is not valid JSON', errorName: "SyntaxError" };
  assert.equal(describeAutomationResult({ result: parse }).event.message, "Automation runner failed before the first step: SyntaxError: Unexpected token '<', \"…\" is not valid JSON");
  // An error a page or nbc worded stays a code: its text can quote the page.
  const page = { ...failedAt(0, "evaluate", "TypeError: Alice's cart is empty"), errorName: "Error" };
  assert.equal(describeAutomationResult({ result: page }).event.message, "Automation step 1 (evaluate) failed: UNCLASSIFIED");
});
