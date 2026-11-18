const { createScrubber } = require('./client-error-scrub.cjs');

const AUTH = new Set(['valid', 'invalid', 'unreachable', 'not_configured', 'not_checked', 'config_error', 'upgrade_required', 'unavailable']);
const CONFIG = new Set(['ready', 'missing', 'invalid', 'unreadable', 'unresolved']);
const code = (v) => /^[A-Z][A-Z0-9_]{2,63}$/.test(String(v || '')) ? v : undefined;
const ref = (v) => /^NB-[0-9A-F]{8}(?:-[0-9A-F]{4})?$/.test(String(v || '')) ? v : undefined;
const text = (v, max = 300) => typeof v === 'string' ? v.slice(0, max) : '';
const version = (v) => /^[a-zA-Z0-9 ._()+/-]{1,100}$/.test(text(v)) ? v : '';

// Copy a small allowlist, never arbitrary CLI output, error bodies, messages,
// stacks, environment variables or config contents. Supports older CLIs too.
function buildSupportDiagnostics({ appVersion, platform, arch, osVersion, cliPath, cliResult, runtimes = [], errors = [], homeDir, now = Date.now }) {
  let envelope;
  try { envelope = JSON.parse(cliResult?.stdout || '{}'); } catch {}
  const source = envelope?.ok === true && envelope?.data?.diagnostics?.schema_version === 1 ? envelope.data.diagnostics : null;
  const recent = [...(Array.isArray(source?.recent_errors) ? source.recent_errors : []), ...errors].slice(-30).map((item) => ({
    code: code(item?.code), ref: ref(item?.ref),
  })).filter((item) => item.code || item.ref);
  const report = {
    schema_version: 1,
    collected_at: new Date(now()).toISOString(),
    app: { version: version(appVersion), platform: text(platform, 30), arch: text(arch, 20), os_version: text(osVersion, 150) },
    cli: { path: text(cliPath, 1000), version: version(source?.cli?.version), status: source ? 'available' : cliPath ? 'upgrade_required' : 'not_installed' },
    config: { path: text(source?.config?.path, 1000), source: text(source?.config?.source, 60), status: CONFIG.has(source?.config?.status) ? source.config.status : 'unresolved', key_configured: source?.config?.key_configured === true },
    authorization: { status: AUTH.has(source?.auth?.status) ? source.auth.status : cliPath ? 'upgrade_required' : 'unavailable', ...(Number.isInteger(source?.auth?.http_status) && source.auth.http_status >= 100 && source.auth.http_status <= 599 ? { http_status: source.auth.http_status } : {}) },
    runtimes: (Array.isArray(runtimes) ? runtimes : []).filter((item) => ['clawbrowser', 'camoufox', 'dasbrowser', 'multilogin'].includes(item?.name)).map((item) => ({ name: item.name, version: version(item.version) })),
    recent_errors: recent.slice(-10),
  };
  const scrub = createScrubber({ homeDir, platform });
  // Scrub string values before JSON serialization. Scrubbing the serialized
  // object would treat metadata keys such as "authorization" as secret headers
  // and corrupt the JSON structure instead of preserving the status object.
  const clean = (value) => typeof value === 'string' ? scrub(value) : Array.isArray(value) ? value.map(clean)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)])) : value;
  return { text: `Nextbrowser diagnostics\n${JSON.stringify(clean(report), null, 2)}`, cliStatus: report.cli.status };
}

module.exports = { buildSupportDiagnostics };
