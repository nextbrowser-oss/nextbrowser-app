const { spawn } = require("node:child_process");
const { assertArtifactDataContract } = require("./automation-artifact.cjs");

const MAX_ACTIONS = 100;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const CALL_TIMEOUT_MS = 120_000;
const TOOL_ALIASES = new Map([["navigate", "open"]]);
const DIRECT_TOOLS = new Set([
  "open", "wait", "click", "input", "press", "select", "scroll", "dismiss", "upload",
  "extract", "paginate_extract", "tabs_extract", "multi_action", "form_fill", "site_recipe_run", "evaluate",
]);
const LOCAL_TOOLS = new Set(["save_artifact"]);
const activeExecutions = new Map();
const RETRYABLE_NAVIGATION_ERRORS = [
  "ERR_SSL_PROTOCOL_ERROR",
  "ERR_NETWORK_CHANGED",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED",
  "ERR_TUNNEL_CONNECTION_FAILED",
  "ERR_TIMED_OUT",
];
const RETRYABLE_DATA_ERROR = /(?:did not return exactly|expected\s+(?:at\s+least\s+)?\d+\s+(?:fully\s+)?populated|returned only empty|data (?:is )?not (?:ready|loaded)|incomplete (?:rows|data)|(?:table|list|results?|rows?) (?:was |were )?not found|no (?:rows|data) (?:yet|available))/i;
const UNSAFE_EVALUATION = /(document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|caches\s*\.|navigator\s*\.\s*(clipboard|sendBeacon)|fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|\.\s*(click|submit|remove)\s*\(|\.\s*(innerHTML|outerHTML|textContent|innerText|value)\s*=|eval\s*\(|new\s+Function|location\s*=|window\s*\.\s*open)/i;

function cleanExecutionId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 128 || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("Invalid automation execution ID.");
  return id;
}

function plainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateRecipe(recipe) {
  if (!plainObject(recipe) || recipe.version !== 1 || !Array.isArray(recipe.actions)) throw new Error("The workflow recipe is invalid.");
  if (!recipe.actions.length) throw new Error("The workflow has no browser steps.");
  if (recipe.actions.length > MAX_ACTIONS) throw new Error(`A workflow can contain at most ${MAX_ACTIONS} browser steps.`);
  return recipe.actions.map((action, index) => {
    if (!plainObject(action) || typeof action.tool !== "string" || !plainObject(action.arguments)) {
      throw new Error(`Step ${index + 1} is not a valid browser action.`);
    }
    return { tool: action.tool.replace(/^(?:clawbrowser|nextbrowser)\./, ""), arguments: structuredClone(action.arguments) };
  });
}

function expandTemplates(value, parameters) {
  if (Array.isArray(value)) return value.map((item) => expandTemplates(item, parameters));
  if (plainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expandTemplates(item, parameters)]));
  if (typeof value !== "string") return value;
  const exact = value.match(/^\{\{([A-Za-z0-9_.-]+)\}\}$/);
  if (exact) return parameters[exact[1]] ?? value;
  return value.replace(/\{\{([A-Za-z0-9_.-]+)\}\}/g, (match, key) => parameters[key] == null ? match : String(parameters[key]));
}

function scrubSessionArguments(args) {
  const clean = { ...args };
  for (const key of ["profile", "cdp", "runtime", "remote", "required_rows"]) delete clean[key];
  return clean;
}

function locatorFrom(args) {
  if (plainObject(args.locator)) {
    const locator = {};
    for (const key of ["css", "role", "name", "text"]) if (typeof args.locator[key] === "string" && args.locator[key].trim()) locator[key] = args.locator[key].trim();
    if (Object.keys(locator).length) return locator;
  }
  if (typeof args.selector === "string" && args.selector.trim()) return { css: args.selector.trim() };
  return undefined;
}

function semanticLocatorPrelude(locator) {
  return `const locator=${JSON.stringify(locator)}; const norm=value=>String(value||"").replace(/\\s+/g," ").trim().toLowerCase(); const implicitRole=element=>element.getAttribute("role")||({BUTTON:"button",A:"link",INPUT:element.type==="checkbox"?"checkbox":element.type==="radio"?"radio":"textbox",TEXTAREA:"textbox",SELECT:"combobox"}[element.tagName]||""); const accessibleName=element=>{const labelledBy=String(element.getAttribute("aria-labelledby")||"").split(/\\s+/).filter(Boolean).map(id=>document.getElementById(id)?.innerText||document.getElementById(id)?.textContent||"").join(" "); const labels=Array.from(element.labels||[]).map(label=>label.innerText||label.textContent||"").join(" "); return element.getAttribute("aria-label")||labelledBy||labels||element.innerText||element.textContent||element.value||element.placeholder||element.title||"";};`;
}

