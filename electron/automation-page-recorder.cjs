const { createMCPClient } = require("./automation-runner.cjs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const POLL_MS = 250;
const RECORDER_CALL_TIMEOUT_MS = 10_000;
const MAX_ACTIONS = 100;
const activeRecorders = new Map();
const completedRecorders = new Map();

function recorderPageScript() {
  const stateKey = "__nextbrowserPageRecorder";
  const storageKey = "__nextbrowserPageRecorderQueue";
  if (window[stateKey]?.drain) return { installed: true, url: location.href, title: document.title };
  let carried = [];
  try { carried = JSON.parse(sessionStorage.getItem(storageKey) || "[]"); } catch { /* start with an empty queue */ }
  const queue = Array.isArray(carried) ? carried : [];
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const stableClass = (value) => value && value.length <= 48 && !/^(?:active|selected|hover|focus|open)$/i.test(value)
    && !/[a-f0-9]{8,}/i.test(value) && !/^css-|^jsx-|^sc-/.test(value);
  const escape = (value) => CSS.escape(String(value));
  const unique = (selector) => { try { return document.querySelectorAll(selector).length === 1; } catch { return false; } };
  const selectorFor = (element) => {
    if (element.id && unique(`#${escape(element.id)}`)) return `#${escape(element.id)}`;
    const tag = element.tagName.toLowerCase();
    for (const attr of ["data-testid", "data-test", "data-qa", "name", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 100) {
        const candidate = `${tag}[${attr}="${escape(value)}"]`;
        if (unique(candidate)) return candidate;
      }
    }
    const parts = [];
    let current = element;
    while (current && current !== document.documentElement && parts.length < 6) {
      const currentTag = current.tagName.toLowerCase();
      const classes = [...current.classList].filter(stableClass).slice(0, 2);
      let part = classes.length ? `${currentTag}.${classes.map(escape).join(".")}` : currentTag;
      const siblings = [...(current.parentElement?.children || [])].filter((item) => item.tagName === current.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      parts.unshift(part);
      if (unique(parts.join(" > "))) return parts.join(" > ");
      current = current.parentElement;
    }
    return parts.join(" > ") || tag;
  };
  const roleOf = (element) => element.getAttribute("role") || ({
    BUTTON: "button", A: element.hasAttribute("href") ? "link" : "", INPUT: element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox",
    TEXTAREA: "textbox", SELECT: "combobox",
  })[element.tagName] || "";
  const nameOf = (element) => normalize(element.getAttribute("aria-label")
    || (element.id ? document.querySelector(`label[for="${escape(element.id)}"]`)?.textContent : "")
    || element.getAttribute("placeholder") || element.innerText || element.textContent || element.getAttribute("title")).slice(0, 160);
  const targetArguments = (element) => {
    const role = roleOf(element);
    const name = nameOf(element);
    return role && name ? { locator: { role, name } } : { selector: selectorFor(element) };
  };
  const push = (tool, arguments_) => {
    const action = { tool, arguments: arguments_, at: Date.now(), eventId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}` };
    queue.push(action);
    try { window.__nextbrowserRecorderEmit?.(JSON.stringify(action)); } catch { /* the queue remains the fallback */ }
    try { sessionStorage.setItem(storageKey, JSON.stringify(queue)); } catch { /* the in-memory queue still records the action */ }
  };
  const onClick = (event) => {
    const raw = event.target instanceof Element ? event.target : null;
    const element = raw?.closest("button,a[href],input[type=button],input[type=submit],input[type=checkbox],input[type=radio],[role=button],[role=link],[role=checkbox],[role=radio]");
    if (!element) return;
    push("click", targetArguments(element));
  };
  const onChange = (event) => {
    const element = event.target;
    if (element instanceof HTMLSelectElement) return push("select", { ...targetArguments(element), value: element.value });
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    if (["checkbox", "radio", "button", "submit", "file"].includes(element.type)) return;
    const sensitive = element instanceof HTMLInputElement && element.type === "password"
      || /password|passcode|security code|card number|cvv|cvc|token|secret/i.test(`${element.name} ${element.id} ${element.placeholder} ${element.getAttribute("aria-label")}`);
    push("input", { ...targetArguments(element), text: sensitive ? "{{redacted}}" : element.value });
  };
  const onKey = (event) => {
    if (!["Enter", "Escape"].includes(event.key) || event.repeat) return;
    const element = event.target instanceof Element ? event.target : null;
    push("press", { ...(element ? targetArguments(element) : {}), key: event.key });
  };
  let scrollTimer;
  const onScroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => push("scroll", { x: Math.round(scrollX), y: Math.round(scrollY) }), 350);
  };
  const cleanup = () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("input", onChange, true);
    document.removeEventListener("change", onChange, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    clearTimeout(scrollTimer);
  };
  window[stateKey] = { drain: () => { const actions = queue.splice(0); try { sessionStorage.removeItem(storageKey); } catch { /* no-op */ } return actions; }, cleanup };
  document.addEventListener("click", onClick, true);
  document.addEventListener("input", onChange, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  return { installed: true, url: location.href, title: document.title };
}

function resultFromMCP(result) {
  const text = (result?.content || []).filter((item) => item?.type === "text").map((item) => item.text).join("\n").trim();
  if (result?.isError) throw new Error(text || "The browser recorder could not access the page.");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "result") && parsed.session ? parsed.result : parsed;
  } catch { return text; }
}

function resultEnvelopeFromMCP(result) {
  const text = (result?.content || []).filter((item) => item?.type === "text").map((item) => item.text).join("\n").trim();
  if (result?.isError) throw new Error(text || "The browser recorder could not access the page.");
  if (!text) return { value: null, session: undefined };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "result") && parsed.session) {
      return { value: parsed.result, session: parsed.session };
    }
    return { value: parsed, session: undefined };
  } catch { return { value: text, session: undefined }; }
}

function localCDPEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return "";
    return url.href.replace(/\/$/, "");
  } catch { return ""; }
}

function createCDPTargetClient(target, onAction) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  const opened = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP target connection timed out.")), 3_000);
    socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP target connection failed.")); }, { once: true });
  });
  socket.addEventListener("message", (event) => {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error(message.error.message || "CDP request failed."));
      else request.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.bindingCalled" && message.params?.name === "__nextbrowserRecorderEmit") {
      try { onAction(JSON.parse(message.params.payload)); } catch { /* ignore malformed page payloads */ }
    }
  });
  const call = async (method, params = {}) => {
    await opened;
    return await new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out.`)); }, 3_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };
  return { call, close: () => { try { socket.close(); } catch { /* no-op */ } } };
}

