// Error reports leave the machine, so everything they carry is scrubbed here
// first: home directories become `~`, URLs lose their query, fragment and
// credentials, and emails, bearer tokens and API keys are replaced. Scrubbing
// errs on the side of removing too much; a report is still useful without them.

const SECRET_KEYS = "access[_-]?token|refresh[_-]?token|poll[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|apikey|secret|password|passwd|pwd|token|authorization|cookie|session[_-]?id";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The same home directory appears with either separator (stack traces turn
// C:\Users\me into file:///C:/Users/me) and in any case on Windows.
function homeDirPattern(homeDir, platform) {
  const home = String(homeDir || "").replace(/[\\/]+$/, "");
  if (home.length < 3) return null;
  const parts = home.split(/[\\/]+/).map(escapeRegExp);
  return new RegExp(`${parts.join("[\\\\/]+")}(?=[\\\\/:"'\\s)]|$)`, platform === "win32" ? "gi" : "g");
}

function stripURL(match) {
  try {
    const url = new URL(match);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return match.replace(/[?#].*$/, "");
  }
}

function createScrubber({ homeDir, platform = process.platform } = {}) {
  const home = homeDirPattern(homeDir, platform);
  return function scrub(value) {
    let text = String(value ?? "");
    if (!text) return text;
    if (home) text = text.replace(home, "~");
    // Another account's profile directory still names a person.
    text = text
      .replace(/\b[A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+[^\\/\s:"')]+/gi, "~")
      .replace(/(^|[\s("'=:]|file:\/\/)\/(?:Users|home)\/[^/\s:"')]+/g, "$1~")
      // Proxy URLs (socks5://user:pass@host) carry credentials in any scheme.
      .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1")
      .replace(/\b(?:https?|wss?|file):\/\/[^\s"'<>`)\]]+/gi, stripURL)
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/gi, "$1 ***")
      .replace(/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*/g, "<jwt>")
      .replace(/\b(nb|claw)_(live|test)_[A-Za-z0-9_-]+/g, "$1_$2_***")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-***")
      // Model provider keys of the built-in agent: NVIDIA, Google, Groq.
      .replace(/\b(nvapi|gsk)[-_][A-Za-z0-9_-]{8,}/g, "$1-***")
      .replace(/\bAIza[A-Za-z0-9_-]{20,}/g, "AIza***")
      .replace(new RegExp(`\\b(${SECRET_KEYS})(["']?\\s*[:=]\\s*["']?)[^\\s"',;&}]+`, "gi"), "$1$2***")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, "<email>");
    return text;
  };
}

/** Truncates to a UTF-8 byte budget without splitting a character. */
function truncateBytes(value, maxBytes) {
  const text = String(value ?? "");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const budget = Math.max(0, maxBytes - 3);
  let used = 0;
  let end = 0;
  for (const char of text) {
    const size = Buffer.byteLength(char, "utf8");
    if (used + size > budget) break;
    used += size;
    end += char.length;
  }
  return `${text.slice(0, end)}…`;
}

// Fingerprints must not change with line numbers, install paths or the
// content hash Vite puts in bundle names, so frames keep only the function and
// the file's base name.
function normalizeStackFrames(stack, limit = 5) {
  const frames = [];
  for (const line of String(stack || "").split(/\r?\n/)) {
    const match = line.match(/^\s*at\s+(?:(.*?)\s+\()?(.*?)\)?\s*$/);
    if (!match) continue;
    const fn = (match[1] || "").replace(/^async\s+/, "").trim();
    const location = (match[2] || "")
      .replace(/[?#].*$/, "")
      .replace(/(?::\d+)+$/, "")
      .split(/[\\/]/)
      .pop()
      .replace(/-[A-Za-z0-9_-]{6,}(?=\.m?js$)/, "");
    frames.push([fn, location].filter(Boolean).join(" "));
    if (frames.length >= limit) break;
  }
  return frames;
}

function normalizeMessage(message) {
  return String(message || "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
    .replace(/\d+/g, "0")
    .replace(/“[^”]*”/g, "“…”")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// A route is reported without its query and with identifiers folded, so one
// failing endpoint is one fingerprint and no id or token leaves in the path.
function apiRoute(rawURL) {
  try {
    const url = new URL(String(rawURL));
    const segments = url.pathname.split("/").map((segment) => {
      if (!segment) return segment;
      let decoded = segment;
      try { decoded = decodeURIComponent(segment); } catch { /* keep the raw segment */ }
      return /^v\d+$/i.test(decoded) || /^[a-z][a-z_-]{0,40}$/.test(decoded) ? decoded : ":id";
    });
    return { host: url.host, path: segments.join("/") || "/" };
  } catch {
    return { host: "", path: "unknown" };
  }
}

module.exports = {
  apiRoute,
  createScrubber,
  normalizeMessage,
  normalizeStackFrames,
  truncateBytes,
};
