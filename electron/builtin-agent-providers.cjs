// The model providers the built-in Nextbrowser agent talks to. Every one of
// them speaks the OpenAI chat-completions API with tool calling, so a single
// client covers the presets and any endpoint the user enters (Groq, Ollama,
// LM Studio, a paid key). The API key is passed in by the caller for each
// client and never leaves this module except in the Authorization header:
// errors, steps and reports carry the provider's name, never the key, the
// prompt, or the provider's raw response.

const PROVIDERS = Object.freeze({
  nvidia: Object.freeze({ id: "nvidia", name: "NVIDIA", baseURL: "https://integrate.api.nvidia.com/v1", keyRequired: true }),
  openrouter: Object.freeze({ id: "openrouter", name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", keyRequired: true }),
  gemini: Object.freeze({ id: "gemini", name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyRequired: true }),
  custom: Object.freeze({ id: "custom", name: "Custom provider", baseURL: "", keyRequired: false }),
});
const DEFAULT_PROVIDER = "nvidia";
// Used when the provider's model list cannot be read.
const FALLBACK_MODELS = Object.freeze({
  nvidia: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  openrouter: "openrouter/free",
  gemini: "gemini-2.5-flash",
});
const OPENROUTER_FREE_ROUTER = "openrouter/free";
const MODEL_ID_MAX = 200;
const ERROR_BODY_LIMIT = 4096;
const PROVIDER_MESSAGE_LIMIT = 200;

class ProviderError extends Error {
  /**
   * `code` is what went wrong, in words the chat and the error report share:
   * auth, rate_limit, model_not_found, no_tools, payment, context_too_long,
   * bad_request, server, bad_response, network, timeout, cancelled.
   * `expected` marks a failure the user fixes on their own (a key, a limit, a
   * model choice); those are not error reports.
   */
  constructor(code, message, { status = 0, retryAfterMs, networkCode, expected = false, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.expected = expected;
    if (retryAfterMs != null) this.retryAfterMs = retryAfterMs;
    if (networkCode) this.networkCode = networkCode;
  }
}

/** A provider's base URL without a trailing slash or a pasted /chat/completions; "" when it is not a usable http(s) URL. */
function normalizeBaseURL(value) {
  let text = String(value || "").trim().replace(/\/+$/, "");
  text = text.replace(/\/chat\/completions$/i, "").replace(/\/+$/, "");
  if (!text) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  // A key belongs in the key field, which is encrypted, not in a URL kept in
  // the clear in the settings file.
  if (url.username || url.password || url.search || url.hash) return "";
  return text;
}

function cleanModelId(value) {
  const model = String(value || "").trim();
  return model && model.length <= MODEL_ID_MAX && !/[\s"'<>`]/.test(model) ? model : "";
}

/**
 * The provider, base URL and model from the saved settings. Throws a
 * user-facing message when something the run needs is missing.
 */
function resolveProviderSettings(settings = {}) {
  const preset = PROVIDERS[settings.provider] || PROVIDERS[DEFAULT_PROVIDER];
  const baseURL = preset.id === "custom" ? normalizeBaseURL(settings.baseURL) : preset.baseURL;
  if (!baseURL) {
    throw new ProviderError("not_configured", "Enter the base URL of your provider in Settings → Agent.", { expected: true });
  }
  const model = cleanModelId(settings.model);
  if (!model) {
    throw new ProviderError("not_configured", "Pick a model for the Nextbrowser agent in Settings → Agent.", { expected: true });
  }
  return { provider: preset.id, providerName: preset.name, baseURL, model, keyRequired: preset.keyRequired };
}

/** Replaces anything shaped like an API key, and the key itself, before a provider's text is shown. */
function redactSecrets(text, secret = "") {
  let value = String(text ?? "");
  if (secret && secret.length >= 6) value = value.split(secret).join("***");
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{4,}/gi, "Bearer ***")
    .replace(/\b(?:nvapi|sk-or-v1|sk-or|sk-proj|sk|gsk|xai|AIza)[-_A-Za-z0-9]{8,}/g, "***");
}

function oneLine(text, limit = PROVIDER_MESSAGE_LIMIT) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  return line.length > limit ? `${line.slice(0, limit - 1)}…` : line;
}

function retryAfterMs(response) {
  const raw = String(response?.headers?.get?.("retry-after") || "").trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

// The error message providers put in an error body: OpenAI's
// {"error":{"message"}}, Gemini's list of them, or a plain {"detail"}.
function providerMessage(body, rawText) {
  const candidates = [
    body?.error?.message,
    Array.isArray(body) ? body[0]?.error?.message : undefined,
    typeof body?.error === "string" ? body.error : undefined,
    body?.detail,
    body?.message,
    body?.error?.metadata?.raw,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return found || (body ? "" : rawText);
}

const TOOL_SUPPORT_REJECTED = /(?:does not|doesn't|do not|not)\s+support(?:ed)?\s+(?:for\s+)?(?:tools?|function|tool[_ ]?(?:calling|choice|use))|tool[_ ]?(?:calling|choice|use)\s+(?:is\s+)?not\s+(?:supported|enabled|available)|no endpoints found that support tool use|"auto" tool choice requires|tools? (?:are|is) not supported/i;
const CONTEXT_TOO_LONG = /context (?:length|window)|maximum context|too many tokens|prompt is too long|input is too long|reduce the length/i;

/** Turns a provider's failed answer into a ProviderError the chat can show. */
function classifyProviderFailure({ status, body, rawText, providerName, model, secret, retryAfter }) {
  const detail = redactSecrets(oneLine(providerMessage(body, rawText)), secret);
  const name = providerName || "The provider";
  const options = { status, expected: true };
  if (TOOL_SUPPORT_REJECTED.test(detail)) {
    return new ProviderError("no_tools", `The model “${model}” cannot call tools, and the Nextbrowser agent needs them to use the browser. Pick another model in Settings → Agent.`, options);
  }
  if (status === 401 || status === 403) {
    return new ProviderError("auth", `${name} rejected the API key. Check the key in Settings → Agent, or create a new one.`, options);
  }
  if (status === 429) {
    return new ProviderError("rate_limit", `${name}'s free limit is reached. Wait a minute and try again, or switch to another provider in Settings → Agent.`, { ...options, retryAfterMs: retryAfter });
  }
  if (status === 402) {
    return new ProviderError("payment", `${name} needs credits for “${model}”. Pick a free model in Settings → Agent.`, options);
  }
  if (status === 404) {
    return new ProviderError("model_not_found", `${name} has no model “${model}”. Pick another model in Settings → Agent.`, options);
  }
  if (status === 413 || CONTEXT_TOO_LONG.test(detail)) {
    return new ProviderError("context_too_long", `The task no longer fits in what “${model}” can read at once. Start a new chat, or pick a model with a larger context.`, options);
  }
  if (status >= 500) {
    return new ProviderError("server", `${name} had a server error (HTTP ${status}). Try again in a minute.`, { status });
  }
  return new ProviderError("bad_request", `${name} refused the request (HTTP ${status || "error"})${detail ? `: ${detail}` : "."}`, { status });
}

function parseJSON(text) {
  try { return JSON.parse(text); } catch { return undefined; }
}

function abortError() {
  return new ProviderError("cancelled", "The request was stopped.", { expected: true });
}

/**
 * fetch with a time limit of its own, aborted with the caller's signal too.
 * A plain setTimeout, not AbortSignal.timeout(): the timer is cleared as soon
 * as the provider answers.
 */
async function fetchWithin(fetchImpl, url, init, { signal, timeoutMs, providerName }) {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (timedOut) {
      throw new ProviderError("timeout", `${providerName} did not answer within ${Math.round(timeoutMs / 1000)} seconds. Try again, or pick a faster model.`, { networkCode: "TimeoutError" });
    }
    const code = typeof error?.cause?.code === "string" ? error.cause.code : typeof error?.code === "string" ? error.code : String(error?.name || "NetworkError");
    throw new ProviderError("network", `Nextbrowser could not reach ${providerName}. Check your internet connection, VPN or proxy, then try again.`, { networkCode: code, cause: error });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * A client for one provider. `apiKey` may be empty for a local server
 * (Ollama, LM Studio) that needs none.
 */
function createProviderClient({ provider, providerName, baseURL, apiKey = "", fetchImpl = (...args) => fetch(...args) }) {
  const name = providerName || PROVIDERS[provider]?.name || "The provider";
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    // OpenRouter lists the calling app by this header; it is optional.
    ...(provider === "openrouter" ? { "x-title": "Nextbrowser" } : {}),
  };
  return {
    async chat(body, { signal, timeoutMs = 120_000 } = {}) {
      const { response, text } = await fetchWithin(fetchImpl, `${baseURL}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }, { signal, timeoutMs, providerName: name });
      const parsed = parseJSON(text);
      if (!response.ok) {
        throw classifyProviderFailure({ status: response.status, body: parsed, rawText: text.slice(0, ERROR_BODY_LIMIT), providerName: name, model: body.model, secret: apiKey, retryAfter: retryAfterMs(response) });
      }
      // OpenRouter answers some upstream failures with HTTP 200 and an error body.
      if (parsed?.error && !Array.isArray(parsed?.choices)) {
        const status = Number(parsed.error.code) || 502;
        throw classifyProviderFailure({ status, body: parsed, rawText: "", providerName: name, model: body.model, secret: apiKey });
      }
      const message = parsed?.choices?.[0]?.message;
      if (!message || typeof message !== "object") {
        throw new ProviderError("bad_response", `${name} sent an answer Nextbrowser could not read. Try again, or pick another model.`, { status: response.status });
      }
      return { message, finishReason: parsed.choices[0].finish_reason || "", usage: parsed.usage };
    },

    async listModels({ signal, timeoutMs = 20_000 } = {}) {
      const { response, text } = await fetchWithin(fetchImpl, `${baseURL}/models`, {
        method: "GET",
        headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      }, { signal, timeoutMs, providerName: name });
      const parsed = parseJSON(text);
      if (!response.ok) {
        throw classifyProviderFailure({ status: response.status, body: parsed, rawText: text.slice(0, ERROR_BODY_LIMIT), providerName: name, model: "", secret: apiKey });
      }
      const list = Array.isArray(parsed?.data) ? parsed.data : Array.isArray(parsed?.models) ? parsed.models : [];
      return list
        .map((item) => describeModel(provider, item))
        .filter(Boolean);
    },
  };
}

const VISION_MODEL = /vision|[-_/]vl\b|[-_]vl[-_]|vlm|llava|pixtral|gemini|gpt-4o|gpt-4\.1|gpt-5|claude|gemma-3|llama-4|qwen2?\.5-vl|qwen3-vl|kimi-vl|phi-4-multimodal/i;

function describeModel(provider, item) {
  const rawId = typeof item === "string" ? item : item?.id ?? item?.name;
  // Gemini's OpenAI endpoint lists "models/gemini-…" but takes the bare name.
  const id = cleanModelId(String(rawId || "").replace(/^models\//, ""));
  if (!id) return undefined;
  const modalities = item?.architecture?.input_modalities;
  const parameters = item?.supported_parameters;
  return {
    id,
    vision: Array.isArray(modalities) ? modalities.includes("image") : VISION_MODEL.test(id),
    ...(Array.isArray(parameters) ? { tools: parameters.includes("tools") } : {}),
    ...(provider === "openrouter" ? { free: id.endsWith(":free") || id === OPENROUTER_FREE_ROUTER } : {}),
  };
}

/** Whether the model can look at a screenshot; judged by its listing when there is one, else by its name. */
function modelSupportsVision(model, listed = []) {
  const entry = listed.find((item) => item.id === model);
  if (entry) return entry.vision === true;
  return VISION_MODEL.test(String(model || ""));
}

// Models in the NVIDIA catalog that do not chat: embedders, rerankers, reward
// and safety models, document parsers, speech.
const NVIDIA_NOT_CHAT = /embed|rerank|reward|guard|safety|retriev|parse|ocr|clip|audio|asr|tts|speech|translate|pii|content-safety/i;

function nvidiaRank(id) {
  const name = id.toLowerCase();
  // Super is the documented tool-calling workhorse; Ultra is larger and
  // slower; Nano is fast but weak at multi-step tool use.
  const size = name.includes("super") ? 3 : name.includes("ultra") ? 2 : name.includes("nano") ? 1 : 0;
  return size;
}

/**
 * The model to preselect from a provider's list. NVIDIA: a chat Nemotron
 * model, Super before Ultra before Nano, the newest of that size first.
 * OpenRouter: its free router, else a free model that lists tool support.
 * Gemini: the newest plain Flash model.
 */
function defaultModelFor(provider, models = []) {
  const ids = models.map((item) => item.id);
  if (provider === "nvidia") {
    const nemotron = models
      .filter((item) => /nemotron/i.test(item.id) && !NVIDIA_NOT_CHAT.test(item.id))
      .sort((a, b) => (nvidiaRank(b.id) - nvidiaRank(a.id))
        || (Number(!!a.vision) - Number(!!b.vision))
        || b.id.localeCompare(a.id, "en", { numeric: true }));
    return nemotron[0]?.id || FALLBACK_MODELS.nvidia;
  }
  if (provider === "openrouter") {
    if (!ids.length || ids.includes(OPENROUTER_FREE_ROUTER)) return OPENROUTER_FREE_ROUTER;
    const free = models.filter((item) => item.free && item.tools !== false);
    return free.find((item) => item.tools)?.id || free[0]?.id || OPENROUTER_FREE_ROUTER;
  }
  if (provider === "gemini") {
    const flash = ids
      .filter((id) => /^gemini-[\d.]+-flash$/.test(id))
      .sort((a, b) => b.localeCompare(a, "en", { numeric: true }));
    return flash[0] || ids.find((id) => /flash/.test(id) && !/lite|image|tts|live|audio/.test(id)) || FALLBACK_MODELS.gemini;
  }
  return ids[0] || "";
}

/**
 * The models worth offering for a provider: chat models only for NVIDIA, the
 * free ones (and the free router) for OpenRouter, Gemini's Gemini models.
 */
function offeredModels(provider, models = []) {
  if (provider === "nvidia") return models.filter((item) => !NVIDIA_NOT_CHAT.test(item.id));
  if (provider === "openrouter") {
    const free = models.filter((item) => item.free && item.tools !== false);
    return [{ id: OPENROUTER_FREE_ROUTER, vision: false, free: true }, ...free.filter((item) => item.id !== OPENROUTER_FREE_ROUTER)];
  }
  if (provider === "gemini") return models.filter((item) => /^gemini-/.test(item.id) && !/embedding|aqa|imagen|veo|tts|live/i.test(item.id));
  return models;
}

const TEST_TOOL = {
  type: "function",
  function: {
    name: "ping",
    description: "Connection check. Call it once with text \"ok\".",
    parameters: { type: "object", properties: { text: { type: "string", description: "Send \"ok\"." } }, required: ["text"] },
  },
};

/**
 * Sends one tiny request with one dummy tool and says what it proved: the key
 * works, the model calls tools, or why not.
 */
async function testProvider({ client, model, providerName, signal, timeoutMs = 60_000 }) {
  try {
    const { message } = await client.chat({
      model,
      messages: [
        { role: "system", content: "You are a connection test. Call the ping tool once with text \"ok\"." },
        { role: "user", content: "Call the ping tool now." },
      ],
      tools: [TEST_TOOL],
      tool_choice: "auto",
      max_tokens: 256,
      temperature: 0,
    }, { signal, timeoutMs });
    const called = Array.isArray(message.tool_calls) && message.tool_calls.some((call) => call?.function?.name === "ping");
    return called
      ? { ok: true, key: "ok", tools: "ok", message: `${providerName} accepted the key, and “${model}” can call tools.` }
      : { ok: true, key: "ok", tools: "unknown", message: `${providerName} accepted the key, but “${model}” answered without calling the test tool. It may not use the browser reliably; if tasks fail, pick another model.` };
  } catch (error) {
    if (!(error instanceof ProviderError)) throw error;
    const keyChecked = ["no_tools", "model_not_found", "rate_limit", "payment", "context_too_long", "bad_request"].includes(error.code);
    return {
      ok: false,
      code: error.code,
      key: error.code === "auth" ? "failed" : keyChecked ? "ok" : "unknown",
      tools: error.code === "no_tools" ? "no" : "unknown",
      message: error.message,
    };
  }
}

module.exports = {
  DEFAULT_PROVIDER,
  FALLBACK_MODELS,
  OPENROUTER_FREE_ROUTER,
  PROVIDERS,
  ProviderError,
  classifyProviderFailure,
  cleanModelId,
  createProviderClient,
  defaultModelFor,
  describeModel,
  modelSupportsVision,
  normalizeBaseURL,
  offeredModels,
  redactSecrets,
  resolveProviderSettings,
  testProvider,
};
