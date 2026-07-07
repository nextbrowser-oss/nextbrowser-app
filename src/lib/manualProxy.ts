export type ManualProxyScheme = "http" | "socks5";

export interface ParsedManualProxyUrl {
  scheme: ManualProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
}

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

export function parseManualProxyUrl(rawValue: string): ParsedManualProxyUrl {
  const raw = rawValue.trim();
  if (!raw) throw new Error("Proxy URL is required.");

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

  const port = url.port ? Number.parseInt(url.port, 10) : defaultPorts[scheme];
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Proxy URL must include a valid port.");
  }

  return {
    scheme,
    host: url.hostname,
    port,
    username: decodeUrlPart(url.username),
    password: decodeUrlPart(url.password),
  };
}

export function manualProxyDefaultName(proxy: ParsedManualProxyUrl): string {
  const host = proxy.host
    .replace(/^\[|\]$/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `manual-${proxy.scheme}-${host || "proxy"}-${proxy.port}`;
}
