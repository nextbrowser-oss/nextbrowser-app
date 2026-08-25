const { createMCPClient } = require("./automation-runner.cjs");

const POLL_MS = 250;
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
    queue.push({ tool, arguments: arguments_, at: Date.now() });
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
    push("input", { ...targetArguments(element), text: sensitive ? "{{secret}}" : element.value });
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

function cleanId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("Invalid browser recording ID.");
  return id;
}

function addAction(state, action) {
  if (!action || typeof action.tool !== "string" || !action.arguments || state.actions.length >= MAX_ACTIONS) return;
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
  if (state.closed || state.polling) return;
  state.polling = true;
  try {
    let snapshot = resultFromMCP(await state.client.callTool("evaluate", {
      expression: `(() => { const state=window.__nextbrowserPageRecorder; return {missing:!state?.drain,url:location.href,title:document.title,actions:state?.drain?.()||[]}; })()`,
    }));
    if (snapshot?.missing) {
      snapshot = resultFromMCP(await state.client.callTool("evaluate", { expression: `(${recorderPageScript.toString()})()` })) || snapshot;
      snapshot.actions = [];
    }
    const url = String(snapshot?.url || "");
    if (/^https?:\/\//.test(url) && url !== state.currentUrl) {
      const causedByPageAction = state.currentUrl && Date.now() - state.lastPageInteractionAt < 10_000;
      if (!causedByPageAction) addAction(state, { tool: "open", arguments: { url } });
      state.currentUrl = url;
    }
    if (snapshot?.title) state.title = String(snapshot.title);
    for (const action of snapshot?.actions || []) addAction(state, action);
  } catch (error) {
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
  const client = createMCPClient({ binary: deps.binary, args, env: deps.env, spawnImpl: deps.spawnImpl });
  const state = { client, actions: [], currentUrl: "", title: "", lastPageInteractionAt: 0, polling: false, stopping: false, closed: false, lastError: "" };
  activeRecorders.set(recordingId, state);
  try {
    await client.initialize();
    resultFromMCP(await client.callTool("state", {}));
    await collect(state);
    state.timer = setInterval(() => void collect(state), POLL_MS);
    return { started: true, url: state.currentUrl, title: state.title };
  } catch (error) {
    state.closed = true;
    client.close();
    activeRecorders.delete(recordingId);
    throw error;
  }
}

async function stopAutomationPageRecording(recordingId) {
  const id = cleanId(recordingId);
  if (completedRecorders.has(id)) return structuredClone(completedRecorders.get(id));
  const state = activeRecorders.get(id);
  if (!state) throw new Error("This browser recording is no longer active. Start a new recording and try again.");
  state.stopping = true;
  clearInterval(state.timer);
  while (state.polling) await new Promise((resolve) => setTimeout(resolve, 20));
  await collect(state);
  state.closed = true;
  await state.client.callTool("evaluate", { expression: `(() => { const state=window.__nextbrowserPageRecorder; state?.cleanup?.(); delete window.__nextbrowserPageRecorder; return true; })()` }).catch(() => undefined);
  state.client.close();
  activeRecorders.delete(id);
  const result = { actions: state.actions, url: state.currentUrl, title: state.title, error: state.lastError || undefined, stoppedAt: Date.now() };
  completedRecorders.set(id, result);
  setTimeout(() => completedRecorders.delete(id), 5 * 60_000).unref?.();
  return structuredClone(result);
}

function cancelAllAutomationPageRecordings() {
  for (const [id, state] of activeRecorders) {
    clearInterval(state.timer);
    state.closed = true;
    state.client.close();
    activeRecorders.delete(id);
  }
}

module.exports = { cancelAllAutomationPageRecordings, recorderPageScript, startAutomationPageRecording, stopAutomationPageRecording };
