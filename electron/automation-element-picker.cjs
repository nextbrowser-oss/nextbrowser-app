const { createMCPClient } = require("./automation-runner.cjs");

const PICK_TIMEOUT_MS = 120_000;
const activePicks = new Map();

function pickerPageScript(options) {
  const stateKey = "__nextbrowserElementPicker";
  const previous = window[stateKey];
  if (previous?.cleanup) previous.cleanup();

  const rootSelector = typeof options.container === "string" ? options.container.trim() : "";
  const mode = options.mode || "target";
  const fieldName = String(options.fieldName || "").trim();
  const box = document.createElement("div");
  const tip = document.createElement("div");
  box.setAttribute("data-nextbrowser-picker", "outline");
  tip.setAttribute("data-nextbrowser-picker", "tip");
  Object.assign(box.style, {
    position: "fixed", zIndex: "2147483646", pointerEvents: "none", border: "2px solid #7c5cff",
    borderRadius: "5px", background: "rgba(124,92,255,.10)", boxShadow: "0 0 0 2px rgba(255,255,255,.75)",
    display: "none",
  });
  Object.assign(tip.style, {
    position: "fixed", zIndex: "2147483647", pointerEvents: "none", maxWidth: "360px", padding: "8px 10px",
    borderRadius: "8px", color: "#fff", background: "#17151f", font: "600 12px/1.35 -apple-system,BlinkMacSystemFont,sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.35)", left: "12px", top: "12px",
  });
  tip.textContent = mode === "container" ? "Click one repeated result card"
    : mode === "field" ? "Click the value inside the highlighted result card"
      : mode === "next" ? "Click the Next page button"
        : mode === "presence" ? "Click visible content that means the page is ready"
        : "Click the page element for this step · Esc to cancel";
  document.documentElement.append(box, tip);

  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const stableClass = (value) => value && value.length <= 48 && !/^(?:active|selected|hover|focus|open)$/i.test(value)
    && !/[a-f0-9]{8,}/i.test(value) && !/^css-|^jsx-|^sc-/.test(value);
  const escape = (value) => CSS.escape(String(value));
  const unique = (selector, root = document) => {
    try { return root.querySelectorAll(selector).length === 1; } catch { return false; }
  };
  const segment = (element, root) => {
    const tag = element.tagName.toLowerCase();
    for (const attr of ["data-testid", "data-test", "data-qa", "name", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 100) {
        const candidate = `${tag}[${attr}="${escape(value)}"]`;
        if (unique(candidate, root)) return candidate;
      }
    }
    const classes = [...element.classList].filter(stableClass).slice(0, 2);
    if (classes.length) {
      const candidate = `${tag}.${classes.map(escape).join(".")}`;
      if (unique(candidate, root)) return candidate;
    }
    const siblings = [...(element.parentElement?.children || [])].filter((item) => item.tagName === element.tagName);
    return siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(element) + 1})` : tag;
  };
  const selectorFor = (element, root) => {
    if (!root && element.id) {
      const candidate = `#${escape(element.id)}`;
      if (unique(candidate)) return candidate;
    }
    const queryRoot = root || document;
    for (const attr of ["data-testid", "data-test", "data-qa", "name", "aria-label"]) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 100) {
        const candidate = `${element.tagName.toLowerCase()}[${attr}="${escape(value)}"]`;
        if (unique(candidate, queryRoot)) return candidate;
      }
    }
    const parts = [];
    let current = element;
    while (current && current !== root && current !== document.documentElement && parts.length < 6) {
      parts.unshift(segment(current, queryRoot));
      const candidate = parts.join(" > ");
      if (unique(candidate, queryRoot)) return candidate;
      current = current.parentElement;
    }
    return parts.join(" > ") || element.tagName.toLowerCase();
  };
  const repeatedSelectorFor = (element) => {
    const tag = element.tagName.toLowerCase();
    for (const attr of ["data-testid", "data-test", "data-qa"]) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 100) {
        const candidate = `${tag}[${attr}="${escape(value)}"]`;
        try { if (document.querySelectorAll(candidate).length > 1) return candidate; } catch { /* use class fallback */ }
      }
    }
    const classes = [...element.classList].filter(stableClass).slice(0, 3);
    for (let count = classes.length; count > 0; count -= 1) {
      const candidate = `${tag}.${classes.slice(0, count).map(escape).join(".")}`;
      try { if (document.querySelectorAll(candidate).length > 1) return candidate; } catch { /* use unique fallback */ }
    }
    return selectorFor(element);
  };
  const roleOf = (element) => element.getAttribute("role") || ({
    BUTTON: "button", A: element.hasAttribute("href") ? "link" : "", INPUT: element.type === "checkbox" ? "checkbox" : element.type === "radio" ? "radio" : "textbox",
    TEXTAREA: "textbox", SELECT: "combobox",
  })[element.tagName] || "";
  const nameOf = (element) => normalize(element.getAttribute("aria-label")
    || (element.id ? document.querySelector(`label[for="${escape(element.id)}"]`)?.textContent : "")
    || element.getAttribute("placeholder") || element.innerText || element.textContent || element.getAttribute("title")).slice(0, 160);
  const targetFor = (event) => event.target instanceof Element && !event.target.closest("[data-nextbrowser-picker]") ? event.target : null;
  let hovered;
  const show = (element) => {
    hovered = element;
    const rect = element.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    const label = nameOf(element) || element.tagName.toLowerCase();
    tip.textContent = `${mode === "container" ? "Result row" : mode === "field" ? "Data field" : mode === "next" ? "Next page" : "Target"}: ${label}`;
  };
  const onMove = (event) => { const target = targetFor(event); if (target && target !== hovered) show(target); };
  const cleanup = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    box.remove(); tip.remove();
  };
  const fail = (message) => { tip.textContent = message; tip.style.background = "#8b2d3b"; };
  const onClick = (event) => {
    const element = targetFor(event);
    if (!element) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    let root;
    if (mode === "field" && rootSelector) {
      try { root = element.closest(rootSelector); } catch { root = null; }
      if (!root) return fail("Choose a value inside the previously selected result row");
    }
    const role = roleOf(element);
    const name = nameOf(element);
    const locator = role && name ? { role, name } : name ? { name } : undefined;
    const selector = mode === "container" || mode === "presence" ? repeatedSelectorFor(element) : selectorFor(element, root);
    let matchCount = 1;
    try { matchCount = (root || document).querySelectorAll(selector).length; } catch { /* selector was already validated */ }
    const attribute = mode === "field" && /(?:url|link|href)$/i.test(fieldName) && element instanceof HTMLAnchorElement ? "href"
      : mode === "field" && /(?:image|photo|src)$/i.test(fieldName) && element instanceof HTMLImageElement ? "src" : undefined;
    window[stateKey].result = {
      cancelled: false, selector, locator, label: name || selector, tag: element.tagName.toLowerCase(), attribute, matchCount,
      pageUrl: location.href, pageTitle: document.title,
    };
    cleanup();
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault(); event.stopPropagation();
    window[stateKey].result = { cancelled: true };
    cleanup();
  };
  window[stateKey] = { result: null, cleanup };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  return { installed: true, url: location.href, title: document.title };
}

