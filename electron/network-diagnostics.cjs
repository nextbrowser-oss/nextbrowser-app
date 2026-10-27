const childProcess = require("node:child_process");
const dns = require("node:dns");
const fsPromises = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const tls = require("node:tls");
const { powershellPath, runFileResult, withTimeout } = require("./client-environment-collect.cjs");

// Network diagnostics for error reports about the network or the proxy.
//
// Users with a VPN client (Xray/V2Ray/sing-box/Clash based apps, WireGuard,
// OpenVPN, corporate VPNs) report profiles that do not start and an
// api.nextbrowser.com that does not resolve. What matters is how the VPN
// changed this computer's network, so at the moment such a failure happens
// the main process takes one snapshot of it and the reporter attaches it to
// the report as net_* context fields. Hypotheses the fields confirm or rule out:
//  1. Full tunnel (TUN mode): the default route, or the route to our servers,
//     goes through a tunnel interface (utun, tun, wg, Wintun, TAP).
//  2. Fake-IP DNS: TUN modes answer DNS with addresses from 198.18.0.0/15.
//  3. Scoped/split DNS, or a DNS server inside the tunnel, that cannot
//     resolve our domains (ENOTFOUND).
//  4. A system proxy (VPN "system proxy" mode, usually 127.0.0.1:<port>) that
//     Chromium follows while nbc (Go, env proxies only) goes direct, or the
//     reverse.
//  5. Env proxies (HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NO_PROXY) inherited by
//     the app and passed on to nbc.
//  6. TLS interception: the certificate of api.nextbrowser.com does not verify.
//  7. MTU black hole: TCP connects but the TLS handshake hangs (EOF/timeout).
//  8. IPv6: a global IPv6 address while the tunnel carries IPv4 only, or the
//     reverse.
//  9. The NodeMaven gateway or our API is not reachable from here at all.
//
// Privacy: reports are anonymous technical data. No field ever holds an IP
// address, a MAC address, a host name of the user's infrastructure (VPN
// server, PAC host, a proxy that is not on this computer), a network, Wi-Fi
// or VPN service name, an interface name (Windows names adapters after the
// app that made them), or anything about other programs. Fields hold classes
// instead (see addressClass and interfaceFamily), ports of proxies on this
// computer only, counts, durations, error codes and yes/no. The reporter
// still scrubs every value.

const API_HOST = "api.nextbrowser.com";
const API_PORT = 443;
// nextbrowser-backend config.yaml: nodemaven.gateway_host / gateway_port.
const GATE_HOST = "gate.nodemaven.com";
const GATE_PORT = 8080;

const DEFAULT_TIMEOUTS = Object.freeze({
  total: 4_000,
  command: 2_000,
  powershell: 3_500,
  lookup: 2_500,
  connect: 3_000,
  tls: 3_500,
  proxy: 1_500,
});
const MAX_VALUE = 200;
const TUNNEL_FAMILIES = new Set(["utun", "tun", "tap", "wg", "ppp", "ipsec"]);
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

// ---- Classes ---------------------------------------------------------------

/**
 * The class of an IP address: loopback, fakeip (198.18.0.0/15, what TUN-mode
 * VPN clients answer DNS with), cgnat (100.64.0.0/10), private (RFC 1918),
 * linklocal, public, unspecified, multicast, or for IPv6 ipv6-global,
 * ipv6-ula, ipv6-linklocal, ipv6-other. "" when the value is not an address.
 */
function addressClass(value) {
  let ip = String(value || "").trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  if (/^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip)) ip = ip.slice(7);
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return "loopback";
    if (a === 0) return "unspecified";
    if (a === 198 && (b === 18 || b === 19)) return "fakeip";
    if (a === 100 && b >= 64 && b <= 127) return "cgnat";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
    if (a === 169 && b === 254) return "linklocal";
    if (a >= 224) return "multicast";
    return "public";
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1") return "loopback";
    if (lower === "::") return "unspecified";
    const first = lower.startsWith("::") ? 0 : parseInt(lower.split(":")[0], 16);
    if ((first & 0xffc0) === 0xfe80) return "ipv6-linklocal";
    if ((first & 0xfe00) === 0xfc00) return "ipv6-ula";
    if ((first & 0xff00) === 0xff00) return "multicast";
    if ((first & 0xe000) === 0x2000) return "ipv6-global";
    return "ipv6-other";
  }
  return "";
}

/** A host's class: an address class, loopback for localhost, or "host" for any other name. */
function hostClass(host) {
  const value = String(host || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!value) return "";
  if (value === "localhost" || value.endsWith(".localhost")) return "loopback";
  return addressClass(value) || "host";
}

/** "127.0.0.1:10808" → "loopback:10808"; the port is kept for this computer only. */
function hostPortClass(value) {
  const text = String(value || "").trim();
  const match = text.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/) || text.match(/^([^:\s]+)(?::(\d{1,5}))?$/);
  const host = match ? match[1] : text;
  const port = match ? match[2] : undefined;
  const cls = hostClass(host);
  if (!cls) return "none";
  return cls === "loopback" && port ? `${cls}:${port}` : cls;
}

/** "socks5://user:pass@127.0.0.1:7891" → "socks5://loopback:7891". */
function proxyURLClass(value) {
  const text = String(value || "").trim();
  if (!text) return "none";
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
  } catch {
    return "invalid";
  }
  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme === "file") return "file";
  const cls = hostClass(url.hostname);
  if (!cls) return `${scheme}://none`;
  return `${scheme}://${cls}${cls === "loopback" && url.port ? `:${url.port}` : ""}`;
}

