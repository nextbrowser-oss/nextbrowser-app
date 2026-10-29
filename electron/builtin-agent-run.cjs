// One turn of the built-in Nextbrowser agent, from the saved settings to the
// result the chat shows: resolve the provider and its key, start `nbc mcp`
// for the browser tools (not for a plain one-shot answer), run the loop, and
// describe how it ended in the shape of an agent CLI's result.

const { createMCPClient } = require("./automation-runner.cjs");
const { ProviderError, createProviderClient, modelSupportsVision, resolveProviderSettings } = require("./builtin-agent-providers.cjs");
const { createMCPToolset } = require("./builtin-agent-tools.cjs");
const { BUILTIN_AGENT_SYSTEM_PROMPT, DEFAULT_LIMITS, PLAIN_SYSTEM_PROMPT, runBuiltinAgent } = require("./builtin-agent.cjs");

// The app settings key (src/lib/builtinAgent.ts) holding the provider, base
// URL and model. The API key is never in there.
const BUILTIN_AGENT_SETTINGS_KEY = "nextbrowser.builtinAgent";
const MCP_START_TIMEOUT_MS = 30_000;

/** The non-secret settings from the app settings file. */
function parseBuiltinAgentSettings(raw) {
  let value;
  try { value = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { value = undefined; }
  if (!value || typeof value !== "object") return {};
  const pick = (key) => (typeof value[key] === "string" ? value[key] : "");
  return { provider: pick("provider"), baseURL: pick("baseURL"), model: pick("model") };
}

function failed(reason, failure) {
  return { status: "failed", code: 1, stdout: "", stderr: reason, reason, failure };
}

function failedWith(error, fallback) {
  if (error instanceof ProviderError) {
    return failed(error.message, {
      code: error.code,
      expected: error.expected === true,
      ...(error.status ? { status: error.status } : {}),
      ...(error.networkCode ? { networkCode: error.networkCode } : {}),
    });
  }
  const message = error instanceof Error ? error.message : String(error || "");
  // A user error (user-error.cjs) is worded for the user already.
  if (error?.expected === true) return failed(message, { code: "setup", expected: true });
  return failed(`${fallback}${message ? ` ${message}` : ""}`.trim(), { code: "internal", expected: false });
}

/** The chat's result for how the loop ended (see runBuiltinAgent). */
function turnResult(outcome, limits) {
  switch (outcome.status) {
    case "completed":
      return { status: "completed", code: 0, stdout: outcome.text, stderr: "", reason: "" };
    case "cancelled":
      return { status: "cancelled", code: 130, stdout: "", stderr: "", reason: "" };
    case "max_steps": {
      const reason = `The Nextbrowser agent stopped after ${limits.maxSteps} steps without finishing. Try a smaller task, or pick a stronger model in Settings → Agent.`;
      return { ...failed(reason, { code: "max_steps", expected: true }), status: "max_steps" };
    }
    case "timeout": {
      const reason = `The Nextbrowser agent did not finish within ${Math.round(limits.runTimeoutMs / 60_000)} minutes and was stopped. Try a smaller task.`;
      return { ...failed(reason, { code: "timeout", expected: false }), status: "timeout" };
    }
    default:
      return failedWith(outcome.error, "The Nextbrowser agent stopped unexpectedly.");
  }
}

/**
 * Runs one turn. `loadKey(provider)` returns the saved key or "". `mcp` is
 * how to start `nbc mcp` ({ binary, args, env, spawnImpl, onRunnerExit });
 * a plain run needs none. Resolves with { status, code, stdout, stderr,
 * reason, failure?, provider?, model? } and never rejects.
 */
async function runBuiltinAgentTurn({
  settings,
  loadKey,
  prompt,
  plain = false,
  mcp,
  defaultProfile = "",
  fetchImpl,
  signal,
  onStep = () => {},
  limits: limitOverrides = {},
  sleep,
}) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  let provider;
  try {
    provider = resolveProviderSettings(settings);
  } catch (error) {
    return failedWith(error, "The Nextbrowser agent is not set up.");
  }
  const identity = { provider: provider.provider, model: provider.model };
  let apiKey = "";
  try {
    apiKey = await loadKey(provider.provider);
  } catch (error) {
    return { ...failedWith(error, `Nextbrowser could not read the saved ${provider.providerName} key.`), ...identity };
  }
  if (provider.keyRequired && !apiKey) {
    return { ...failed(`Add your ${provider.providerName} API key in Settings → Agent.`, { code: "not_configured", expected: true }), ...identity };
  }
  if (signal?.aborted) return { ...turnResult({ status: "cancelled" }, limits), ...identity };
  const client = createProviderClient({ ...provider, apiKey, ...(fetchImpl ? { fetchImpl } : {}) });

  let mcpClient;
  let toolset;
  const closeRunner = () => mcpClient?.close();
  signal?.addEventListener("abort", closeRunner, { once: true });
  try {
    if (!plain) {
      let runnerGone = false;
      mcpClient = createMCPClient({
        binary: mcp.binary,
        args: mcp.args,
        env: mcp.env,
        ...(mcp.spawnImpl ? { spawnImpl: mcp.spawnImpl } : {}),
        onExit: (...details) => {
          runnerGone = true;
          mcp.onRunnerExit?.(...details);
        },
      });
      let mcpTools;
      try {
        onStep("Starting the browser tools");
        await mcpClient.initialize(MCP_START_TIMEOUT_MS);
        mcpTools = await mcpClient.listTools(MCP_START_TIMEOUT_MS);
      } catch (error) {
        if (signal?.aborted) return { ...turnResult({ status: "cancelled" }, limits), ...identity };
        return { ...failedWith(error, "The Nextbrowser agent could not start its browser tools."), ...identity };
      }
      toolset = createMCPToolset({
        client: {
          callTool: (name, args, timeoutMs) => {
            if (runnerGone) throw Object.assign(new Error("The browser tools stopped working. Send the task again."), { fatal: true });
            return mcpClient.callTool(name, args, timeoutMs);
          },
        },
        mcpTools,
        vision: modelSupportsVision(provider.model),
        // Gemini's OpenAI endpoint rejects map schemas and untyped values.
        strict: provider.provider === "gemini",
        defaultProfile,
      });
      if (!toolset.definitions.length) {
        return { ...failed("The browser tools of this Nextbrowser installation are not the ones the Nextbrowser agent uses. Update Nextbrowser, then try again.", { code: "tools_unavailable", expected: false }), ...identity };
      }
    }
    const outcome = await runBuiltinAgent({
      client,
      model: provider.model,
      providerName: provider.providerName,
      systemPrompt: plain ? PLAIN_SYSTEM_PROMPT : BUILTIN_AGENT_SYSTEM_PROMPT,
      prompt,
      tools: toolset,
      signal,
      limits,
      onStep,
      ...(sleep ? { sleep } : {}),
    });
    return { ...turnResult(outcome, limits), ...identity };
  } finally {
    signal?.removeEventListener("abort", closeRunner);
    closeRunner();
  }
}

module.exports = {
  BUILTIN_AGENT_SETTINGS_KEY,
  parseBuiltinAgentSettings,
  runBuiltinAgentTurn,
  turnResult,
};