function selectorEvaluation(tool, args) {
  const locator = locatorFrom(args);
  if (!locator?.css) return undefined;
  const prefix = `(() => { ${semanticLocatorPrelude(locator)} const candidates=locator.css?[document.querySelector(locator.css)].filter(Boolean):Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[aria-label]")); const element=candidates.find(candidate=>(!locator.role||norm(implicitRole(candidate))===norm(locator.role))&&(!locator.name||norm(accessibleName(candidate)).includes(norm(locator.name)))&&(!locator.text||norm(candidate.innerText||candidate.textContent).includes(norm(locator.text)))); if (!element) throw new Error("No element matches the saved locator");`;
  if (tool === "click") return `${prefix} element.click(); return {ok:true,action:"click",locator,url:location.href}; })()`;
  if (tool === "input") {
    const text = String(args.text ?? args.value ?? "");
    return `${prefix} const value=${JSON.stringify(text)}; const setter=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element),"value")?.set; if(setter)setter.call(element,value);else element.value=value; element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true,action:"input",locator}; })()`;
  }
  if (tool === "select") {
    const value = String(args.value ?? "");
    return `${prefix} if(!(element instanceof HTMLSelectElement)) throw new Error("Matched element is not a select"); const value=${JSON.stringify(value)}; const option=Array.from(element.options).find(item=>item.value===value||item.textContent?.trim()===value); if(!option)throw new Error("Select option was not found"); element.value=option.value; element.dispatchEvent(new Event("input",{bubbles:true})); element.dispatchEvent(new Event("change",{bubbles:true})); return {ok:true,action:"select",locator,value:option.value}; })()`;
  }
  return undefined;
}

function semanticActionCalls(tool, args) {
  const locator = locatorFrom(args);
  if (!locator || locator.css || !["click", "input", "select", "press"].includes(tool)) return undefined;
  const directControlClick = tool === "click" && ["button", "checkbox", "radio"].includes(String(locator.role || "").toLowerCase());
  const expression = `(() => { ${semanticLocatorPrelude(locator)} const element=Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[aria-label]")).find(candidate=>(!locator.role||norm(implicitRole(candidate))===norm(locator.role))&&(!locator.name||norm(accessibleName(candidate)).includes(norm(locator.name)))&&(!locator.text||norm(candidate.innerText||candidate.textContent).includes(norm(locator.text)))); if(!element)throw new Error("No element matches the saved locator"); element.scrollIntoView({block:"center",inline:"nearest"}); ${directControlClick ? "element.click(); return {ok:true,action:\"click\",locator,tag:element.tagName.toLowerCase(),checked:typeof element.checked===\"boolean\"?element.checked:undefined};" : tool === "press" ? "element.focus(); return {ok:true,action:\"focus\",locator,tag:element.tagName.toLowerCase()};" : "return {ok:true,locator,tag:element.tagName.toLowerCase(),href:element instanceof HTMLAnchorElement?element.href:undefined};"} })()`;
  if (directControlClick) {
    const calls = [{ name: "evaluate", arguments: { expression } }];
    const wait = postActionWait(args);
    if (wait) calls.push({ name: "wait", arguments: wait });
    return calls;
  }
  if (tool === "press") return [{ name: "evaluate", arguments: { expression } }, { name: "press", arguments: { key: String(args.key || "Enter") } }];
  return [{ name: "evaluate", arguments: { expression } }, { name: "state", arguments: {} }, { name: "__semantic_action", arguments: { tool, locator, original: args } }];
}

function resolveSemanticAction(spec, snapshot, descriptor) {
  if (spec.tool === "click" && descriptor?.tag === "a" && typeof descriptor.href === "string" && /^https?:\/\//.test(descriptor.href)) {
    return { name: "open", arguments: { url: descriptor.href } };
  }
  const elements = Array.isArray(snapshot?.elements) ? snapshot.elements : [];
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const matches = elements.filter((element) =>
    (!spec.locator.role || normalize(element.role) === normalize(spec.locator.role)) &&
    (!spec.locator.name || normalize(element.name).includes(normalize(spec.locator.name))) &&
    (!spec.locator.text || normalize(element.name).includes(normalize(spec.locator.text))),
  );
  if (!matches.length) throw new Error(`No element matches the saved ${spec.locator.role || ""} ${spec.locator.name || spec.locator.text || "locator"}`.replace(/\s+/g, " ").trim());
  if (matches.length > 1) throw new Error(`The saved locator matches ${matches.length} elements. Add a role or a more specific accessible name.`);
  const args = scrubSessionArguments({ ...spec.original, element_id: matches[0].id });
  delete args.locator;
  delete args.selector;
  return { name: spec.tool, arguments: args };
}