async function syncCDPTargets(state) {
  if (!state.cdpEndpoint) return false;
  const response = await fetch(`${state.cdpEndpoint}/json/list`, { signal: AbortSignal.timeout(3_000) });
  if (!response.ok) throw new Error(`CDP target discovery failed (${response.status}).`);
  const targets = (await response.json()).filter((target) => target?.type === "page" && target?.id && target?.webSocketDebuggerUrl);
  const liveIds = new Set(targets.map((target) => String(target.id)));
  for (const [id, tracked] of state.cdpTargets) {
    if (!liveIds.has(id)) { tracked.client.close(); state.cdpTargets.delete(id); }
  }
  for (const target of targets) {
    const id = String(target.id);
    const url = String(target.url || "");
    const tracked = state.cdpTargets.get(id);
    if (!tracked) {
      const entry = { client: null, url, title: String(target.title || "") };
      const client = createCDPTargetClient(target, (action) => {
        state.currentUrl = entry.url || state.currentUrl;
        state.title = entry.title || state.title;
        addAction(state, action);
      });
      entry.client = client;
      await client.call("Runtime.addBinding", { name: "__nextbrowserRecorderEmit" });
      await client.call("Runtime.evaluate", { expression: `(${recorderPageScript.toString()})()`, returnByValue: true, awaitPromise: true });
      state.cdpTargets.set(id, entry);
      if (state.cdpInitialized && /^https?:\/\//.test(url)) {
        addAction(state, { tool: "open", arguments: { url }, at: Date.now() });
        state.currentUrl = url;
        state.title = String(target.title || state.title);
      }
    } else if (tracked.url !== url) {
      tracked.url = url;
      tracked.title = String(target.title || tracked.title);
      await tracked.client.call("Runtime.evaluate", { expression: `(${recorderPageScript.toString()})()`, returnByValue: true, awaitPromise: true }).catch(() => undefined);
      if (/^https?:\/\//.test(url) && Date.now() - state.lastPageInteractionAt >= 10_000) addAction(state, { tool: "open", arguments: { url }, at: Date.now() });
      state.currentUrl = url;
      state.title = String(target.title || state.title);
    }
  }
  state.cdpInitialized = true;
  return true;
}

function cleanId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid browser recording ID.");
  return id;
}

