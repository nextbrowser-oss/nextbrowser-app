const { execFile } = require("node:child_process");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { GROUPS, osFamily } = require("./client-environment.cjs");

// Collectors for device data. Each one reads only what its group reports:
// OS settings and hardware facts, never the computer or user name, file
// paths, other programs, history, the clipboard or typed text. All of them
// are best effort with timeouts; a failure yields less data, never an error.

const COMMAND_TIMEOUT_MS = 5_000;
const POWERSHELL_TIMEOUT_MS = 20_000;
const GROUP_TIMEOUT_MS = 30_000;

// PCI vendor ids, for GPUs the OS does not name.
const GPU_VENDORS = new Map([
  [0x10de, "NVIDIA"],
  [0x1002, "AMD"],
  [0x1022, "AMD"],
  [0x8086, "Intel"],
  [0x106b, "Apple"],
  [0x5143, "Qualcomm"],
  [0x13b5, "Arm"],
  [0x1414, "Microsoft"],
  [0x15ad, "VMware"],
  [0x1ab8, "Parallels"],
  [0x80ee, "VirtualBox"],
  [0x1af4, "Red Hat"],
]);

// One PowerShell call reads the Windows keyboard and device facts. Registry
// values are read one by one by name, so nothing else in those keys (such as
// the registered owner) is ever loaded.
const WINDOWS_PREAMBLE = String.raw`$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Read-Value($key, $name) { (Get-ItemProperty -LiteralPath $key -Name $name).$name }
$result = @{}
`;
const WINDOWS_KEYBOARD = String.raw`$layouts = @()
$languages = Get-WinUserLanguageList
foreach ($language in $languages) {
  foreach ($tip in @($language.InputMethodTips)) {
    $name = ''
    if ($tip -match '^[0-9A-Fa-f]{4}:([0-9A-Fa-f]{8})$') {
      $name = Read-Value ('HKLM:\SYSTEM\CurrentControlSet\Control\Keyboard Layouts\' + $Matches[1]) 'Layout Text'
    } elseif ($tip -match '^([0-9A-Fa-f]{4}):(\{[^}]+\})(\{[^}]+\})$') {
      $name = Read-Value ('HKLM:\SOFTWARE\Microsoft\CTF\TIP\' + $Matches[2] + '\LanguageProfile\0x0000' + $Matches[1] + '\' + $Matches[3]) 'Description'
    }
    $layouts += @{ tip = [string]$tip; name = [string]$name; language = [string]$language.LanguageTag; language_name = [string]$language.EnglishName }
  }
}
$override = Get-WinDefaultInputMethodOverride
$result.keyboard = @{ layouts = $layouts; default = [string]$override.InputMethodTip }
`;
const WINDOWS_DEVICE = String.raw`$version = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$result.os = @{ product = [string](Read-Value $version 'ProductName'); display_version = [string](Read-Value $version 'DisplayVersion'); build = [string](Read-Value $version 'CurrentBuildNumber'); ubr = [string](Read-Value $version 'UBR') }
$gpus = @()
foreach ($adapter in @(Get-CimInstance -ClassName Win32_VideoController -Property Name, AdapterCompatibility, DriverVersion, PNPDeviceID)) {
  $vendorId = ''
  $deviceId = ''
  if ([string]$adapter.PNPDeviceID -match 'VEN_([0-9A-Fa-f]{4})&DEV_([0-9A-Fa-f]{4})') { $vendorId = $Matches[1]; $deviceId = $Matches[2] }
  $gpus += @{ name = [string]$adapter.Name; vendor = [string]$adapter.AdapterCompatibility; driver_version = [string]$adapter.DriverVersion; vendor_id = $vendorId; device_id = $deviceId }
}
$result.gpus = $gpus
`;
const WINDOWS_OUTPUT = "ConvertTo-Json -InputObject $result -Depth 5 -Compress\n";

function windowsScript({ keyboard, device }) {
  return `${WINDOWS_PREAMBLE}${keyboard ? WINDOWS_KEYBOARD : ""}${device ? WINDOWS_DEVICE : ""}${WINDOWS_OUTPUT}`;
}