/**
 * The family of a network interface by its BSD/Linux name: loopback, utun,
 * tun, tap, wg, ppp, ipsec, physical (en, eth, wlan, wifi), or other. The
 * raw name never leaves this function: on Windows, and for some Linux tunnels,
 * it is the name of the app that created the interface.
 */
function interfaceFamily(name) {
  const value = String(name || "").trim().toLowerCase();
  if (/^lo\d*$/.test(value) || /loopback/.test(value)) return "loopback";
  const tunnel = value.match(/^(utun|tun|tap|wg|ppp|ipsec)\d*$/);
  if (tunnel) return tunnel[1];
  if (/^(?:en|eth|wlan|wlp|wlo|wl|wifi|wi-fi|ethernet)(?:[\d\s]|$|[a-z]\d)/.test(value) || /^(?:ethernet|wi-fi|wifi|wlan)\b/.test(value)) return "physical";
  return "other";
}

/**
 * The family of a Windows adapter from what Get-NetAdapter says about it:
 * the driver description names Wintun, WireGuard and TAP drivers; IANA
 * ifType 53 (virtual) and 131 (tunnel) are point-to-point tunnel adapters,
 * 23 is PPP; a hardware interface is physical. Aliases are user- or app-chosen.
 */
function windowsAdapterFamily({ description = "", alias = "", hardware, ifType } = {}) {
  const text = `${description} ${alias}`;
  if (/wintun/i.test(text)) return "tun";
  if (/wireguard/i.test(text)) return "wg";
  if (/tap-windows|\btap\d*\b|\btap adapter\b/i.test(text)) return "tap";
  if (/\bikev2\b|\bipsec\b|\bl2tp\b/i.test(text)) return "ipsec";
  if (/\bppp\b|\bpptp\b|\bsstp\b|\bpppoe\b/i.test(text) || Number(ifType) === 23) return "ppp";
  if (/\btun\b|\btunnel\b/i.test(description) || Number(ifType) === 53 || Number(ifType) === 131) return "tun";
  if (Number(ifType) === 24 || /loopback/i.test(description)) return "loopback";
  if (hardware === true) return "physical";
  return "other";
}

/** A Windows interface known by its alias only (no adapter data): drivers named in it, else the name rules. */
function windowsAliasFamily(alias) {
  const family = windowsAdapterFamily({ alias });
  return family === "other" ? interfaceFamily(alias) : family;
}

// ---- Small helpers ---------------------------------------------------------

function errorCode(error) {
  const code = typeof error?.code === "string" ? error.code : typeof error === "string" ? error : "";
  return ERROR_CODE.test(code) ? code : "error";
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function cap(value) {
  const text = String(value ?? "");
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE - 1)}…` : text;
}

function ms(value) {
  return `${Math.max(0, Math.round(Number(value) || 0))}ms`;
}

/** "a,a,b" → "a×2,b": interface lists stay short on Macs with many utun interfaces. */
function counted(items) {
  const counts = new Map();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  return [...counts].map(([item, count]) => (count > 1 ? `${item}×${count}` : item)).join(",");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

function interfaceAddresses(interfaces, name) {
  return asArray(interfaces?.[name]).map((entry) => ({
    address: String(entry?.address || ""),
    v6: entry?.family === "IPv6" || entry?.family === 6,
    internal: entry?.internal === true,
  }));
}

/** IPv4 classes first, then IPv6 classes: "fakeip+ipv6-ula", or "none". */
function classesOf(addresses) {
  const v4 = unique(addresses.filter((entry) => !entry.v6 && net.isIP(entry.address.replace(/%.*$/, "")) !== 6).map((entry) => addressClass(entry.address)));
  const v6 = unique(addresses.filter((entry) => entry.v6 || net.isIP(entry.address.replace(/%.*$/, "")) === 6).map((entry) => addressClass(entry.address)));
  return [...v4, ...v6].join("+") || "none";
}

// ---- macOS -----------------------------------------------------------------

/** `route -n get <dest>`: { name } of the interface, { name: null } without a route, undefined if unknown. */
function parseMacRoute(result) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}`;
  if (/not in table/i.test(text)) return { name: null };
  if (result?.error) return undefined;
  const name = String(result?.stdout || "").match(/^\s*interface:\s*(\S+)/m)?.[1];
  return { name: name || null };
}

/** `ifconfig`: interface name → { up, pointToPoint, mtu, addresses }. */
function parseIfconfig(output) {
  const links = new Map();
  let current;
  for (const line of String(output || "").split(/\r?\n/)) {
    const header = line.match(/^([A-Za-z0-9_.-]+):\s+flags=\w+<([^>]*)>(?:.*?\bmtu\s+(\d+))?/);
    if (header) {
      const flags = header[2].split(",");
      current = { up: flags.includes("UP"), pointToPoint: flags.includes("POINTOPOINT"), mtu: header[3] ? Number(header[3]) : undefined, addresses: [] };
      links.set(header[1], current);
      continue;
    }
    const address = line.match(/^\s+inet(6)?\s+(\S+)/);
    if (address && current) current.addresses.push({ address: address[2].replace(/%.*$/, ""), v6: Boolean(address[1]) });
  }
  return links;
}

/**
 * `scutil --proxy` prints a dictionary; the top-level keys are read and arrays
 * (ExceptionsList) are counted. Nested dictionaries (__SCOPED__) are skipped.
 */