function addAction(state, action) {
  if (!action || typeof action.tool !== "string" || !action.arguments || state.actions.length >= MAX_ACTIONS) return;
  if (action.eventId && state.seenEventIds.has(action.eventId)) return;
  if (action.eventId) state.seenEventIds.add(action.eventId);
  const previous = state.actions[state.actions.length - 1];
  if (action.tool === "input" && previous?.tool === "input" && JSON.stringify({ ...previous.arguments, text: undefined }) === JSON.stringify({ ...action.arguments, text: undefined })) {
    state.actions[state.actions.length - 1] = { tool: action.tool, arguments: action.arguments, at: Number(action.at) || Date.now() };
    return;
  }
  if (previous?.tool === action.tool && ["select", "click"].includes(action.tool) && JSON.stringify(previous.arguments) === JSON.stringify(action.arguments)) return;
  state.actions.push({ tool: action.tool, arguments: action.arguments, at: Number(action.at) || Date.now() });
  if (["click", "press", "select"].includes(action.tool)) state.lastPageInteractionAt = Number(action.at) || Date.now();
}

async function collect(state) {
  if (state.closed || state.polling || !state.client) return;
  state.polling = true;
  try {
    if (state.cdpEndpoint) {
      await syncCDPTargets(state);
      return;
    }
    const evaluated = resultEnvelopeFromMCP(await state.client.callTool("evaluate", {
      expression: `(() => { const state=window.__nextbrowserPageRecorder; return {missing:!state?.drain,url:location.href,title:document.title,actions:state?.drain?.()||[]}; })()`,
    }, RECORDER_CALL_TIMEOUT_MS));
    let snapshot = evaluated.value;
    state.cdpEndpoint = localCDPEndpoint(evaluated.session?.endpoint);
    if (snapshot?.missing) {
      snapshot = resultFromMCP(await state.client.callTool("evaluate", { expression: `(${recorderPageScript.toString()})()` }, RECORDER_CALL_TIMEOUT_MS)) || snapshot;
      snapshot.actions = [];
    }
    const url = String(snapshot?.url || "");
    if (/^https?:\/\//.test(url) && url !== state.currentUrl) {
      const causedByPageAction = state.currentUrl && Date.now() - state.lastPageInteractionAt < 10_000;
      // A queued interaction may have happened just before this polling pass
      // observed the URL. The URL still has to precede that interaction in the
      // replay recipe, regardless of wall-clock scheduling within the pass.
      const firstQueuedAt = Math.min(...(snapshot?.actions || []).map((action) => Number(action.at) || Date.now()));
      if (!causedByPageAction) addAction(state, { tool: "open", arguments: { url }, at: Number.isFinite(firstQueuedAt) ? firstQueuedAt - 1 : Date.now() });
      state.currentUrl = url;
    }
    if (snapshot?.title) state.title = String(snapshot.title);
    for (const action of snapshot?.actions || []) addAction(state, action);
  } catch (error) {
    console.error("[AUTOMATION_PAGE_RECORDER_COLLECT_FAILED]", error);
    if (!state.stopping) state.lastError = error instanceof Error ? error.message : String(error);
  } finally {
    state.polling = false;
  }
}

