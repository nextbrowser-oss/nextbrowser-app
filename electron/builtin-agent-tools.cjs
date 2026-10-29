// The browser tools the built-in Nextbrowser agent gets from `nbc mcp`.
// nbc offers about eighty tools; a free model handed all of them picks the
// wrong one or none, so the agent sees a small allowlist with the arguments a
// task needs, in a JSON schema every OpenAI-compatible provider accepts.

// In the order the model reads them. screenshot is offered to vision models only.
const BUILTIN_AGENT_TOOLS = Object.freeze([
  "profiles_list", "start", "open", "state", "click", "input", "press", "select",
  "scroll", "wait", "extract", "tabs_list", "tabs_activate", "save_artifact",
]);
const VISION_TOOLS = Object.freeze(["screenshot"]);

// The arguments each tool keeps. The rest (CDP endpoints, launcher flags,
// fingerprint switches) only give a weak model ways to go wrong.
const TOOL_PROPERTIES = Object.freeze({
  profiles_list: ["runtime"],
  start: ["profile", "runtime", "url", "profile_id", "folder_id", "wait_for", "return_state"],
  open: ["profile", "url", "new_tab"],
  state: ["profile"],
  click: ["profile", "element_id", "wait_for", "return_state"],
  input: ["profile", "element_id", "text", "wait_for", "return_state"],
  press: ["profile", "key", "wait_for", "return_state"],
  select: ["profile", "element_id", "value", "return_state"],
  scroll: ["profile", "amount", "return_state"],
  wait: ["profile", "load", "selector", "text", "settle", "timeout"],
  extract: ["profile", "container", "fields", "limit"],
  tabs_list: ["profile"],
  tabs_activate: ["profile", "tab_id"],
  save_artifact: ["name", "format", "content"],
  screenshot: ["profile", "full_page"],
});

const TOOL_DESCRIPTIONS = Object.freeze({
  profiles_list: "List the browser profiles this chat may use.",
  start: "Start a browser profile (or reuse it when it is already running) and optionally open a URL in it. Use a profile name from the context.",
  open: "Open a URL in the profile's current tab.",
  state: "Read the current page: URL, title, visible text, and interactive elements with numeric IDs. Call it before you click, type or select.",
  click: "Click an element by the ID that state returned.",
  input: "Type text into an input by the ID that state returned. It replaces the current value.",
  press: "Press one key on the page: Enter, Tab, Escape, Space, Backspace, Delete, or an arrow key.",
  select: "Choose an option in a <select> element by the ID that state returned.",
  scroll: "Scroll the page by a number of pixels: positive scrolls down, negative up.",
  wait: "Wait until the page has loaded, or until a CSS selector or a text appears.",
  extract: "Read many repeated records (search results, products, table rows, links) at once with CSS selectors.",
  tabs_list: "List the open tabs of the profile.",
  tabs_activate: "Switch to a tab by the tab_id from tabs_list.",
  save_artifact: "Save a result as a file in this workspace's Artifact Center (json, csv or txt). Only when the user asks to save something.",
  screenshot: "Take a screenshot of the current page to look at it.",
});

// After these the model gets the page's new state in the same call: one model
// request less per action, and an up-to-date list of element IDs.
const RETURN_STATE_BY_DEFAULT = new Set(["click", "input", "press", "select", "scroll"]);
const START_TIMEOUT_MS = 180_000;

// JSON-schema keywords some providers reject in function parameters
// (Gemini's OpenAI endpoint, older vLLM builds) and a model does not need.
const DROPPED_KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "$comment", "definitions", "oneOf", "anyOf", "allOf", "not", "if", "then", "else",
  "exclusiveMinimum", "exclusiveMaximum", "minProperties", "maxProperties", "minItems", "maxItems", "uniqueItems",
  "default", "examples", "format", "pattern", "patternProperties", "const", "contentEncoding", "contentMediaType",
  "readOnly", "writeOnly", "deprecated", "title", "propertyNames", "dependentRequired", "dependentSchemas",
]);
const KEPT_KEYWORDS = new Set(["type", "description", "properties", "required", "items", "enum", "minimum", "maximum", "additionalProperties"]);

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function schemaType(type) {
  if (!Array.isArray(type)) return typeof type === "string" ? type : undefined;
  return type.find((candidate) => candidate !== "null") || type[0];
}

/**
 * An MCP inputSchema as OpenAI function `parameters`. `strict` is for
 * providers that reject a map schema (additionalProperties holding a schema)
 * or a property without a type: the map's shape moves into its description,
 * and an untyped value becomes a string.
 */
