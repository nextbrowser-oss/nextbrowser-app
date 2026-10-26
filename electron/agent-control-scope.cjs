function resolveScopedProfile(profileScope, requestedProfile) {
  const requested = String(requestedProfile || "");
  if (profileScope.has(requested)) return requested;
  if (profileScope.size === 1) return profileScope.keys().next().value || "";
  return "";
}

/**
 * Reads the body of a host-control request. An agent sends it from whatever
 * shell it runs in, so besides a JSON object this accepts what that shell may
 * hand over instead: form fields (profile=Work%20profile, the form the app's
 * start command uses because every shell passes it unchanged), JSON behind a
 * UTF-8 byte-order mark (a file Windows PowerShell wrote) and JSON still in
 * the single quotes cmd.exe does not strip. Anything else throws the JSON
 * parser's own SyntaxError.
 */
function parseAgentControlBody(raw) {
  const text = String(raw ?? "").replace(/^﻿/, "").trim();
  if (!text) return {};
  const quoted = /^'([\s\S]*)'$/.exec(text)?.[1]?.trim();
  let failure;
  for (const candidate of quoted === undefined ? [text] : [text, quoted]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      return {};
    } catch (error) {
      failure ??= error;
    }
  }
  if (/^[A-Za-z_][\w.-]*=/.test(text)) return Object.fromEntries(new URLSearchParams(text));
  throw failure;
}

module.exports = { parseAgentControlBody, resolveScopedProfile };