async function startAutomationPageRecording(input, deps) {
  const recordingId = cleanId(input.recordingId);
  if (activeRecorders.size) throw new Error("Stop the current browser recording before starting another one.");
  const profile = String(input.profile || "").trim();
  const runtime = ["clawbrowser", "camoufox", "chromium", "multilogin"].includes(input.runtime) ? input.runtime : "clawbrowser";
  const args = [...(profile ? ["--profile", profile] : []), "--runtime", runtime, ...(input.runtimeBin ? ["--runtime-bin", input.runtimeBin] : []), "mcp"];
  const traceDir = await fs.mkdtemp(path.join(os.tmpdir(), "nextbrowser-recording-"));
  const traceFile = path.join(traceDir, "mcp-actions.jsonl");
  await fs.writeFile(traceFile, "", { mode: 0o600 });
  const state = { client: null, clientOptions: { binary: deps.binary, args, env: deps.env, spawnImpl: deps.spawnImpl }, profile, actions: [], seenEventIds: new Set(), traceFile, traceDir, currentUrl: "", currentPageId: "", title: "", lastPageInteractionAt: 0, polling: false, stopping: false, closed: false, attaching: null, lastError: "", cdpEndpoint: "", cdpInitialized: false, cdpTargets: new Map() };
  activeRecorders.set(recordingId, state);
  try {
    if (input.attach !== false) await attachAutomationPageRecording(recordingId);
    return { started: true, url: state.currentUrl, title: state.title };
  } catch (error) {
    state.closed = true;
    state.client?.close();
    activeRecorders.delete(recordingId);
    await fs.rm(traceDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function attachAutomationPageRecording(recordingId) {
  const id = cleanId(recordingId);
  const state = activeRecorders.get(id);
  if (!state || state.closed) throw new Error("This browser recording is no longer active. Start a new recording and try again.");
  if (state.client) return { attached: true, url: state.currentUrl, title: state.title };
  if (state.attaching) return await state.attaching;
  state.attaching = (async () => {
    const client = createMCPClient(state.clientOptions);
    try {
      await client.initialize();
      const initialState = resultFromMCP(await client.callTool("state", {}, RECORDER_CALL_TIMEOUT_MS));
      state.currentPageId = String(initialState?.page?.id || "");
      state.client = client;
      await collect(state);
      state.timer = setInterval(() => void collect(state), POLL_MS);
      return { attached: true, url: state.currentUrl, title: state.title };
    } catch (error) {
      client.close();
      throw error;
    } finally {
      state.attaching = null;
    }
  })();
  return await state.attaching;
}

function activeAutomationTraceFile() {
  return activeRecorders.values().next().value?.traceFile || "";
}

function recordAutomationToolAction(tool, arguments_) {
  const state = activeRecorders.values().next().value;
  if (!state || state.closed) return;
  addAction(state, { tool, arguments: arguments_, at: Date.now() });
}

async function tracedActions(state) {
  let text = "";
  try { text = await fs.readFile(state.traceFile, "utf8"); } catch { return []; }
  const actions = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (typeof event.tool === "string" && event.arguments && typeof event.arguments === "object" && !Array.isArray(event.arguments)) {
        actions.push({ tool: event.tool, arguments: event.arguments, at: Number(event.at) || Date.now() });
      }
    } catch { /* ignore a partial final JSONL line */ }
  }
  return actions;
}

async function activeAutomationRecordingHasDataAction() {
  const state = activeRecorders.values().next().value;
  if (!state || state.closed) return true;
  const actions = await tracedActions(state);
  return actions.some((action) => ["navigate_extract", "extract", "paginate_extract", "tabs_extract", "evaluate"].includes(action.tool));
}

async function stopAutomationPageRecording(recordingId) {
  const id = cleanId(recordingId);
  if (completedRecorders.has(id)) return structuredClone(completedRecorders.get(id));
  const state = activeRecorders.get(id);
  if (!state) throw new Error("This browser recording is no longer active. Start a new recording and try again.");
  state.stopping = true;
  clearInterval(state.timer);
  while (state.polling) await new Promise((resolve) => setTimeout(resolve, 20));
  if (state.client) await collect(state);
  state.closed = true;
  for (const tracked of state.cdpTargets.values()) tracked.client.close();
  state.cdpTargets.clear();
  await state.client?.callTool("evaluate", { expression: `(() => { const state=window.__nextbrowserPageRecorder; state?.cleanup?.(); delete window.__nextbrowserPageRecorder; return true; })()` }).catch(() => undefined);
  state.client?.close();
  activeRecorders.delete(id);
  const pageActions = [...state.actions];
  const toolActions = (await tracedActions(state)).filter((action) => !pageActions.some((pageAction) =>
    pageAction.tool === action.tool && Math.abs(pageAction.at - action.at) <= 3_000,
  ));
  const actions = [...pageActions, ...toolActions].sort((left, right) => left.at - right.at).slice(0, MAX_ACTIONS);
  await fs.rm(state.traceDir, { recursive: true, force: true }).catch(() => undefined);
  const result = { actions: actions.map(({ eventId: _eventId, ...action }) => action), url: state.currentUrl, title: state.title, error: state.lastError || undefined, stoppedAt: Date.now() };
  completedRecorders.set(id, result);
  setTimeout(() => completedRecorders.delete(id), 5 * 60_000).unref?.();
  return structuredClone(result);
}

function cancelAllAutomationPageRecordings() {
  for (const [id, state] of activeRecorders) {
    clearInterval(state.timer);
    state.closed = true;
    for (const tracked of state.cdpTargets.values()) tracked.client.close();
    state.client?.close();
    activeRecorders.delete(id);
    void fs.rm(state.traceDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

module.exports = { activeAutomationRecordingHasDataAction, activeAutomationTraceFile, attachAutomationPageRecording, cancelAllAutomationPageRecordings, recordAutomationToolAction, recorderPageScript, startAutomationPageRecording, stopAutomationPageRecording };