function toOpenAIParameters(schema, { strict = false, keep } = {}) {
  const convert = (node, depth) => {
    if (!plainObject(node) || depth > 12) return { type: "string" };
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (DROPPED_KEYWORDS.has(key) || !KEPT_KEYWORDS.has(key)) continue;
      if (key === "type") {
        const type = schemaType(value);
        if (type) out.type = type;
      } else if (key === "properties" && plainObject(value)) {
        out.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, convert(child, depth + 1)]));
      } else if (key === "items") {
        out.items = convert(Array.isArray(value) ? value[0] : value, depth + 1);
      } else if (key === "required" && Array.isArray(value)) {
        out.required = value.filter((name) => typeof name === "string");
      } else if (key === "additionalProperties") {
        // A boolean only tells the provider to be strict; drop it. A schema
        // means "a map of name to this", which strict providers cannot take.
        if (!plainObject(value)) continue;
        if (strict) {
          const shape = Object.keys(value.properties || {}).join(", ");
          out.mapShape = `A JSON object whose keys you choose${shape ? `; each value is an object with ${shape}` : ""}.`;
        } else {
          out.additionalProperties = convert(value, depth + 1);
        }
      } else if (key === "enum" && Array.isArray(value)) {
        out.enum = value.filter((item) => ["string", "number", "boolean"].includes(typeof item));
      } else if (key === "description" && typeof value === "string") {
        if (!out.description) out.description = value;
      } else if ((key === "minimum" || key === "maximum") && typeof value === "number") {
        out[key] = value;
      }
    }
    if (!out.type) {
      if (out.properties) out.type = "object";
      else if (out.items) out.type = "array";
      else if (strict) out.type = "string";
    }
    // Strict providers want an object to name its properties. A map, or an
    // object of any shape, is sent as JSON text instead; coerceArguments
    // turns it back into an object before the call.
    if (strict && depth > 0 && out.type === "object" && !Object.keys(out.properties || {}).length) {
      out.type = "string";
      delete out.properties;
      out.description = [out.description, out.mapShape || "A JSON object."].filter(Boolean).join(" ");
    }
    delete out.mapShape;
    if (out.required && out.properties) out.required = out.required.filter((name) => name in out.properties);
    if (out.required && !out.required.length) delete out.required;
    return out;
  };
  const converted = convert(plainObject(schema) ? schema : { type: "object" }, 0);
  converted.type = "object";
  converted.properties = converted.properties || {};
  if (Array.isArray(keep)) {
    converted.properties = Object.fromEntries(keep.filter((name) => name in converted.properties).map((name) => [name, converted.properties[name]]));
    if (converted.required) converted.required = converted.required.filter((name) => name in converted.properties);
    if (converted.required && !converted.required.length) delete converted.required;
  }
  return converted;
}

/** The allowlisted tools nbc actually offers, as OpenAI tool definitions. */
function selectTools(mcpTools, { vision = false, strict = false } = {}) {
  const byName = new Map((Array.isArray(mcpTools) ? mcpTools : []).filter((tool) => tool && typeof tool.name === "string").map((tool) => [tool.name, tool]));
  const names = [...BUILTIN_AGENT_TOOLS, ...(vision ? VISION_TOOLS : [])].filter((name) => byName.has(name));
  return names.map((name) => {
    const tool = byName.get(name);
    return {
      type: "function",
      function: {
        name,
        description: TOOL_DESCRIPTIONS[name] || String(tool.description || "").slice(0, 300),
        parameters: toOpenAIParameters(tool.inputSchema, { strict, keep: TOOL_PROPERTIES[name] }),
      },
    };
  });
}

/**
 * Brings a weak model's arguments in line with the tool's own (MCP) schema:
 * "12" for an integer ID, "true" for a flag, JSON text where an object
 * belongs. Only top-level arguments are touched.
 */