function safe(fn, fallback) {
  try {
    const value = fn();
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

function withTimeout(promise, ms, fallback) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Runs a program without a shell. Never rejects: resolves its output and,
 * when it failed, why (`error` is "timeout", a spawn error code such as
 * ENOENT, or "exit<N>").
 */
function runFileResult(execFileImpl, file, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return new Promise((resolve) => {
    try {
      execFileImpl(file, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const output = { stdout: String(stdout || ""), stderr: String(stderr || "") };
        if (!error) return resolve(output);
        const reason = error.killed || error.signal === "SIGTERM" ? "timeout"
          : typeof error.code === "string" ? error.code
          : Number.isInteger(error.code) ? `exit${error.code}`
          : "failed";
        resolve({ ...output, error: reason });
      });
    } catch (error) {
      resolve({ stdout: "", stderr: "", error: typeof error?.code === "string" ? error.code : "failed" });
    }
  });
}

/** Runs a program without a shell; resolves its output, or "" on any failure. */
function runFile(execFileImpl, file, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  return runFileResult(execFileImpl, file, args, timeoutMs).then((result) => (result.error ? "" : result.stdout));
}

function powershellPath(env = process.env) {
  const root = String(env.SystemRoot || env.windir || "").trim();
  return root ? path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe") : "powershell.exe";
}

/** OS language names come as en_US.UTF-8, en-US@posix or C; keep the tag. */
function languageTag(value) {
  const tag = String(value || "").trim().replace(/[.@].*$/, "").replace(/_/g, "-");
  return tag && !/^(?:c|posix)$/i.test(tag) ? tag : undefined;
}

function parseJSON(output) {
  try {
    return JSON.parse(String(output || "").replace(/^﻿/, "").trim() || "null");
  } catch {
    return null;
  }
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value && typeof value === "object" ? [value] : [];
}

// ---- Windows ---------------------------------------------------------------

function windowsKeyboard(report) {
  if (!report || typeof report !== "object") return undefined;
  const tipId = (tip) => {
    const value = String(tip || "").trim();
    // A keyboard layout tip is LANGID:KLID; the KLID names the layout.
    // Input method editors keep the whole tip (language and profile ids).
    return (value.match(/^[0-9a-f]{4}:([0-9a-f]{8})$/i)?.[1] || value).toUpperCase();
  };
  const layouts = asArray(report.layouts).flatMap((entry) => {
    const id = tipId(entry?.tip);
    if (!id) return [];
    const name = String(entry.name || "").trim();
    // A resource reference (@%SystemRoot%\...) is not a name.
    const usable = name && !name.startsWith("@") ? name : String(entry.language_name || "").trim();
    return [{ id, name: usable || undefined, language: languageTag(entry.language) }];
  });
  const current = tipId(report.default) || layouts[0]?.id;
  return { layouts, ...(current ? { current } : {}) };
}

function windowsOs(report, release) {
  const build = String(report?.build || "").trim() || release.split(".")[2] || "";
  const ubr = String(report?.ubr || "").trim();
  // Windows 11 still names itself "Windows 10" in the registry.
  let name = String(report?.product || "").trim();
  if (Number(build) >= 22000) name = name.replace(/^Windows 10\b/, "Windows 11");
  return {
    os_name: name || undefined,
    os_version: release || undefined,
    os_build: build ? (/^\d+$/.test(ubr) ? `${build}.${ubr}` : build) : undefined,
  };
}

// ---- macOS -----------------------------------------------------------------

/**
 * Parses the property-list text that `defaults read` prints (dictionaries in
 * braces, arrays in parentheses, quoted or bare strings). Returns undefined
 * for anything it cannot read.
 */
function parseDefaults(output) {
  const source = String(output || "");
  let index = 0;
  const skip = () => {
    while (index < source.length && /\s/.test(source[index])) index += 1;
  };
  const quoted = () => {
    index += 1;
    let value = "";
    while (index < source.length && source[index] !== "\"") {
      if (source[index] === "\\") {
        const next = source[index + 1];
        if (next === "U" || next === "u") {
          value += String.fromCharCode(parseInt(source.slice(index + 2, index + 6), 16));
          index += 6;
          continue;
        }
        if (/[0-7]/.test(next)) {
          const octal = source.slice(index + 1).match(/^[0-7]{1,3}/)[0];
          value += String.fromCharCode(parseInt(octal, 8));
          index += 1 + octal.length;
          continue;
        }
        value += { n: "\n", t: "\t", r: "\r" }[next] ?? next;
        index += 2;
        continue;
      }
      value += source[index];
      index += 1;
    }
    if (source[index] !== "\"") throw new Error("unterminated string");
    index += 1;
    return value;
  };
  const value = () => {
    skip();
    const char = source[index];
    if (char === "{") {
      index += 1;
      const object = {};
      for (;;) {
        skip();
        if (source[index] === "}") { index += 1; return object; }
        const key = value();
        skip();
        if (source[index] !== "=") throw new Error("expected =");
        index += 1;
        object[key] = value();
        skip();
        if (source[index] === ";") index += 1;
      }
    }
    if (char === "(") {
      index += 1;
      const array = [];
      for (;;) {
        skip();
        if (source[index] === ")") { index += 1; return array; }
        array.push(value());
        skip();
        if (source[index] === ",") index += 1;
      }
    }
    if (char === "\"") return quoted();
    const match = source.slice(index).match(/^[^\s{}();=,"]+/);
    if (!match) throw new Error("unexpected input");
    index += match[0].length;
    return match[0];
  };
  try {
    const result = value();
    skip();
    return index === source.length ? result : undefined;
  } catch {
    return undefined;
  }
}

function readableId(id) {
  return String(id || "").split(".").filter(Boolean).pop() || undefined;
}

/** One enabled input source from com.apple.HIToolbox, or undefined for non-keyboard sources. */
function macInputSource(source) {
  if (!source || typeof source !== "object") return undefined;
  const kind = source.InputSourceKind;
  if (kind === "Keyboard Layout") {
    const layoutId = source["KeyboardLayout ID"];
    const name = source["KeyboardLayout Name"];
    if (layoutId === undefined && !name) return undefined;
    return { id: `keylayout:${layoutId ?? name}`, name: name || undefined };
  }
  if (kind === "Input Mode" && source["Input Mode"]) {
    return { id: source["Input Mode"], name: readableId(source["Input Mode"]), bundle: source["Bundle ID"] };
  }
  if (kind === "Keyboard Input Method" && source["Bundle ID"]) {
    return { id: source["Bundle ID"], name: readableId(source["Bundle ID"]), bundle: source["Bundle ID"], method: true };
  }
  // Emoji picker, press-and-hold and other non-keyboard input methods.
  return undefined;
}

function macKeyboard(enabledOutput, selectedOutput) {
  const enabled = asArray(parseDefaults(enabledOutput)).map(macInputSource).filter(Boolean);
  if (!enabled.length) return undefined;
  // An input method that lists its modes is reported by its modes.
  const withModes = new Set(enabled.filter((source) => !source.method && source.bundle).map((source) => source.bundle));
  const layouts = enabled
    .filter((source) => !(source.method && withModes.has(source.bundle)))
    .map(({ id, name }) => ({ id, ...(name ? { name } : {}) }));
  const selected = asArray(parseDefaults(selectedOutput)).map(macInputSource).find(Boolean);
  const current = selected && layouts.some((layout) => layout.id === selected.id) ? selected.id : undefined;
  return { layouts, ...(current ? { current } : {}) };
}

function parseSwVers(output) {
  const fields = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^\s*(ProductName|ProductVersion|ProductVersionExtra|BuildVersion):\s*(.+?)\s*$/);
    if (match) fields[match[1]] = match[2];
  }
  return fields;
}

// ---- Linux -----------------------------------------------------------------

function parseOsRelease(output) {
  const fields = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) fields[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

/** GNOME input sources: [('xkb', 'us'), ('xkb', 'ru+phonetic'), ('ibus', 'mozc-jp')]. */
function parseGsettingsSources(output) {
  return [...String(output || "").matchAll(/\(\s*'([^']*)'\s*,\s*'([^']*)'\s*\)/g)]
    .map(([, type, value]) => ({ id: type === "xkb" ? value : `${type}:${value}`, name: value }))
    .filter((source) => source.name);
}

/** setxkbmap -query: "layout: us,ru" with "variant: ,phonetic". */
function parseSetxkbmap(output) {
  const field = (name) => String(output || "").match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1].trim() || "";
  const variants = field("variant").split(",");
  return field("layout").split(",").map((layout, index) => {
    const id = layout.trim();
    const variant = (variants[index] || "").trim();
    return id ? { id: variant ? `${id}(${variant})` : id, name: variant ? `${id}(${variant})` : id } : null;
  }).filter(Boolean);
}

// ---- Shared ----------------------------------------------------------------

function gpuName({ vendorId, deviceId, vendor }) {
  const id = Number(deviceId) || 0;
  return `${vendor || GPU_VENDORS.get(vendorId) || "GPU"} 0x${id.toString(16).padStart(4, "0")}`;
}

/**
 * GPUs as Chromium sees them, named by the OS where Chromium has no name:
 * Windows by matching PCI ids to its video controllers, Apple silicon by the
 * chip it is part of.
 */
function gpuList({ info, windowsGpus = [], platform, cpuModel }) {
  const devices = asArray(info?.gpuDevice).filter((device) => device && (device.vendorId || device.deviceId || device.deviceString));
  const hex = (value) => Number(value || 0).toString(16).padStart(4, "0").toLowerCase();
  const fromWindows = (vendorId, deviceId) => windowsGpus.find((gpu) => (
    String(gpu?.vendor_id || "").toLowerCase() === hex(vendorId) && String(gpu?.device_id || "").toLowerCase() === hex(deviceId)
  ));
  if (!devices.length) {
    return windowsGpus.map((gpu) => ({ name: gpu?.name, vendor: gpu?.vendor || undefined, driver_version: gpu?.driver_version || undefined }));
  }
  return devices.map((device) => {
    const vendorId = Number(device.vendorId) || 0;
    const match = platform === "win32" ? fromWindows(vendorId, device.deviceId) : undefined;
    const vendor = match?.vendor || String(device.vendorString || "").trim() || GPU_VENDORS.get(vendorId) || String(device.driverVendor || "").trim() || undefined;
    const appleSilicon = platform === "darwin" && vendorId === 0x106b && /^Apple\b/.test(cpuModel || "");
    const name = match?.name
      || String(device.deviceString || "").trim()
      || (appleSilicon ? cpuModel : "")
      || gpuName({ vendorId, deviceId: device.deviceId, vendor });
    return { name, vendor, driver_version: String(device.driverVersion || match?.driver_version || "").trim() || undefined };
  });
}

function displayList(screen) {
  const primaryId = safe(() => screen.getPrimaryDisplay().id, undefined);
  return safe(() => screen.getAllDisplays(), []).map((display) => {
    const scale = Number(display?.scaleFactor) || 1;
    return {
      // Electron reports sizes in device-independent pixels.
      width: Math.round(Number(display?.size?.width) * scale),
      height: Math.round(Number(display?.size?.height) * scale),
      scale_factor: scale,
      primary: display?.id === primaryId,
    };
  });
}

function versionNumber(value) {
  return String(value || "").match(/\d+\.\d+\.\d+[0-9A-Za-z.+-]*/)?.[0] || "";
}

function createEnvironmentCollector({
  app,
  screen,
  platform = process.platform,
  arch = process.arch,
  env = process.env,
  osApi = os,
  execFileImpl = execFile,
  readFile = (file) => fsPromises.readFile(file, "utf8"),
  appVersion = "",
  installedRuntimes = async () => [],
  multiloginConnected = async () => undefined,
  groupTimeoutMs = GROUP_TIMEOUT_MS,
} = {}) {
  let appSetup = {};
  let nbcVersion = "";
  // The last good value of each group in this run, so a command that fails
  // once does not wipe what an earlier report sent.
  const lastGood = new Map();

  function windowsReport(groups) {
    const script = windowsScript({ keyboard: groups.includes("keyboard"), device: groups.includes("device") });
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    return runFile(execFileImpl, powershellPath(env), ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], POWERSHELL_TIMEOUT_MS)
      .then(parseJSON);
  }

  function locale() {
    const preferred = safe(() => app.getPreferredSystemLanguages(), []).map(languageTag).filter(Boolean);
    const timezone = safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, undefined);
    return {
      ui_language: preferred[0] || languageTag(safe(() => app.getLocale(), "")),
      preferred_languages: preferred,
      regional_format: languageTag(safe(() => app.getSystemLocale(), "")),
      timezone,
      utc_offset_minutes: -new Date().getTimezoneOffset(),
    };
  }

  async function keyboard(windows) {
    if (platform === "win32") return windowsKeyboard((await windows)?.keyboard);
    if (platform === "darwin") {
      const [enabled, selected] = await Promise.all([
        runFile(execFileImpl, "/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleEnabledInputSources"]),
        runFile(execFileImpl, "/usr/bin/defaults", ["read", "com.apple.HIToolbox", "AppleSelectedInputSources"]),
      ]);
      return macKeyboard(enabled, selected);
    }
    const gnome = parseGsettingsSources(await runFile(execFileImpl, "gsettings", ["get", "org.gnome.desktop.input-sources", "sources"]));
    if (gnome.length) {
      const recent = parseGsettingsSources(await runFile(execFileImpl, "gsettings", ["get", "org.gnome.desktop.input-sources", "mru-sources"]));
      const current = recent.find((source) => gnome.some((layout) => layout.id === source.id))?.id || gnome[0].id;
      return { layouts: gnome, current };
    }
    const xkb = parseSetxkbmap(await runFile(execFileImpl, "setxkbmap", ["-query"]));
    return xkb.length ? { layouts: xkb, current: xkb[0].id } : undefined;
  }

  async function operatingSystem(windows) {
    const release = safe(() => osApi.release(), "");
    if (platform === "win32") return windowsOs((await windows)?.os, release);
    if (platform === "darwin") {
      const fields = parseSwVers(await runFile(execFileImpl, "/usr/bin/sw_vers", []));
      const version = fields.ProductVersion || safe(() => process.getSystemVersion(), "");
      return {
        os_name: `${fields.ProductName || "macOS"}${version ? ` ${version}` : ""}`,
        os_version: version || undefined,
        os_build: fields.BuildVersion || undefined,
      };
    }
    const fields = parseOsRelease(await readFile("/etc/os-release").catch(() => ""));
    return {
      os_name: fields.PRETTY_NAME || fields.NAME || "Linux",
      os_version: fields.VERSION_ID || undefined,
      os_build: release || undefined,
    };
  }

  async function device(windows) {
    const cpus = safe(() => osApi.cpus(), []);
    const cpuModel = String(cpus[0]?.model || "").trim();
    const [system, info] = await Promise.all([
      operatingSystem(windows),
      withTimeout(safe(() => app.getGPUInfo("basic"), undefined), COMMAND_TIMEOUT_MS, undefined),
    ]);
    // An x64 build emulated on Arm reports the machine's architecture.
    const translated = safe(() => app.runningUnderARM64Translation === true, false);
    return {
      os: osFamily(platform),
      ...system,
      arch: translated ? "arm64" : arch,
      cpu_model: cpuModel || undefined,
      cpu_cores: safe(() => (typeof osApi.availableParallelism === "function" ? osApi.availableParallelism() : cpus.length), cpus.length) || undefined,
      ram_bytes: safe(() => osApi.totalmem(), undefined),
      gpus: gpuList({ info, windowsGpus: asArray((await windows)?.gpus), platform, cpuModel }),
      displays: screen ? displayList(screen) : undefined,
    };
  }

  async function appGroup() {
    const [runtimes, multilogin] = await Promise.all([
      withTimeout(installedRuntimes(), COMMAND_TIMEOUT_MS, undefined),
      withTimeout(multiloginConnected(), COMMAND_TIMEOUT_MS, undefined),
    ]);
    return {
      app_version: appVersion || undefined,
      nbc_version: nbcVersion || undefined,
      runtimes,
      agents: appSetup.agents,
      multilogin_connected: multilogin,
      workspaces_count: appSetup.workspaces_count,
      profiles_count: appSetup.profiles_count,
    };
  }

  /** Collects the given groups. Never rejects; a group that failed is {} or its last good value. */
  async function collect(groups) {
    const wanted = GROUPS.filter((key) => groups.includes(key));
    const windows = platform === "win32" && (wanted.includes("keyboard") || wanted.includes("device"))
      ? withTimeout(windowsReport(wanted), POWERSHELL_TIMEOUT_MS + 1_000, null)
      : Promise.resolve(null);
    const readers = {
      locale: () => locale(),
      keyboard: () => keyboard(windows),
      device: () => device(windows),
      app: () => appGroup(),
      network: () => ({}),
    };
    const result = {};
    await Promise.all(wanted.map(async (key) => {
      const value = await withTimeout(Promise.resolve().then(readers[key]), groupTimeoutMs, undefined);
      if (value && typeof value === "object") lastGood.set(key, value);
      result[key] = lastGood.get(key) || {};
    }));
    return result;
  }

  /** Agent types and counts the renderer reported; never names. */
  function setAppSetup(raw) {
    const count = (value) => (Number.isInteger(value) && value >= 0 ? value : undefined);
    appSetup = {
      agents: Array.isArray(raw?.agents) ? raw.agents.filter((id) => typeof id === "string").slice(0, 32) : undefined,
      workspaces_count: count(raw?.workspaces),
      profiles_count: count(raw?.profiles),
    };
  }

  function setNbcVersion(value) {
    const version = versionNumber(value);
    if (version) nbcVersion = version;
  }

  return { collect, setAppSetup, setNbcVersion };
}

module.exports = {
  createEnvironmentCollector,
  gpuList,
  languageTag,
  macKeyboard,
  parseDefaults,
  parseGsettingsSources,
  parseOsRelease,
  parseSetxkbmap,
  parseSwVers,
  powershellPath,
  runFile,
  runFileResult,
  windowsKeyboard,
  windowsOs,
  windowsScript,
  withTimeout,
};