function parseScutilProxy(output) {
  const values = {};
  let depth = 0;
  let array = "";
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "}") {
      depth -= 1;
      if (depth === 1) array = "";
      continue;
    }
    const entry = line.match(/^([^:]+?)\s*:\s*(.*)$/);
    if (!entry) {
      if (/\{$/.test(line)) depth += 1;
      continue;
    }
    const [, key, value] = entry;
    if (/^<(?:array|dictionary)>\s*\{$/.test(value)) {
      if (depth === 1 && value.startsWith("<array>")) {
        array = key;
        values[key] = 0;
      }
      depth += 1;
      continue;
    }
    if (depth === 1) values[key] = value;
    else if (depth === 2 && array) values[array] += 1;
  }
  return values;
}

function describeMacProxy(values) {
  const parts = [];
  for (const [label, prefix] of [["http", "HTTP"], ["https", "HTTPS"], ["socks", "SOCKS"]]) {
    if (String(values[`${prefix}Enable`]) !== "1") continue;
    const host = values[`${prefix}Proxy`];
    const port = values[`${prefix}Port`];
    parts.push(`${label}=${hostPortClass(port ? `${host}:${port}` : host)}`);
  }
  if (String(values.ProxyAutoConfigEnable) === "1") {
    const url = String(values.ProxyAutoConfigURLString || "");
    parts.push(`pac=${url ? proxyURLClass(url).replace(/^[a-z0-9+.-]+:\/\//, "").replace(/:\d+$/, "") : "none"}`);
  }
  if (String(values.ProxyAutoDiscoveryEnable) === "1") parts.push("wpad=on");
  if (!parts.length) parts.push("off");
  if (Number(values.ExceptionsList) > 0) parts.push(`exceptions=${values.ExceptionsList}`);
  return parts.join(";");
}

/** `scutil --dns`: the unscoped resolvers and the ones for scoped queries. */
function parseScutilDns(output) {
  const sections = { main: [], scoped: [] };
  let section = sections.main;
  let current;
  for (const raw of String(output || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^DNS configuration \(for scoped queries\)/i.test(line)) {
      section = sections.scoped;
      current = undefined;
      continue;
    }
    if (/^resolver #\d+/i.test(line)) {
      current = { nameservers: [], domain: "", ifName: "", options: "", flags: "" };
      section.push(current);
      continue;
    }
    if (!current) continue;
    const entry = line.match(/^([a-z_ ]+?)(?:\[\d+\])?\s*:\s*(.*)$/i);
    if (!entry) continue;
    const key = entry[1].trim().toLowerCase();
    const value = entry[2].trim();
    if (key === "nameserver") current.nameservers.push(value);
    else if (key === "domain") current.domain = value;
    else if (key === "if_index") current.ifName = value.match(/\(([^)]+)\)/)?.[1] || "";
    else if (key === "options") current.options = value;
    else if (key === "flags") current.flags = value;
  }
  return sections;
}

// A supplemental resolver whose domain is ours (or a parent of it) decides
// how our names resolve: hypothesis 3.
function coversOurDomains(domain) {
  const value = String(domain || "").toLowerCase().replace(/\.$/, "");
  if (!value) return false;
  return [API_HOST, GATE_HOST].some((host) => host === value || host.endsWith(`.${value}`));
}

function describeMacDns({ main = [], scoped = [] } = {}) {
  const primary = main.find((resolver) => resolver.nameservers.length && !resolver.domain);
  const classes = primary ? unique(primary.nameservers.map(addressClass)).join("+") || "none" : "none";
  const where = primary?.ifName ? interfaceFamily(primary.ifName) : "any";
  const split = main.filter((resolver) => resolver.domain && !/mdns/i.test(resolver.options));
  const tunnelScoped = scoped.filter((resolver) => TUNNEL_FAMILIES.has(interfaceFamily(resolver.ifName)) && resolver.nameservers.length);
  return `primary=${classes}@${where};split=${split.length};split_ours=${split.filter((resolver) => coversOurDomains(resolver.domain)).length};scoped_tun=${tunnelScoped.length}`;
}

// ---- Linux -----------------------------------------------------------------

/** `ip route show default` (lowest metric wins) or `ip route get`: { name } or { name: null }. */
function parseLinuxRoute(result) {
  if (result?.error) return undefined;
  let best;
  for (const line of String(result?.stdout || "").split(/\r?\n/)) {
    const dev = line.match(/\bdev\s+(\S+)/)?.[1];
    if (!dev) continue;
    const metric = Number(line.match(/\bmetric\s+(\d+)/)?.[1] || 0);
    if (!best || metric < best.metric) best = { name: dev, metric };
  }
  return { name: best?.name || null };
}

/** `ip -o -d link show`: name → { up, mtu, family } (family from the link kind). */
function parseIpLink(output) {
  const links = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const header = line.match(/^\d+:\s+([^:@\s]+)(?:@\S+)?:\s+<([^>]*)>.*?\bmtu\s+(\d+)/);
    if (!header) continue;
    const flags = header[2].split(",");
    let family = interfaceFamily(header[1]);
    const tun = line.match(/\btun type (tun|tap)\b/);
    if (tun) family = tun[1];
    else if (/\\\s*wireguard\b/.test(line)) family = "wg";
    else if (/link\/ppp\b/.test(line)) family = "ppp";
    else if (/\\\s*(?:vti6?|xfrm)\b/.test(line)) family = "ipsec";
    else if (family === "other" && /link\/none\b/.test(line) && flags.includes("POINTOPOINT")) family = "tun";
    links.set(header[1], { up: flags.includes("UP"), mtu: Number(header[3]), family, addresses: [] });
  }
  return links;
}

function parseResolvConf(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.match(/^\s*nameserver\s+(\S+)/)?.[1]).filter(Boolean);
}

