export type ManualProxyScheme = "http" | "socks5";

export interface ParsedManualProxyUrl {
  scheme: ManualProxyScheme;
  host: string;
  port: number;
  username: string;
  password: string;
}

export const manualProxyLimits = {
  name: 120,
  host: 512,
  username: 512,
  password: 16_384,
  url: 17_500,
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

export function parseManualProxyUrl(rawValue: string): ParsedManualProxyUrl {
  const raw = rawValue.trim();
  if (!raw) throw new Error("Proxy URL is required.");
  if (raw.length > manualProxyLimits.url) {
    throw new Error(`Proxy URL is too long (maximum ${manualProxyLimits.url.toLocaleString("en-US")} characters).`);
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
  const host = input.host.trim();
  if (!host) throw new Error("Proxy host is required.");
  if (host.length > manualProxyLimits.host) {
    throw new Error(`Proxy host is too long (maximum ${manualProxyLimits.host} characters).`);
  }
  if (/\s/.test(host)) throw new Error("Proxy host cannot contain spaces.");
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