function postActionWait(args) {
  if (plainObject(args.wait_for)) return scrubSessionArguments(args.wait_for);
  if (typeof args.wait_for === "string" && args.wait_for.trim()) return { selector: args.wait_for.trim() };
  return undefined;
}

function normalizedExtractionArguments(tool, args) {
  if (!["extract", "paginate_extract", "tabs_extract"].includes(tool) || !plainObject(args.fields)) return args;
  const transforms = plainObject(args.transform) ? args.transform : {};
  const containerIsLink = /(?:^|[\s>+~])a(?:$|[.#:]|\[)/i.test(String(args.container || ""));
  let changed = false;
  const fields = Object.fromEntries(Object.entries(args.fields).map(([name, value]) => {
    if (!plainObject(value) || (transforms[name] !== "url" && !/(?:^|_)(?:url|href|link)(?:$|_)/i.test(name))) return [name, value];
    const field = { ...value };
    if (!String(field.selector || "").trim() && !containerIsLink) {
      field.selector = "a[href]";
      changed = true;
    }
    if (!String(field.attribute || "").trim()) {
      field.attribute = "href";
      changed = true;
    }
    return [name, field];
  }));
  return changed ? { ...args, fields } : args;
}

function toolCalls(action) {
  let tool = TOOL_ALIASES.get(action.tool) || action.tool;
  let args = scrubSessionArguments(action.arguments);
  const outerWait = postActionWait(args);
  if (tool === "act") {
    let nestedTool = typeof args.tool === "string" ? args.tool : typeof args.type === "string" ? args.type : typeof args.action === "string" ? args.action : "";
    if (nestedTool === "type" || nestedTool === "fill") nestedTool = "input";
    const nestedArgs = plainObject(args.arguments) ? args.arguments : args;
    if (!nestedTool) throw new Error("A generic recorded interaction needs AI repair before deterministic replay.");
    tool = TOOL_ALIASES.get(nestedTool) || nestedTool;
    args = scrubSessionArguments(nestedArgs);
  }
  const wait = postActionWait(args) || outerWait;
  if (Object.prototype.hasOwnProperty.call(args, "wait_for")) {
    args = { ...args };
    delete args.wait_for;
  }
  args = normalizedExtractionArguments(tool, args);
  if (!DIRECT_TOOLS.has(tool)) throw new Error(`The browser action “${tool}” is not supported by deterministic replay.`);
  if (tool === "evaluate") {
    const expression = String(args.expression || "").trim();
    if (!expression || expression.length > 32 * 1024 || UNSAFE_EVALUATION.test(expression)) {
      throw new Error("The saved page data script is missing or uses browser data/actions that cannot be replayed safely.");
    }
  }
  if (tool === "scroll" && Number.isFinite(args.x) && Number.isFinite(args.y)) {
    return [{ name: "evaluate", arguments: { expression: `(() => { scrollTo(${Math.round(args.x)},${Math.round(args.y)}); return {ok:true,x:scrollX,y:scrollY}; })()` } }];
  }
  if (["extract", "paginate_extract", "tabs_extract"].includes(tool) && (!args.container || !plainObject(args.fields))) {
    throw new Error(`${tool} needs a CSS row container and named field locators.`);
  }
  if (tool === "paginate_extract" && !args.next_selector && args.scroll !== true) {
    throw new Error("paginate_extract needs a Next button selector or scrolling enabled.");
  }
  const semantic = semanticActionCalls(tool, args);
  if (semantic) {
    if (wait) semantic.push({ name: "wait", arguments: wait });
    return semantic;
  }
  const pressLocator = locatorFrom(args);
  if (tool === "press" && pressLocator?.css) {
    const expression = `(() => { const element=document.querySelector(${JSON.stringify(pressLocator.css)}); if(!element)throw new Error("No element matches the saved locator"); element.scrollIntoView({block:"center",inline:"nearest"}); element.focus(); return {ok:true,action:"focus"}; })()`;
    const calls = [{ name: "evaluate", arguments: { expression } }, { name: "press", arguments: { key: String(args.key || "Enter") } }];
    if (wait) calls.push({ name: "wait", arguments: wait });
    return calls;
  }
  const evaluation = selectorEvaluation(tool, args);
  if (evaluation) {
    const calls = [{ name: "evaluate", arguments: { expression: evaluation } }];
    if (wait) calls.push({ name: "wait", arguments: wait });
    return calls;
  }
  const calls = [{ name: tool, arguments: args }];
  if (wait) calls.push({ name: "wait", arguments: wait });
  return calls;
}

function resultText(result) {
  return (result?.content || []).filter((item) => item?.type === "text").map((item) => item.text).join("\n").trim();
}

function parseToolResult(result) {
  const text = resultText(result);
  if (result?.isError) throw new Error(text || "The browser action failed.");
  if (!text) return null;
  try { return JSON.parse(text); }
  catch { return text; }
}

function meaningfulPageData(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.some(meaningfulPageData);
  if (plainObject(value)) return Object.values(value).some(meaningfulPageData);
  return false;
}

const ORDINAL_DATA_KEYS = new Set(["rank", "index", "position", "order", "row_number", "rowNumber"]);

function meaningfulDataRow(value) {
  if (!plainObject(value)) return meaningfulPageData(value);
  const entries = Object.entries(value);
  const contentEntries = entries.filter(([key]) => !ORDINAL_DATA_KEYS.has(key));
  // Rank-like values only describe where an item appeared. They must not make
  // an otherwise empty extraction look successful.
  return (contentEntries.length ? contentEntries : entries).some(([, item]) => meaningfulPageData(item));
}

function completeDataRows(value) {
  const rows = extractionRows(value);
  return Array.isArray(rows) && rows.length > 0 && rows.every(meaningfulDataRow);
}

function assertMeaningfulEvaluateOutput(output) {
  const data = plainObject(output) && Object.prototype.hasOwnProperty.call(output, "result") ? output.result : output;
  const rows = extractionRows(data);
  if ((rows && !completeDataRows(data)) || (!rows && !meaningfulPageData(data))) {
    throw new Error("The page data script returned only empty values. Add a wait step or repair its page selectors before saving the result.");
  }
}

function extractionRows(value) {
  if (Array.isArray(value)) return value;
  if (!plainObject(value)) return undefined;
  if (Array.isArray(value.rows)) return value.rows;
  for (const key of ["result", "data", "value"]) {
    const rows = extractionRows(value[key]);
    if (rows) return rows;
  }
  return undefined;
}

function assertMeaningfulExtractionOutput(output) {
  if (!completeDataRows(output)) {
    throw new Error("The saved extraction returned only empty rows. Wait for the page data or repair its field selectors before saving the result.");
  }
}

function assertExtractionFieldSemantics(action, output) {
  const rows = extractionRows(output);
  if (!Array.isArray(rows) || !plainObject(action?.arguments?.fields)) return;
  const transforms = plainObject(action.arguments.transform) ? action.arguments.transform : {};
  for (const field of Object.keys(action.arguments.fields)) {
    if (transforms[field] !== "url" && !/(?:^|_)(?:url|href|link)(?:$|_)/i.test(field)) continue;
    if (!rows.every((row) => {
      const value = row?.[field];
      if (typeof value !== "string") return false;
      try { return ["http:", "https:"].includes(new URL(value).protocol); }
      catch { return false; }
    })) throw new Error(`The saved extraction returned an invalid “${field}” URL. Repair its link selector before saving the result.`);
  }
}

function assertRequiredExtractionRows(action, output) {
  const required = Number(action?.arguments?.required_rows);
  if (!Number.isInteger(required) || required < 1) return;
  const rows = extractionRows(output);
  if (!Array.isArray(rows) || rows.length < required) {
    throw new Error(`The page returned ${Array.isArray(rows) ? rows.length : 0} complete result rows, but this workflow requires ${required}. Repair the extraction before saving the artifact.`);
  }
}

function hasMeaningfulActionData(tool, output) {
  if (tool === "evaluate") {
    const data = plainObject(output) && Object.prototype.hasOwnProperty.call(output, "result") ? output.result : output;
    const rows = extractionRows(data);
    return rows ? completeDataRows(data) : meaningfulPageData(data);
  }
  if (["extract", "paginate_extract", "tabs_extract"].includes(tool)) {
    return completeDataRows(output);
  }
  return true;
}

function isRetryableNavigationError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return RETRYABLE_NAVIGATION_ERRORS.some((code) => message.includes(code));
}

async function callBrowserTool(client, call, options = {}) {
  const attempts = call.name === "open" ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return parseToolResult(await client.callTool(call.name, call.arguments));
    } catch (error) {
      if (attempt + 1 >= attempts || !isRetryableNavigationError(error) || options.cancelled?.()) throw error;
      options.onRetry?.(attempt + 1, error);
      await (options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(attempt === 0 ? 400 : 900);
    }
  }
}