function describeResolvConf(text) {
  const servers = parseResolvConf(text);
  return `primary=${unique(servers.map(addressClass)).join("+") || "none"};servers=${servers.length}`;
}

/** `gsettings list-recursively org.gnome.system.proxy`: "schema key value" lines. */
function parseGnomeProxy(output) {
  const values = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^org\.gnome\.system\.proxy(?:\.(\w+))?\s+(\S+)\s+(.*)$/);
    // Credentials live in the same schema; they are never read.
    if (!match || /password|user/i.test(match[2])) continue;
    values[`${match[1] ? `${match[1]}.` : ""}${match[2]}`] = match[3].trim().replace(/^'(.*)'$/, "$1");
  }
  return values;
}

function describeGnomeProxy(values) {
  const mode = values.mode || "none";
  if (mode === "none") return "off";
  if (mode === "auto") return `pac=${values["autoconfig-url"] ? proxyURLClass(values["autoconfig-url"]).replace(/^[a-z0-9+.-]+:\/\//, "").replace(/:\d+$/, "") : "wpad"}`;
  const parts = [];
  for (const kind of ["http", "https", "socks"]) {
    const host = values[`${kind}.host`];
    if (!host) continue;
    const port = Number(values[`${kind}.port`]) || 0;
    parts.push(`${kind}=${hostPortClass(port ? `${host.includes(":") ? `[${host}]` : host}:${port}` : host)}`);
  }
  const ignored = (String(values["ignore-hosts"] || "").match(/'[^']*'/g) || []).length;
  if (ignored) parts.push(`exceptions=${ignored}`);
  return parts.join(";") || "manual";
}

// ---- Windows ---------------------------------------------------------------

// One read-only PowerShell call: default routes, adapters (driver description,
// hardware flag, ifType), IPv4 MTUs, DNS servers, and the interface of the
// route to api.nextbrowser.com (resolved here with a bounded wait). Only
// classes derived from it leave this module.
const WINDOWS_SCRIPT = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$result = @{}
$result.routes = @(Get-NetRoute -PolicyStore ActiveStore -DestinationPrefix '0.0.0.0/0','0.0.0.0/1','128.0.0.0/1','::/0','::/1','8000::/1' | ForEach-Object { @{ prefix = [string]$_.DestinationPrefix; ifIndex = [int]$_.ifIndex; metric = [int]$_.RouteMetric + [int]$_.InterfaceMetric } })
$result.adapters = @(Get-NetAdapter | ForEach-Object { @{ ifIndex = [int]$_.ifIndex; alias = [string]$_.Name; description = [string]$_.InterfaceDescription; hardware = [bool]$_.HardwareInterface; ifType = [int]$_.InterfaceType; up = ([string]$_.Status -eq 'Up') } })
$result.interfaces = @(Get-NetIPInterface -AddressFamily IPv4 | ForEach-Object { @{ ifIndex = [int]$_.ifIndex; alias = [string]$_.InterfaceAlias; mtu = [int]$_.NlMtu } })
$result.dns = @(Get-DnsClientServerAddress | Where-Object { $_.ServerAddresses } | ForEach-Object { @{ ifIndex = [int]$_.InterfaceIndex; servers = @($_.ServerAddresses) } })
$lookup = [System.Net.Dns]::GetHostAddressesAsync('${API_HOST}')
if ($lookup.Wait(1500) -and $lookup.Result.Count -gt 0) {
  $route = Find-NetRoute -RemoteIPAddress $lookup.Result[0].IPAddressToString | Where-Object { $_.ifIndex } | Select-Object -Last 1
  if ($route) { $result.api_ifIndex = [int]$route.ifIndex }
}
ConvertTo-Json -InputObject $result -Depth 4 -Compress
`;

function parseWindowsReport(output) {
  try {
    const value = JSON.parse(String(output || "").replace(/^﻿/, "").trim() || "null");
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function prefixLength(prefix) {
  return Number(String(prefix || "").split("/")[1]) || 0;
}

/** The route a packet takes: the most specific prefix, then the lowest metric. */
function bestRoute(routes) {
  return [...routes].sort((a, b) => prefixLength(b.prefix) - prefixLength(a.prefix) || (Number(a.metric) || 0) - (Number(b.metric) || 0))[0];
}

/** Interface alias → { family, up, mtu, ifIndex } from the PowerShell report. */
function windowsLinks(report) {
  const links = new Map();
  const mtus = new Map(asArray(report?.interfaces).map((entry) => [Number(entry?.ifIndex), Number(entry?.mtu) || undefined]));
  for (const adapter of asArray(report?.adapters)) {
    const alias = String(adapter?.alias || "");
    if (!alias) continue;
    links.set(alias, { family: windowsAdapterFamily(adapter), up: adapter.up !== false, mtu: mtus.get(Number(adapter.ifIndex)), ifIndex: Number(adapter.ifIndex) });
  }
  // Interfaces without an adapter (RAS/PPP connections) are known by alias only.
  for (const entry of asArray(report?.interfaces)) {
    const alias = String(entry?.alias || "");
    if (alias && !links.has(alias)) links.set(alias, { family: windowsAliasFamily(alias), up: true, mtu: Number(entry.mtu) || undefined, ifIndex: Number(entry.ifIndex) });
  }
  return links;
}

function windowsAlias(report, ifIndex) {
  if (!Number.isInteger(Number(ifIndex))) return undefined;
  const match = [...asArray(report?.adapters), ...asArray(report?.interfaces)].find((entry) => Number(entry?.ifIndex) === Number(ifIndex));
  return match?.alias ? String(match.alias) : undefined;
}

function windowsDefaults(report) {
  const routes = asArray(report?.routes).filter((route) => route && route.prefix);
  const pick = (v6) => {
    const best = bestRoute(routes.filter((route) => String(route.prefix).includes(":") === v6));
    return best ? { name: windowsAlias(report, best.ifIndex) || `if${Number(best.ifIndex)}` } : { name: null };
  };
  return { v4: pick(false), v6: pick(true) };
}

/**
 * `route print -4`: the default route's interface address, used only to find
 * the interface it belongs to. Rows are numeric, so localized headers do not
 * matter; the 0.0.0.0/128.0.0.0 pair OpenVPN adds outranks 0.0.0.0/0.
 */
function parseRoutePrint(output) {
  const routes = [];
  for (const line of String(output || "").split(/\r?\n/)) {
    const row = line.match(/^\s*(0\.0\.0\.0|128\.0\.0\.0)\s+(0\.0\.0\.0|128\.0\.0\.0)\s+(\S+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$/);
    if (!row || (row[1] === "128.0.0.0" && row[2] === "0.0.0.0")) continue;
    routes.push({ prefix: `${row[1]}/${row[2] === "0.0.0.0" ? 0 : 1}`, interfaceAddress: row[4], metric: Number(row[5]) });
  }
  return bestRoute(routes);
}

/** `reg query "HKCU\...\Internet Settings"`: the WinINET proxy values by name. */
function parseInternetSettings(output) {
  const values = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s+(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL|AutoDetect)\s+REG_\w+\s+(.*)$/);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

function describeWindowsProxy(values, winhttp) {
  const parts = [];
  if (/^(?:0x)?0*1$/i.test(String(values.ProxyEnable || "")) && values.ProxyServer) {
    for (const item of String(values.ProxyServer).split(";").map((entry) => entry.trim()).filter(Boolean).slice(0, 4)) {
      const [scheme, hostPort] = item.includes("=") ? item.split("=", 2) : ["all", item];
      parts.push(`${scheme.toLowerCase().replace(/[^a-z0-9]/g, "") || "all"}=${hostPortClass(hostPort)}`);
    }
  }
  if (values.AutoConfigURL) parts.push(`pac=${proxyURLClass(values.AutoConfigURL).replace(/^[a-z0-9+.-]+:\/\//, "").replace(/:\d+$/, "")}`);
  if (!parts.length) parts.push("off");
  const exceptions = String(values.ProxyOverride || "").split(";").filter((entry) => entry.trim()).length;
  if (parts[0] !== "off" && exceptions) parts.push(`exceptions=${exceptions}`);
  if (winhttp) parts.push(`winhttp=${winhttp}`);
  return parts.join(";");
}

/**
 * `netsh winhttp show proxy`: the labels are localized, so the proxy is the
 * first "host:port" value after a colon; without one, access is direct.
 */
function parseWinhttpProxy(output) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/:\s+(?:[a-z]+=)?(\[[0-9a-f:.]+\]:\d{1,5}|[A-Za-z0-9.-]+:\d{1,5})(?:[;\s]|$)/i);
    if (match) return hostPortClass(match[1]);
  }
  return "direct";
}

