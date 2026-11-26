import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, stat } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright-core';
import transport from '../electron/local-mcp-transport.cjs';

// Real agent loop and MCP transports, isolated desktop profile and local model.
// Only the model's choices and the native dialog responses are scripted.
const root = process.cwd();
const data = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nb-stock-smoke-')));
const folder = path.join(data, 'approved-folder');
await mkdir(folder);
let step = 0, error, shell, page, androidChecked = false;
let shellLine, deniedLine;
let autonomousStep = 0;
const registryFixture = { instructions: '', serverInfo: { name: 'fixture', version: '1' },
  tools: [{ name: 'fixture_ping', description: 'Read a local test value.', inputSchema: { type: 'object', properties: {} } }] };
const service = http.createServer(async (req, res) => {
  if (req.url === '/fixture') return transport.serveLocalMcp(req, res, async () => 'pong', registryFixture);
  try {
    let body = ''; for await (const chunk of req) body += chunk;
    const { messages, tools } = JSON.parse(body);
    const last = messages.at(-1).content;
    const call = (tool, args, server = 'Workspace tools') => {
      const fn = tools.find(t => t.function.description.startsWith('[' + server + '] ' + tool + ':'));
      assert(fn, tool);
      return { role: 'assistant', tool_calls: [{ id: 'call_' + step, type: 'function', function: { name: fn.function.name, arguments: JSON.stringify(args) } }] };
    };
    const reply = content => ({ role: 'assistant', content });
    let message;
    if (!tools && messages[0]?.content.startsWith('Respond to the latest user message')) {
      message = reply('Check workspace tools');
    } else if (autonomousStep) {
      switch (autonomousStep++) {
        case 1: message = call('get_permissions', {}); break;
        case 2:
          assert.equal(JSON.parse(last).edits, 'allow');
          message = call('create_directory', { path: 'demo' }); break;
        case 3:
          assert.equal(JSON.parse(last).created, 'demo');
          message = call('write_text_file', { path: 'demo/example.txt', content: 'autonomous workspace' }); break;
        case 4:
          assert.ok(JSON.parse(last).sha256);
          message = reply('Created demo/example.txt'); break;
        default: throw Error('Unexpected autonomous turn.');
      }
    } else switch (step++) {
      case 0: message = call('get_permissions', {}); break;
      case 1: {
        const prefs = JSON.parse(last);
        assert.equal(prefs.folder, folder); assert.equal(prefs.files, 'allow');
        shell = prefs.defaultShell;
        assert(prefs.shells.includes(shell));
        if (prefs.shells.includes('bash')) assert.equal(shell, 'bash');
        deniedLine = shell === 'bash' ? 'printf denied > rejected.txt' : 'Set-Content rejected.txt denied';
        shellLine = shell === 'bash' ? 'printf approved > visible.txt' : 'Set-Content -Encoding ascii visible.txt approved';
        message = call('run_command', { shell, command: deniedLine }); break;
      }
      case 2: assert.match(last, /denied/i); message = call('run_command', { command: shellLine }); break;
      case 3: assert.equal(JSON.parse(last).exitCode, 0); message = call('list_directory', { path: '.' }); break;
      case 4: assert.deepEqual(JSON.parse(last).entries.map(e => e.name), ['visible.txt']); message = call('read_text_file', { path: 'visible.txt' }); break;
      case 5:
        assert.equal(JSON.parse(last).text.trim(), 'approved');
        message = call('propose_mcp_server', { name: 'Fixture service', config_json: JSON.stringify({ url: 'http://127.0.0.1:' + service.address().port + '/fixture' }) }); break;
      case 6: assert.equal(JSON.parse(last).status, 'awaiting_user_review'); message = reply('Ready for review'); break;
      case 7:
        assert(!tools.some(t => t.function.description.startsWith('[Workspace tools] run_command:')));
        message = call('fixture_ping', {}, 'Fixture service'); break;
      case 8: assert.match(last, /pong/); message = process.env.NB_TEST_ANDROID === '1' ? call('android_devices', {}) : reply('Connected'); break;
      case 9: {
        const result = JSON.parse(last);
        assert.equal(result.exitCode, 0);
        assert.match(result.output, /List of devices attached/);
        androidChecked = true;
        message = reply('Connected'); break;
      }
      default: throw Error('Unexpected model turn.');
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }] }));
  } catch (e) { error = e; res.writeHead(400); res.end('{}'); }
});
await new Promise(resolve => service.listen(0, '127.0.0.1', resolve));
const env = { ...process.env, NEXTBROWSER_DEV_DATA_ROOT: data, NBC_AUTO_UPDATE: '0', NEXTBROWSER_ERROR_REPORTING: '0', NEXTBROWSER_DEVICE_REPORTING: '0' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [root, '--user-data-dir=' + path.join(data, 'app')], env });
  page = await app.firstWindow();
  await app.evaluate(({ dialog }, target) => {
    globalThis.stockFixturePrompts = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    dialog.showMessageBox = async (_window, options) => {
      if (options.title !== 'Nextbrowser agent permission') return { response: 0 };
      globalThis.stockFixturePrompts.push(options.detail);
      return { response: globalThis.stockFixturePrompts.length === 1 ? 0 : 1 };
    };
  }, folder);
  const url = pathToFileURL(path.join(root, 'dist/index.html')).href + '?preview=main&tab=mcp';
  await page.goto(url);
  const modal = page.getByRole('dialog', { name: 'MCP', exact: true });
  await modal.getByRole('button', { name: 'Permissions', exact: true }).click();
  await modal.getByRole('combobox', { name: 'Default shell', exact: true }).waitFor();
  await modal.getByRole('combobox', { name: 'Android permission', exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Choose folder' }).click();
  await modal.getByText(folder, { exact: true }).waitFor();
  await modal.getByRole('combobox', { name: 'Workspace files permission' }).click();
  await modal.getByRole('option', { name: 'Allow in selected folder' }).click();
  await page.evaluate(url => window.nextbrowser.updateSettings({ values: {
    'nextbrowser.builtinAgent': JSON.stringify({ provider: 'custom', model: 'fixture', baseURL: url }),
  } }), 'http://127.0.0.1:' + service.address().port + '/v1');
  const turn = () => page.evaluate(() => window.nextbrowser.invoke('agent_run', { agentId: 'nextbrowser', replyId: crypto.randomUUID(),
    workspaceId: 'preview-workspace', conversationId: 'stock-qa', browserProfiles: [], stdinText: 'Use the workspace tools.' }));
  const first = await turn();
  if (error) throw error;
  assert.equal(first.stdout, 'Ready for review', first.stderr);
  await assert.rejects(stat(path.join(folder, 'rejected.txt')), { code: 'ENOENT' });
  assert.equal((await readFile(path.join(folder, 'visible.txt'), 'utf8')).trim(), 'approved');
  const prompts = await app.evaluate(() => globalThis.stockFixturePrompts);
  assert.equal(prompts.length, 2);
  assert(prompts[0].includes(folder) && prompts[0].endsWith(deniedLine) && prompts[1].endsWith(shellLine));
  assert.equal((await page.evaluate(() => window.nextbrowser.invoke('user_mcp_list', { workspaceId: 'preview-workspace' }))).length, 0);
  assert.equal(await modal.getByLabel('Server name').inputValue(), 'Fixture service');
  await modal.getByRole('button', { name: 'Connect & save' }).click();
  await modal.getByText('Fixture service', { exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Permissions', exact: true }).click();
  await modal.getByRole('combobox', { name: 'Terminal permission' }).click();
  await modal.getByRole('option', { name: 'Off', exact: true }).click();
  const next = await turn();
  if (error) throw error;
  assert.equal(next.stdout, 'Connected', next.stderr);
  await page.goto(pathToFileURL(path.join(root, 'dist/index.html')).href + '?preview=main');
  await page.getByRole('button', { name: /^Settings(?:,|$)/ }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: /^Agent\b/ }).click();
  const preset = settings.getByRole('combobox', { name: 'Permission preset' });
  await preset.click();
  await settings.getByRole('option', { name: 'Autonomous', exact: true }).click();
  await settings.getByRole('combobox', { name: 'Workspace edits permission' }).getByText('Allow in selected folder').waitFor();
  const before = await app.evaluate(() => globalThis.stockFixturePrompts.length);
  autonomousStep = 1;
  const autonomous = await turn();
  if (error) throw error;
  assert.equal(autonomous.stdout, 'Created demo/example.txt', autonomous.stderr);
  assert.equal(await readFile(path.join(folder, 'demo/example.txt'), 'utf8'), 'autonomous workspace');
  assert.equal(await app.evaluate(() => globalThis.stockFixturePrompts.length), before);
  console.log('Settings → Agent: autonomous mode created demo/example.txt through the agent without a dialog.');
  console.log('Passed desktop permissions, denied and approved ' + shell + ', scoped reads, reviewed MCP setup and next-turn tools.' +
    (androidChecked ? ' Verified android_devices with real adb.' : ''));
} finally { await app?.close(); service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