async function callDataTool(client, call, tool, options = {}) {
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    try {
      return await callBrowserTool(client, call, options);
    } catch (error) {
      if (attempt >= 20 || !["evaluate", "extract", "paginate_extract", "tabs_extract"].includes(tool)
        || !RETRYABLE_DATA_ERROR.test(error instanceof Error ? error.message : String(error)) || options.cancelled?.()) throw error;
      options.onDataWait?.(attempt + 1);
      await (options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(500);
    }
  }
}

function boundedOutput(value, maxBytes = 1_500_000) {
  if (value == null) return value;
  try {
    const json = JSON.stringify(value);
    if (Buffer.byteLength(json) <= maxBytes) return value;
    if (plainObject(value) && Array.isArray(value.rows)) {
      return { ...value, rows: value.rows.slice(0, 25), truncated: true, original_count: value.count ?? value.rows.length };
    }
    return { truncated: true, preview: json.slice(0, 16_000), original_bytes: Buffer.byteLength(json) };
  } catch {
    return { truncated: true, preview: String(value).slice(0, 16_000) };
  }
}

function createMCPClient({ binary, args, env, spawnImpl = spawn }) {
  const child = spawnImpl(binary, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let sequence = 0;
  let stdoutBuffer = "";
  let stderr = "";
  let closed = false;

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "MCP request failed."));
      else request.resolve(message.result);
    }
  });
  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-MAX_OUTPUT_BYTES); });
  child.once("error", (error) => { closed = true; rejectPending(error); });
  child.once("close", (code) => {
    closed = true;
    rejectPending(new Error(stderr.trim() || `Browser runner exited with code ${code ?? -1}.`));
  });

  const send = (message) => {
    if (closed || !child.stdin.writable) throw new Error(stderr.trim() || "Browser runner is not available.");
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };
  const request = (method, params, timeoutMs = CALL_TIMEOUT_MS) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out after ${Math.ceil(timeoutMs / 1_000)} seconds.`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try { send({ jsonrpc: "2.0", id, method, params }); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });

  return {
    async initialize() {
      await request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "nextbrowser-automation", version: "1" } }, 30_000);
      send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
    },
    callTool: (name, arguments) => request("tools/call", { name, arguments }),
    close() {
      if (closed) return;
      closed = true;
      rejectPending(new Error("Automation execution was cancelled."));
      child.kill("SIGTERM");
    },
  };
}

async function executeAutomationRecipe(input, deps) {
  const executionId = cleanExecutionId(input.executionId);
  if (activeExecutions.has(executionId)) throw new Error("This automation execution is already running.");
  const actions = validateRecipe(input.recipe);
  const profile = String(input.profile || "").trim();
  const runtime = ["clawbrowser", "camoufox", "chromium", "multilogin"].includes(input.runtime) ? input.runtime : "clawbrowser";
  const mcpArgs = [...(profile ? ["--profile", profile] : []), "--runtime", runtime, ...(input.runtimeBin ? ["--runtime-bin", input.runtimeBin] : []), "mcp"];
  const client = createMCPClient({ binary: deps.binary, args: mcpArgs, env: deps.env, spawnImpl: deps.spawnImpl });
  const state = { client, cancelled: false };
  activeExecutions.set(executionId, state);
  const results = [];
  const localResults = [];
  const progress = (payload) => deps.onProgress?.({ executionId, total: actions.length, ...payload });
  try {
    progress({ phase: "preparing", stepIndex: 0, detail: "Connecting to the selected browser runtime…" });
    await client.initialize();
    for (let index = 0; index < actions.length; index += 1) {
      if (state.cancelled) throw new Error("Automation execution was cancelled.");
      const action = { ...actions[index], arguments: expandTemplates(actions[index].arguments, input.parameters || {}) };
      progress({ phase: "running", stepIndex: index, tool: action.tool, detail: `Running step ${index + 1} of ${actions.length}: ${action.tool}` });
      try {
        await deps.onStep?.({ position: index, status: "running", output: {} });
        let output = null;
        const callOutputs = [];
        if (LOCAL_TOOLS.has(action.tool)) {
          if (!deps.onLocalAction) throw new Error(`The local workflow action “${action.tool}” is not available.`);
          output = await deps.onLocalAction(action, { executionId, results: localResults });
        } else for (const call of toolCalls(action)) {
          const resolved = call.name === "__semantic_action"
            ? resolveSemanticAction(call.arguments, output, callOutputs[0]?.result ?? callOutputs[0])
            : call;
          // The MCP process is launched with the selected profile for runtime
          // discovery, but individual tools resolve their scope from their
          // arguments. Bind every call to the current app-selected profile so
          // replay can never fall back to another profile's stale CDP state.
          const scopedArguments = profile
            ? { ...resolved.arguments, profile }
            : resolved.arguments;
          output = await callDataTool(client, { name: resolved.name, arguments: scopedArguments }, action.tool, {
            cancelled: () => state.cancelled,
            sleep: deps.sleep,
            onRetry: (attempt) => progress({ phase: "running", stepIndex: index, tool: action.tool, detail: `Temporary network error. Retrying navigation (${attempt}/2)…` }),
            onDataWait: (attempt) => progress({ phase: "running", stepIndex: index, tool: action.tool, detail: `Waiting for complete page data (${attempt}/20)…` }),
          });
          callOutputs.push(output);
        }
        if (!hasMeaningfulActionData(action.tool, output) && !state.cancelled) {
          const retryCall = toolCalls(action).at(-1);
          if (retryCall && retryCall.name !== "__semantic_action") {
            for (let attempt = 1; attempt <= 20 && !hasMeaningfulActionData(action.tool, output) && !state.cancelled; attempt += 1) {
              progress({ phase: "running", stepIndex: index, tool: action.tool, detail: `Waiting for page data (${attempt}/20)…` });
              await (deps.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(500);
              output = await callDataTool(client, {
                name: retryCall.name,
                arguments: profile ? { ...retryCall.arguments, profile } : retryCall.arguments,
              }, action.tool, { cancelled: () => state.cancelled, sleep: deps.sleep });
            }
          }
        }
        if (action.tool === "evaluate") assertMeaningfulEvaluateOutput(output);
        if (["extract", "paginate_extract", "tabs_extract"].includes(action.tool)) {
          assertMeaningfulExtractionOutput(output);
          assertExtractionFieldSemantics(action, output);
          assertRequiredExtractionRows(action, output);
          const nextAction = actions[index + 1];
          if (nextAction?.tool === "save_artifact") assertArtifactDataContract(output, nextAction.arguments?.contract);
        }
        localResults.push({ index, tool: action.tool, ok: true, output });
        const displayOutput = boundedOutput(output);
        results.push({ index, tool: action.tool, ok: true, output: displayOutput });
        await deps.onStep?.({ position: index, status: "completed", output: displayOutput });
        progress({ phase: "running", stepIndex: index + 1, tool: action.tool, detail: `Completed step ${index + 1} of ${actions.length}` });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ index, tool: action.tool, ok: false, error: message });
        await deps.onStep?.({ position: index, status: "failed", output: {}, error: message });
        progress({ phase: state.cancelled ? "cancelled" : "failed", stepIndex: index, tool: action.tool, detail: `Step ${index + 1} failed: ${message}`, error: message });
        if (state.cancelled) return { status: "cancelled", results, failedStep: index };
        return { status: "failed", results, failedStep: index, error: message };
      }
    }
    progress({ phase: "completed", stepIndex: actions.length, detail: `Completed all ${actions.length} browser steps.` });
    return { status: "completed", results };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = state.cancelled ? "cancelled" : "failed";
    progress({ phase: status, stepIndex: results.length, detail: status === "cancelled" ? "Execution stopped by user." : message, error: status === "failed" ? message : undefined });
    return { status, results, error: message };
  } finally {
    client.close();
    activeExecutions.delete(executionId);
  }
}

function cancelAutomationRecipe(executionId) {
  const active = activeExecutions.get(cleanExecutionId(executionId));
  if (!active) return false;
  active.cancelled = true;
  active.client.close();
  return true;
}

function cancelAllAutomationRecipes() {
  for (const [executionId, active] of activeExecutions) {
    active.cancelled = true;
    active.client.close();
    activeExecutions.delete(executionId);
  }
}

module.exports = {
  cancelAllAutomationRecipes,
  cancelAutomationRecipe,
  createMCPClient,
  executeAutomationRecipe,
  expandTemplates,
  resolveSemanticAction,
  toolCalls,
  validateRecipe,
};