function describeWindowsDns(report, links, defaultName) {
  const entries = asArray(report?.dns);
  const byIndex = (ifIndex) => entries.filter((entry) => Number(entry?.ifIndex) === Number(ifIndex)).flatMap((entry) => asArray(entry.servers).map(String));
  const link = defaultName ? links.get(defaultName) : undefined;
  const servers = link ? byIndex(link.ifIndex) : [];
  const tunnels = [...links.values()].filter((entry) => TUNNEL_FAMILIES.has(entry.family) && entry.up && byIndex(entry.ifIndex).length).length;
  return `primary=${unique(servers.map(addressClass)).join("+") || "none"}@${link ? link.family : "any"};tun_dns=${tunnels}`;
}

// ---- Environment and Chromium proxies ---------------------------------------

/** HTTP_PROXY, HTTPS_PROXY, ALL_PROXY (as classes) and NO_PROXY (a count), any case. */
function describeEnvProxy(env) {
  const parts = [];
  for (const [name, value] of Object.entries(env || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (!/^(?:https?|all|no)_proxy$/i.test(name) || !String(value || "").trim()) continue;
    if (/^no_proxy$/i.test(name)) parts.push(`${name}=${String(value).split(",").filter((entry) => entry.trim()).length}`);
    else parts.push(`${name}=${proxyURLClass(value)}`);
  }
  return parts.join(";") || "none";
}

/** A PAC-style proxy list ("PROXY 127.0.0.1:10808; DIRECT") as classes. */
function describeProxyList(value) {
  const entries = String(value || "").split(";").map((entry) => entry.trim()).filter(Boolean).slice(0, 4);
  if (!entries.length) return "none";
  return entries.map((entry) => {
    const match = entry.match(/^(DIRECT)$|^(PROXY|HTTPS|HTTP|SOCKS|SOCKS4|SOCKS5|QUIC)\s+(\S+)$/i);
    if (!match) return "other";
    return match[1] ? "DIRECT" : `${match[2].toUpperCase()} ${hostPortClass(match[3])}`;
  }).join(",");
}

// ---- Which reports get the diagnostics --------------------------------------

const NBC_NETWORK_CODES = new Set(["REMOTE_BACKEND_ERROR", "VERIFY_FAILED", "VERIFY_REQUIRED", "NBC_VERIFY_FAILED", "LAUNCH_FAILED"]);
const START_OR_PROXY_COMMAND = /^start$|(?:^| )(?:proxy|proxies|set-proxy)(?: |$)/;

function nbcNetworkCode(code) {
  return typeof code === "string" && (NBC_NETWORK_CODES.has(code) || /^PROXY_/.test(code));
}

/**
 * Whether a report is about the network or the proxy, and so gets net_*
 * fields: kind network (backend calls and nbc requests that got no answer,
 * DNS failures included); a 5xx answer (a local proxy answers 502 when its
 * upstream fails); nbc failures REMOTE_BACKEND_ERROR, VERIFY_FAILED,
 * VERIFY_REQUIRED, LAUNCH_FAILED and PROXY_*, and timeouts of start and proxy
 * commands; a profile start that failed in the app window
 * (PROFILE_START_FAILED) or for an agent (HOST_PROFILE_START_FAILED); and a
 * failed personal proxy test.
 */
function wantsNetworkDiagnostics(event) {
  if (!event || typeof event !== "object") return false;
  const context = event.context && typeof event.context === "object" ? event.context : {};
  if (event.kind === "network") return true;
  if (event.kind === "api_error" && Number(context.status) >= 500) return true;
  if (event.source === "nbc") {
    if ([event.name, context.nbc_code, context.cause_code].some(nbcNetworkCode)) return true;
    return event.name === "NBC_TIMEOUT" && START_OR_PROXY_COMMAND.test(String(context.command || ""));
  }
  if (event.source === "renderer") return context.code === "PROFILE_START_FAILED";
  if (event.source === "main") return event.name === "HOST_PROFILE_START_FAILED" || context.command === "manual_proxy_test";
  return false;
}

// ---- Probes ----------------------------------------------------------------

function system32(env, exe) {
  const root = String(env?.SystemRoot || env?.windir || "").trim();
  return root ? path.win32.join(root, "System32", exe) : exe;
}

// Field order is the order the reporter adds them in while it has room.
const FIELD_ORDER = [
  "net_age_s", "net_default_route", "net_tunnels", "net_dns", "net_resolve_api", "net_tcp_api", "net_tls_api",
  "net_sys_proxy", "net_chromium_proxy", "net_env_proxy", "net_resolve_gate", "net_tcp_gate", "net_mtu", "net_ipv6",
];

/**
 * Creates the snapshot taker. Every dependency is injectable so tests run no
 * command and open no socket. `snapshot()` never rejects and returns at most
 * 15 short string fields; runs are cached for `maxAgeMs` and shared by
 * concurrent callers, and each run ends within `timeouts.total`.
 */
function createNetworkDiagnostics({
  platform = process.platform,
  env = process.env,
  execFileImpl = childProcess.execFile,
  lookupImpl = (host, options) => dns.promises.lookup(host, options),
  connectImpl = (options) => net.connect(options),
  tlsConnectImpl = (options) => tls.connect(options),
  resolveProxyImpl = async () => { throw Object.assign(new Error("no Chromium session"), { code: "UNAVAILABLE" }); },
  networkInterfacesImpl = () => os.networkInterfaces(),
  readFileImpl = (file) => fsPromises.readFile(file, "utf8"),
  now = () => Date.now(),
  timeouts = {},
} = {}) {
  const limits = { ...DEFAULT_TIMEOUTS, ...timeouts };
  let cached = null;

  const run = (file, args, timeoutMs = limits.command) => withTimeout(
    runFileResult(execFileImpl, file, args, timeoutMs),
    timeoutMs + 250,
    { stdout: "", stderr: "", error: "timeout" },
  );

  function socketProbe(create, readyEvent, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = now();
      let socket;
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try { socket?.destroy?.(); } catch { /* already closed */ }
        resolve({ ...result, ms: now() - startedAt });
      };
      const timer = setTimeout(() => finish({ error: "timeout" }), timeoutMs);
      timer.unref?.();
      try {
        socket = create();
        // A listener stays attached after the probe ends: a late error on a
        // destroyed socket must not become an uncaught exception.
        socket.on("error", (error) => finish({ error: errorCode(error) }));
        socket.once(readyEvent, () => finish({ ok: true, remoteAddress: socket.remoteAddress }));
      } catch (error) {
        finish({ error: errorCode(error) });
      }
    });
  }

  async function lookup(host) {
    const startedAt = now();
    const result = await withTimeout(
      Promise.resolve().then(() => lookupImpl(host, { all: true })).then((addresses) => ({ addresses: asArray(addresses) }), (error) => ({ error: errorCode(error) })),
      limits.lookup,
      { error: "timeout" },
    );
    return { ...result, ms: now() - startedAt };
  }

  function describeLookup(result) {
    if (result.error === "timeout") return "timeout";
    if (result.error) return `${result.error} ${ms(result.ms)}`;
    const addresses = result.addresses.map((entry) => ({ address: String(entry?.address || ""), v6: entry?.family === 6 || entry?.family === "IPv6" }));
    return `${classesOf(addresses)} ${ms(result.ms)}`;
  }

  function describeSocket(result, withClass) {
    if (result.error === "timeout") return "timeout";
    if (result.error) return `${result.error} ${ms(result.ms)}`;
    const cls = withClass ? addressClass(result.remoteAddress) : "";
    return `ok ${cls ? `${cls} ` : ""}${ms(result.ms)}`;
  }

  async function chromiumProxy() {
    const describe = async (url) => {
      const result = await withTimeout(
        Promise.resolve().then(() => resolveProxyImpl(url)).then((value) => ({ value }), (error) => ({ error: errorCode(error) })),
        limits.proxy,
        { error: "timeout" },
      );
      return result.error ? `error:${result.error}` : describeProxyList(result.value);
    };
    const [api, gate] = await Promise.all([describe(`https://${API_HOST}`), describe(`http://${GATE_HOST}:${GATE_PORT}`)]);
    return `api=${api};gate=${gate}`;
  }

  // Each platform answers the same questions: the default routes, its view
  // of the interfaces, the route to one address, DNS and the system proxy.
  function platformFacts(interfaces) {
    if (platform === "darwin") {
      const links = run("/sbin/ifconfig", []).then((result) => (result.error ? null : parseIfconfig(result.stdout)));
      return {
        links,
        defaults: Promise.all([run("/sbin/route", ["-n", "get", "default"]), run("/sbin/route", ["-n", "get", "-inet6", "default"])])
          .then(([v4, v6]) => ({ v4: parseMacRoute(v4), v6: parseMacRoute(v6) })),
        routeFor: (address) => run("/sbin/route", ["-n", "get", ...(net.isIP(address) === 6 ? ["-inet6"] : []), address]).then(parseMacRoute),
        dns: run("/usr/sbin/scutil", ["--dns"]).then((result) => (result.error ? `error:${result.error}` : describeMacDns(parseScutilDns(result.stdout)))),
        sysProxy: run("/usr/sbin/scutil", ["--proxy"]).then((result) => (result.error ? `error:${result.error}` : describeMacProxy(parseScutilProxy(result.stdout)))),
      };
    }
    if (platform === "win32") {
      const encoded = Buffer.from(WINDOWS_SCRIPT, "utf16le").toString("base64");
      const report = run(powershellPath(env), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], limits.powershell)
        .then((result) => parseWindowsReport(result.stdout));
      const routePrint = run(system32(env, "ROUTE.EXE"), ["print", "-4"]);
      const links = report.then((value) => (value ? windowsLinks(value) : null));
      return {
        links,
        defaults: Promise.all([report, routePrint]).then(([value, printed]) => {
          if (value && asArray(value.routes).length) return windowsDefaults(value);
          // Without PowerShell, `route print` still names the interface by its address.
          if (printed.error) return { v4: undefined, v6: undefined };
          const route = parseRoutePrint(printed.stdout);
          if (!route) return { v4: { name: null }, v6: undefined };
          const alias = Object.keys(interfaces || {}).find((name) => interfaceAddresses(interfaces, name).some((entry) => entry.address === route.interfaceAddress));
          return { v4: { name: alias || "unknown" }, v6: undefined };
        }),
        routeFor: () => report.then((value) => {
          const alias = windowsAlias(value, value?.api_ifIndex);
          return alias ? { name: alias } : undefined;
        }),
        dns: Promise.all([report, links]).then(([value, map]) => (value && map ? describeWindowsDns(value, map, windowsDefaults(value).v4?.name) : undefined)),
        sysProxy: Promise.all([
          run(system32(env, "reg.exe"), ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"]),
          run(system32(env, "netsh.exe"), ["winhttp", "show", "proxy"]),
        ]).then(([reg, winhttp]) => (reg.error ? `error:${reg.error}` : describeWindowsProxy(parseInternetSettings(reg.stdout), winhttp.error ? "" : parseWinhttpProxy(winhttp.stdout)))),
      };
    }
    const links = run("ip", ["-o", "-d", "link", "show"]).then((result) => (result.error ? null : parseIpLink(result.stdout)));
    return {
      links,
      defaults: Promise.all([run("ip", ["route", "show", "default"]), run("ip", ["-6", "route", "show", "default"])])
        .then(([v4, v6]) => ({ v4: parseLinuxRoute(v4), v6: parseLinuxRoute(v6) })),
      routeFor: (address) => run("ip", [...(net.isIP(address) === 6 ? ["-6"] : []), "route", "get", address]).then(parseLinuxRoute),
      dns: Promise.resolve().then(() => readFileImpl("/etc/resolv.conf")).then(describeResolvConf, (error) => `error:${errorCode(error)}`),
      // Desktops without GNOME settings have env proxies only (net_env_proxy).
      sysProxy: run("gsettings", ["list-recursively", "org.gnome.system.proxy"]).then((result) => (result.error ? undefined : describeGnomeProxy(parseGnomeProxy(result.stdout)))),
    };
  }

  async function collect() {
    const fields = {};
    const set = (key, value) => {
      if (value !== undefined && value !== null && value !== "") fields[key] = cap(value);
    };
    const step = (promise, apply) => Promise.resolve(promise).then(apply).catch(() => undefined);

    let interfaces = {};
    try { interfaces = networkInterfacesImpl() || {}; } catch { /* no interface list */ }
    const names = Object.keys(interfaces);
    const facts = platformFacts(interfaces);
    const familyOf = (name, links) => (name ? links?.get(name)?.family || (platform === "win32" ? windowsAliasFamily(name) : interfaceFamily(name)) : "none");
    const globalV6 = (links) => unique(names.filter((name) => interfaceAddresses(interfaces, name).some((entry) => !entry.internal && addressClass(entry.address) === "ipv6-global")).map((name) => familyOf(name, links)));

    // 5: proxies the app (and so nbc) inherited from its environment.
    set("net_env_proxy", describeEnvProxy(env));
    // 8: a global IPv6 address, and on which interface families.
    const ipv6 = (links) => {
      const families = globalV6(links);
      set("net_ipv6", families.length ? `yes:${families.join("+")}` : "no");
    };
    ipv6(null);

    const apiLookup = lookup(API_HOST);
    const work = [
      // 2, 3: what the system resolver apps use answers for our names (fake-ip, ENOTFOUND).
      step(apiLookup, (result) => set("net_resolve_api", describeLookup(result))),
      step(lookup(GATE_HOST), (result) => set("net_resolve_gate", describeLookup(result))),
      // 1, 2, 9: whether a TCP connection opens, how fast, and to what class of address
      // (a TUN stack answers within a few ms from a fake-ip address).
      step(socketProbe(() => connectImpl({ host: API_HOST, port: API_PORT }), "connect", limits.connect), (result) => set("net_tcp_api", describeSocket(result, true))),
      step(socketProbe(() => connectImpl({ host: GATE_HOST, port: GATE_PORT }), "connect", limits.connect), (result) => set("net_tcp_gate", describeSocket(result, true))),
      // 6, 7: a verified TLS handshake; a chain error means something in between
      // presents its own certificate (ours chains to a public CA), and TCP ok
      // with a TLS timeout points at an MTU black hole. Node checks its own CA
      // list, not the OS store.
      step(socketProbe(() => tlsConnectImpl({ host: API_HOST, port: API_PORT, servername: API_HOST, rejectUnauthorized: true }), "secureConnect", limits.tls), (result) => set("net_tls_api", describeSocket(result, false))),
      // 4: where Chromium (the app window, Live View, Electron's net) sends our requests.
      step(chromiumProxy(), (value) => set("net_chromium_proxy", value)),
      // 4: the OS system proxy (VPN apps in system-proxy mode set 127.0.0.1:<port>).
      step(facts.sysProxy, (value) => set("net_sys_proxy", value)),
      // 2, 3: the system resolvers by class, split resolvers, resolvers scoped to tunnels.
      step(facts.dns, (value) => set("net_dns", value)),
      // 1: up tunnel-like interfaces with the class of their addresses.
      step(facts.links, (links) => {
        const entries = [];
        const seen = new Set([...names, ...(links ? links.keys() : [])]);
        for (const name of seen) {
          const link = links?.get(name);
          const family = familyOf(name, links);
          if (!TUNNEL_FAMILIES.has(family) || (link && link.up === false)) continue;
          const addresses = [...interfaceAddresses(interfaces, name), ...(link?.addresses || [])];
          entries.push(`${family}:${classesOf(addresses)}`);
        }
        set("net_tunnels", entries.length ? counted(entries.sort()) : "none");
        ipv6(links);
      }),
      // 1, 7: the default routes, the route to our API, and their MTU.
      step(Promise.all([facts.defaults, facts.links, apiLookup]), async ([defaults, links, resolved]) => {
        const addresses = asArray(resolved?.addresses).map((entry) => String(entry?.address || ""));
        const target = addresses.find((address) => net.isIP(address) === 4) || addresses[0];
        // The route to our API catches VPNs that leave the default route alone
        // and add narrower routes (0/1 + 128/1, policy routing).
        const api = (target || platform === "win32") ? await withTimeout(facts.routeFor(target), 1_000, undefined) : undefined;
        const family = (route) => (route === undefined ? "?" : familyOf(route.name, links));
        const tunnel = [defaults?.v4, api].some((route) => route && TUNNEL_FAMILIES.has(family(route)));
        set("net_default_route", `v4=${family(defaults?.v4)};v6=${family(defaults?.v6)}${api ? `;api=${family(api)}` : ""};tunnel=${tunnel ? "yes" : "no"}`);
        const mtu = (route) => (route?.name ? links?.get(route.name)?.mtu : undefined);
        const parts = [];
        if (mtu(defaults?.v4)) parts.push(`v4=${mtu(defaults.v4)}`);
        if (api?.name && api.name !== defaults?.v4?.name && mtu(api)) parts.push(`api=${mtu(api)}`);
        set("net_mtu", parts.join(";"));
      }),
    ];
    await withTimeout(Promise.all(work), limits.total, undefined);
    const ordered = {};
    for (const key of FIELD_ORDER) if (fields[key] !== undefined) ordered[key] = fields[key];
    return ordered;
  }

  /**
   * The current snapshot: a finished one up to `maxAgeMs` old, the run in
   * progress, or a new run. net_age_s is how many seconds ago the snapshot
   * was finished: 0 for one taken for this report.
   */
  function snapshot({ maxAgeMs = 60_000 } = {}) {
    if (!cached || (cached.finishedAt !== undefined && now() - cached.finishedAt > maxAgeMs)) {
      const entry = {};
      entry.promise = collect().catch(() => ({})).then((fields) => {
        entry.finishedAt = now();
        return fields;
      });
      cached = entry;
    }
    const entry = cached;
    return entry.promise.then((fields) => ({
      net_age_s: String(Math.max(0, Math.round((now() - entry.finishedAt) / 1000))),
      ...fields,
    }));
  }

  return { snapshot };
}

module.exports = {
  API_HOST,
  FIELD_ORDER,
  GATE_HOST,
  GATE_PORT,
  WINDOWS_SCRIPT,
  addressClass,
  createNetworkDiagnostics,
  describeEnvProxy,
  describeGnomeProxy,
  describeMacDns,
  describeMacProxy,
  describeProxyList,
  describeResolvConf,
  describeWindowsDns,
  describeWindowsProxy,
  hostClass,
  hostPortClass,
  interfaceFamily,
  parseGnomeProxy,
  parseIfconfig,
  parseInternetSettings,
  parseIpLink,
  parseLinuxRoute,
  parseMacRoute,
  parseRoutePrint,
  parseScutilDns,
  parseScutilProxy,
  parseWindowsReport,
  parseWinhttpProxy,
  proxyURLClass,
  wantsNetworkDiagnostics,
  windowsAdapterFamily,
  windowsAliasFamily,
  windowsDefaults,
  windowsLinks,
};