function coerceArguments(args, schema) {
  const properties = schema?.properties || {};
  const out = {};
  for (const [name, value] of Object.entries(args || {})) {
    const type = schemaType(properties[name]?.type);
    if (typeof value === "string") {
      const text = value.trim();
      if ((type === "integer" || type === "number") && text && Number.isFinite(Number(text))) {
        out[name] = type === "integer" ? Math.trunc(Number(text)) : Number(text);
        continue;
      }
      if (type === "boolean" && /^(?:true|false)$/i.test(text)) {
        out[name] = text.toLowerCase() === "true";
        continue;
      }
      if ((type === "object" || type === "array") && /^[[{]/.test(text)) {
        try { out[name] = JSON.parse(text); continue; } catch { /* left as the model sent it */ }
      }
    }
    out[name] = value;
  }
  return out;
}

const RESULT_TRUNCATED = "…[cut here to save space. Use extract, or wait with a selector, to read a specific part.]";

function truncateText(text, limit) {
  const value = String(text ?? "");
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - RESULT_TRUNCATED.length))}${RESULT_TRUNCATED}`;
}

/**
 * An MCP tool result as the text the model reads, cut to `limit` characters.
 * Images go back separately and only to a vision model.
 */
function toolResultForModel(result, { limit = 8_000, vision = false } = {}) {
  const parts = Array.isArray(result?.content) ? result.content : [];
  const texts = [];
  const images = [];
  for (const part of parts) {
    if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
    else if (part?.type === "image" && typeof part.data === "string" && part.data) images.push({ data: part.data, mimeType: String(part.mimeType || "image/png") });
  }
  let text = texts.join("\n").trim();
  if (!text) text = images.length ? (vision ? "Screenshot taken; it follows as an image." : "Screenshot taken, but this model cannot see images.") : "Done (no output).";
  if (result?.isError) text = `Error: ${text}`;
  return { text: truncateText(text, limit), images: vision ? images : [], isError: result?.isError === true };
}

// What makes a browser call recognisable in the chat's step list. The text
// typed into a field is left out: it can be a password.
function callTarget(name, args) {
  if (!args || typeof args !== "object") return "";
  if (typeof args.url === "string" && args.url.trim()) return args.url.trim();
  if (name === "start" && typeof args.profile === "string") return args.profile;
  if (typeof args.selector === "string" && args.selector.trim()) return args.selector.trim();
  if (typeof args.key === "string") return args.key;
  if (Number.isInteger(args.element_id)) return `#${args.element_id}`;
  if (typeof args.tab_id === "string") return args.tab_id;
  if (name === "save_artifact" && typeof args.name === "string") return args.name;
  return "";
}

function stepLine(name, args) {
  const target = callTarget(name, args);
  const line = `nextbrowser: ${name.replace(/_/g, " ")}${target ? ` ${target}` : ""}`;
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * The toolset of one run over an initialized MCP client. `defaultProfile`
 * fills in the chat's profile when the model leaves it out.
 */
function createMCPToolset({ client, mcpTools, vision = false, strict = false, defaultProfile = "", timeoutMs = 120_000, resultLimit = 8_000 }) {
  const definitions = selectTools(mcpTools, { vision, strict });
  const parametersByName = new Map(definitions.map((tool) => [tool.function.name, tool.function.parameters]));
  const mcpSchemas = new Map((Array.isArray(mcpTools) ? mcpTools : []).map((tool) => [tool?.name, tool?.inputSchema]));
  return {
    definitions,
    names: [...parametersByName.keys()],
    has: (name) => parametersByName.has(name),
    prepare(name, args) {
      const parameters = parametersByName.get(name);
      // Arguments the agent was not offered (a CDP endpoint, launcher flags) are dropped.
      const offered = parameters?.properties || {};
      const prepared = Object.fromEntries(Object.entries(coerceArguments(args, mcpSchemas.get(name))).filter(([key]) => key in offered));
      if (defaultProfile && parameters?.properties?.profile && !prepared.profile && !prepared.profile_id) prepared.profile = defaultProfile;
      if (RETURN_STATE_BY_DEFAULT.has(name) && prepared.return_state === undefined && parameters?.properties?.return_state) prepared.return_state = true;
      if (name === "start" && prepared.url && prepared.return_state === undefined) prepared.return_state = true;
      if (name === "save_artifact" && typeof prepared.content === "string" && (prepared.format || "json") === "json") {
        try { prepared.content = JSON.parse(prepared.content); } catch { /* saved as text */ }
      }
      return prepared;
    },
    async call(name, args) {
      // A first start can wait for a profile check or a slow proxy.
      const result = await client.callTool(name, args, name === "start" ? Math.max(timeoutMs, START_TIMEOUT_MS) : timeoutMs);
      return toolResultForModel(result, { limit: resultLimit, vision });
    },
  };
}

module.exports = {
  BUILTIN_AGENT_TOOLS,
  TOOL_PROPERTIES,
  VISION_TOOLS,
  coerceArguments,
  createMCPToolset,
  selectTools,
  stepLine,
  toOpenAIParameters,
  toolResultForModel,
  truncateText,
};