function resultFromMCP(result) {
  const text = (result?.content || []).filter((item) => item?.type === "text").map((item) => item.text).join("\n").trim();
  if (result?.isError) throw new Error(text || "The browser could not start element selection.");
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && Object.prototype.hasOwnProperty.call(parsed, "result") && parsed.session) return parsed.result;
    return parsed;
  } catch { return text; }
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function pickAutomationElement(input, deps) {
  const pickId = String(input.pickId || "").trim();
  if (!pickId || !/^[A-Za-z0-9_-]{1,128}$/.test(pickId)) throw new Error("Invalid element picker ID.");
  if (activePicks.size) throw new Error("Finish or cancel the current element selection first.");
  const profile = String(input.profile || "").trim();
  const runtime = ["clawbrowser", "camoufox", "chromium", "multilogin"].includes(input.runtime) ? input.runtime : "clawbrowser";
  const args = [...(profile ? ["--profile", profile] : []), "--runtime", runtime, ...(input.runtimeBin ? ["--runtime-bin", input.runtimeBin] : []), "mcp"];
  const client = createMCPClient({ binary: deps.binary, args, env: deps.env, spawnImpl: deps.spawnImpl });
  const state = { client, cancelled: false };
  activePicks.set(pickId, state);
  const cleanupExpression = `(() => { const state=window.__nextbrowserElementPicker; if(state?.cleanup)state.cleanup(); delete window.__nextbrowserElementPicker; return true; })()`;
  try {
    await client.initialize();
    const openUrl = String(input.openUrl || "").trim();
    if (openUrl) {
      const parsed = new URL(openUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("The workflow preview URL must use http:// or https://.");
      resultFromMCP(await client.callTool("open", { url: parsed.toString() }));
      resultFromMCP(await client.callTool("wait", { load: true, timeout: "20s" }));
    }
    resultFromMCP(await client.callTool("state", {}));
    const expression = `(${pickerPageScript.toString()})(${JSON.stringify({ mode: input.mode, container: input.container, fieldName: input.fieldName })})`;
    resultFromMCP(await client.callTool("evaluate", { expression }));
    deps.onReady?.();
    const deadline = Date.now() + PICK_TIMEOUT_MS;
    while (!state.cancelled && Date.now() < deadline) {
      await wait(200);
      const result = resultFromMCP(await client.callTool("evaluate", {
        expression: `(() => { const state=window.__nextbrowserElementPicker; if(!state?.result)return null; const result=state.result; delete window.__nextbrowserElementPicker; return result; })()`,
      }));
      if (result) return result;
    }
    if (state.cancelled) return { cancelled: true };
    throw new Error("Element selection timed out. Try again and click an element within two minutes.");
  } catch (error) {
    if (state.cancelled) return { cancelled: true };
    throw error;
  } finally {
    if (!state.cancelled) await client.callTool("evaluate", { expression: cleanupExpression }).catch(() => undefined);
    client.close();
    activePicks.delete(pickId);
  }
}

function cancelAutomationElementPick(pickId) {
  const state = activePicks.get(String(pickId || "").trim());
  if (!state) return false;
  state.cancelled = true;
  state.client.close();
  return true;
}

function cancelAllAutomationElementPicks() {
  for (const [pickId, state] of activePicks) {
    state.cancelled = true;
    state.client.close();
    activePicks.delete(pickId);
  }
}

module.exports = { cancelAllAutomationElementPicks, cancelAutomationElementPick, pickAutomationElement, pickerPageScript };
