export type ManualProxyScheme = "http" | "socks5";

export interface ParsedManualProxyUrl {
  scheme: ManualProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
}

export interface ParsedManualProxyClipboard extends ParsedManualProxyUrl {
  source: "url" | "fields";
}

export interface ParsedManualProxyBatchItem {
  lineNumber: number;
  raw: string;
  proxy: ParsedManualProxyUrl;
}

export interface ManualProxyBatchError {
  lineNumber: number;
  message: string;
}

export const manualProxyLimits = {
  name: 120,
  host: 512,
  username: 512,
  password: 16_384,
  url: 17_500,
  batchLines: 500,
  batchText: 1_000_000,
} as const;

const defaultPorts: Record<ManualProxyScheme, number> = {
  http: 80,
  socks5: 1080,
};

function decodeUrlPart(value: string): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function validateProxyHost(rawHost: string): string {
  const host = rawHost.trim().replace(/^\[|\]$/g, "");
  if (!host) throw new Error("Proxy host is required.");
  if (/\s/.test(host) || /[/@]/.test(host)) throw new Error("Proxy host must be a domain name or IP address without spaces.");
  const isIPv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)
    && host.split(".").every((part) => Number(part) <= 255);
  const isIPv6 = host.includes(":") && /^[0-9a-f:]+$/i.test(host);
  const isDomain = host.includes(".") && host.split(".").every((part) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part));
  if (!isIPv4 && !isIPv6 && !isDomain && host.toLowerCase() !== "localhost") {
    throw new Error("Proxy host must be a domain name or IP address, for example proxy.example.com or 203.0.113.10.");
  }
  return rawHost.trim();
}

export function parseManualProxyUrl(rawValue: string): ParsedManualProxyUrl {
  const raw = rawValue.trim();
  if (!raw) throw new Error("Proxy URL is required.");
  if (raw.length > manualProxyLimits.url) {
    throw new Error(`Proxy URL is too long (maximum ${manualProxyLimits.url.toLocaleString("en-US")} characters).`);
  }
  if (!raw.includes("://") && !raw.includes(":")) {
    throw new Error("Enter host:port or a full http:// or socks5:// proxy URL.");
  }

  let url: URL;
  try {
    url = new URL(raw.includes("://") ? raw : `http://${raw}`);
  } catch {
    throw new Error("Enter a valid proxy URL.");
  }

  const scheme = url.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "socks5") {
    throw new Error("Proxy URL must use http:// or socks5://.");
  }
  if (!url.hostname) throw new Error("Proxy URL must include a host.");
  validateProxyHost(url.hostname);
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error("Proxy URL must contain only scheme, credentials, host, and port — remove the path, query, or fragment.");
  }
  if (url.hostname.length > manualProxyLimits.host) {
    throw new Error(`Proxy host is too long (maximum ${manualProxyLimits.host} characters).`);
  }

  const port = url.port ? Number.parseInt(url.port, 10) : defaultPorts[scheme];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Proxy URL must include a valid port.");
  }

  const username = decodeUrlPart(url.username);
  const password = decodeUrlPart(url.password);
  if (username.length > manualProxyLimits.username) {
    throw new Error(`Proxy username is too long (maximum ${manualProxyLimits.username} characters).`);
  }
  if (password.length > manualProxyLimits.password) {
    throw new Error(`Proxy password is too long (maximum ${manualProxyLimits.password.toLocaleString("en-US")} characters).`);
  }

  return {
    scheme,
    host: url.hostname,
    port,
    username,
    password,
  };
}

export function parseManualProxyClipboard(rawValue: string): ParsedManualProxyClipboard {
  const raw = rawValue.trim();
  if (!raw) throw new Error("Clipboard is empty.");

  // Common provider export: host:port:username:password. Passwords may contain
  // colons, so only the first three separators are structural.
  if (!raw.includes("://") && !raw.includes("@")) {
    const [host = "", portRaw = "", username = "", ...passwordParts] = raw.split(":");
    if (host && /^\d+$/.test(portRaw) && passwordParts.length > 0) {
      const password = passwordParts.join(":");
      const port = Number(portRaw);
      validateManualProxyFields({ name: "Imported proxy", host, port, username, password });
      return { source: "fields", scheme: "http", host, port, username, password };
    }
  }

  return { source: "url", ...parseManualProxyUrl(raw) };
}

function proxyFingerprint(proxy: ParsedManualProxyUrl): string {
  return [proxy.scheme, proxy.host.toLowerCase(), proxy.port, proxy.username, proxy.password].join("\u0000");
}

export function parseManualProxyBatch(rawValue: string): {
  items: ParsedManualProxyBatchItem[];
  errors: ManualProxyBatchError[];
} {
  if (rawValue.length > manualProxyLimits.batchText) {
    return {
      items: [],
      errors: [{
        lineNumber: 0,
        message: `Proxy list is too large (maximum ${manualProxyLimits.batchText.toLocaleString("en-US")} characters).`,
      }],
    };
  }

  const lines = rawValue.split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), lineNumber: index + 1 }))
    .filter(({ raw }) => raw.length > 0);
  if (lines.length > manualProxyLimits.batchLines) {
    return {
      items: [],
      errors: [{
        lineNumber: 0,
        message: `Add up to ${manualProxyLimits.batchLines.toLocaleString("en-US")} proxies at a time.`,
      }],
    };
  }

  const items: ParsedManualProxyBatchItem[] = [];
  const errors: ManualProxyBatchError[] = [];
  const firstLineByProxy = new Map<string, number>();
  for (const line of lines) {
    try {
      const parsed = parseManualProxyClipboard(line.raw);
      const proxy = {
        scheme: parsed.scheme,
        host: parsed.host,
        port: parsed.port,
        username: parsed.username,
        password: parsed.password,
      };
      const fingerprint = proxyFingerprint(proxy);
      const firstLine = firstLineByProxy.get(fingerprint);
      if (firstLine) {
        errors.push({ lineNumber: line.lineNumber, message: `Duplicate of line ${firstLine}.` });
        continue;
      }
      firstLineByProxy.set(fingerprint, line.lineNumber);
      items.push({ ...line, proxy });
    } catch (error) {
      errors.push({
        lineNumber: line.lineNumber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { items, errors };
}

export function validateManualProxyFields(input: {
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}): void {
  if (!input.name.trim()) throw new Error("Proxy name is required.");
  if ([...input.name.trim()].length > manualProxyLimits.name) {
    throw new Error(`Proxy name is too long (maximum ${manualProxyLimits.name} characters).`);
  }
  const host = validateProxyHost(input.host);
  if (host.length > manualProxyLimits.host) {
    throw new Error(`Proxy host is too long (maximum ${manualProxyLimits.host} characters).`);
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new Error("Proxy port must be a whole number between 1 and 65535.");
  }
  if ((input.username?.length ?? 0) > manualProxyLimits.username) {
    throw new Error(`Proxy username is too long (maximum ${manualProxyLimits.username} characters).`);
  }
  if ((input.password?.length ?? 0) > manualProxyLimits.password) {
    throw new Error(`Proxy password is too long (maximum ${manualProxyLimits.password.toLocaleString("en-US")} characters).`);
  }
}

export function manualProxyDefaultName(proxy: ParsedManualProxyUrl): string {
  const host = proxy.host
    .replace(/^\[|\]$/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `manual-${proxy.scheme}-${host || "proxy"}-${proxy.port}`;
}
