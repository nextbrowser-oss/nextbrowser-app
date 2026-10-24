// Collects every error a user could see during the run: error text on
// screen, failed chat replies, renderer exceptions and console errors. Each
// one is tied to the step that was running, so the report can ask of every
// visible error whether the app also reported it to the backend.

// Error surfaces the app renders (class names from src/components).
const SCAN = `(() => {
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const out = new Set();
  const selectors = ['[role="alert"]', ".bubble-failed", ".user-facing-error", '[class~="error"]', '[class*="-error"]'];
  for (const el of document.querySelectorAll(selectors.join(","))) {
    if (!visible(el)) continue;
    const text = (el.innerText || "").replace(/\\s+/g, " ").trim();
    if (text) out.add(text.slice(0, 600));
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!/Ref: NB-[A-F0-9]{8}/.test(node.nodeValue || "")) continue;
    const el = node.parentElement?.closest("p, li, div, section, article") || node.parentElement;
    if (el && visible(el)) out.add((el.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 600));
  }
  return [...out];
})()`;

// "NB-<code hash>" or, since per-incident Refs, "NB-<code hash>-<incident>";
// the code hash part is what a backend report can be matched by.
const REF = /Ref: (NB-[A-F0-9]{8})(?:-[A-F0-9]{4})?/;

export class ErrorWatch {
  constructor() {
    this.ui = [];
    this.console = [];
    this.seen = new Set();
    this.step = "";
    this.attached = new WeakSet();
  }

  attach(page) {
    if (this.attached.has(page)) return;
    this.attached.add(page);
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      this.console.push({ at: new Date().toISOString(), step: this.step, kind: "console", text: message.text().slice(0, 1000) });
    });
    page.on("pageerror", (error) => {
      this.console.push({ at: new Date().toISOString(), step: this.step, kind: "exception", text: `${error.name}: ${error.message}`.slice(0, 1000) });
    });
  }

  async scan(page) {
    let texts = [];
    try { texts = await page.evaluate(SCAN); } catch { return []; }
    const fresh = [];
    for (const text of texts) {
      if (this.seen.has(text)) continue;
      this.seen.add(text);
      const entry = { at: new Date().toISOString(), step: this.step, text, ref: text.match(REF)?.[1] ?? "" };
      this.ui.push(entry);
      fresh.push(entry);
    }
    return fresh;
  }
}
