const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupportDiagnostics } = require('./support-diagnostics.cjs');

test('diagnostics copy only allowlisted metadata and redact paths and secrets', () => {
  const result = buildSupportDiagnostics({ appVersion: '0.2.74', platform: 'win32', arch: 'x64', osVersion: 'Windows 11', homeDir: 'C:\\Users\\test', cliPath: 'C:\\Users\\test\\nextctl.exe',
    cliResult: { stdout: JSON.stringify({ ok: true, data: { diagnostics: { schema_version: 1, cli: { version: '1.2.41', api_key: 'hidden-key' }, config: { path: 'C:\\Users\\test\\runtime\\config.json', source: 'NEXTBROWSER_CONFIG_DIR', status: 'ready', key_configured: true, api_key: 'hidden-key' }, auth: { status: 'valid', http_status: 200, body: 'hidden-body' }, recent_errors: [{ code: 'API_KEY_INVALID', ref: 'NB-1234ABCD', message: 'private chat' }] }, install_log: { tail: ['password=secret'] } } }) },
    runtimes: [{ name: 'clawbrowser', version: '151.0.0.0', password: 'proxy-pass' }], errors: [{ code: 'LAUNCH_FAILED', ref: 'NB-AABBCCDD-1234', stack: 'private page' }], now: () => 0,
  });
  assert.equal(result.cliStatus, 'available');
  const report = JSON.parse(result.text.split('\n').slice(1).join('\n'));
  assert.deepEqual(report.authorization, { status: 'valid', http_status: 200 });
  for (const secret of ['hidden-key', 'hidden-body', 'private chat', 'private page', 'proxy-pass', 'password=secret', 'C:\\Users\\test']) assert.ok(!result.text.includes(secret));
  assert.match(result.text, /NEXTBROWSER_CONFIG_DIR/);
  assert.match(result.text, /NB-AABBCCDD-1234/);
  assert.match(result.text, /"status": "valid"/);
});

test('old, absent, malformed and failed CLIs produce usable partial reports', () => {
  for (const cliResult of [undefined, { stdout: 'unexpected secret stderr' }, { stdout: '{"ok":false,"error":{"message":"private backend body"}}' }, { stdout: '{"ok":true,"data":{"install_log":{"tail":["private"]}}}' }]) {
    const result = buildSupportDiagnostics({ appVersion: '0.2.74', cliPath: '/bin/nbc', cliResult });
    assert.equal(result.cliStatus, cliResult?.stdout?.includes('"ok":true') ? 'upgrade_required' : 'unavailable');
    assert.ok(!result.text.includes('private'));
    assert.ok(!result.text.includes('unexpected secret'));
  }
  assert.equal(buildSupportDiagnostics({}).cliStatus, 'not_installed');
});
