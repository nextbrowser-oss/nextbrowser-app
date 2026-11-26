const { createHash } = require("node:crypto");

function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

// A click acknowledgement says nothing about the form. Compare actual page
// readings, before the MCP result is clipped to the model's context budget.
function pageObservation(name, text) {
  if ((name !== "click" && name !== "state") || !text) return null;
  let payload;
  try { payload = JSON.parse(text); } catch {
    if (name !== "state" || /^\s*(?:\[|\{)/.test(text) || /^(?:ok|success|done(?: \(no output\))?)[.!]?$/i.test(text.trim())) return null;
    return { snapshot: fingerprint(text.trim()) };
  }
  const diff = payload?.state_diff;
  if (typeof diff?.changed === "boolean") {
    if (diff.page_changed) return { navigated: true };
    const changes = [diff.added_elements, diff.removed_elements, diff.added_content, diff.removed_content].flat().filter(Boolean);
    return { changed: diff.changed && (!changes.length || changes.some(item => item.role !== "timer")) };
  }
  const state = payload?.state ?? (name === "state" ? payload : null);
  if (!Array.isArray(state?.elements) && !Array.isArray(state?.content)) return null;
  const elements = (Array.isArray(state.elements) ? state.elements : []).filter(e => e && e.role !== "timer").map(e =>
    [e.id, e.role, e.type, e.name, e.text, e.value, e.checked, e.selected, e.expanded, e.href]);
  const content = (Array.isArray(state.content) ? state.content : []).filter(b => b && b.role !== "timer").map(b => [b.role, b.text]);
  if (!elements.length && !content.length) return null;
  const document = JSON.stringify([state.page?.id, state.page?.url]);
  return { document, snapshot: fingerprint([state.page?.title, elements, content]) };
}

// Additional reads can reveal a delayed change, but only distinct executed
// clicks count towards the threshold. A different action starts a new series.
function createClickProgress() {
  let last;
  return {
    repeats(target) { return Boolean(target && last?.target === target && last.count >= 2); },
    needsState(target) { return Boolean(target && last?.target === target && last.pending); },
    awaitingRecovery() { return Boolean(last && (last.pending || last.count >= 2)); },
    record(name, args, target, result) {
      if (name === "click" && target && result && !result.isError) {
        if (last?.target !== target || last.pending) last = { target, profile: args.profile, count: 0 };
        last.pending = true;
      } else if (last && name === "state" && last.profile === args.profile) {
        if (!result || result.isError) return;
      } else {
        if (!["screenshot", "tabs_list", "profiles_list", "wait", "extract"].includes(name)) last = undefined;
        return;
      }
      const observation = result.pageObservation === undefined ? pageObservation(name, result.text) : result.pageObservation;
      if (!observation) return;
      if (observation.navigated || (last.document && observation.document && last.document !== observation.document)) {
        last = undefined;
        return;
      }
      if (observation.document) last.document = observation.document;
      if (observation.changed || (observation.snapshot && last.snapshot && observation.snapshot !== last.snapshot)) {
        last.count = 0;
        last.snapshot = undefined;
      }
      if (observation.snapshot) last.snapshot = observation.snapshot;
      if (last.pending) last.count++;
      last.pending = false;
    },
  };
}

module.exports = { createClickProgress, pageObservation };
