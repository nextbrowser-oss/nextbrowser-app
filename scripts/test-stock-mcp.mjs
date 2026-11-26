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
// The local model requests real operations. Approval goes through the chat UI.
const root = process.cwd();
const data = await realpath(await mkdtemp(path.join(os.tmpdir(), 'nb-stock-smoke-')));
const folder = path.join(data, 'approved-folder');
await mkdir(folder);
let step = 0, error, shell, page, androidChecked = false;
let shellLine, deniedLine;
let autonomousStep = 0;
let autopilotStep = 0;
let autopilotShells = [];
const registryFixture = { instructions: '', serverInfo: { name: 'fixture', version: '1' },
  tools: [{ name: 'fixture_ping', description: 'Read a local test value.', inputSchema: { type: 'object', properties: {} } }] };
const service = http.createServer(async (req, res) => {
  if (req.url === '/fixture') return transport.serveLocalMcp(req, res, async () => 'pong', registryFixture);
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ data: [{ id: 'fixture' }] }));
  }
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
    } else if (autopilotStep) {
      switch (autopilotStep++) {
        case 1: message = call('get_permissions', {}); break;
        case 2:
          assert.equal(JSON.parse(last).preset, 'autopilot');
          autopilotShells = JSON.parse(last).shells;
          message = call('create_directory', { path: 'autopilot' }); break;
        case 3:
          assert.equal(JSON.parse(last).created, 'autopilot');
          message = call('write_text_file', { path: 'app.py', content: "print('autopilot-python-ok')" }); break;
        case 4:
          assert.ok(JSON.parse(last).sha256);
          message = call('run_command', { shell: autopilotShells[0], command: process.platform === 'win32' ? 'python app.py' : 'python3 app.py' }); break;
        default: {
          const result = JSON.parse(last);
          assert.equal(result.exitCode, 0, result.output);
          assert.equal(result.output.trim(), 'autopilot-python-ok');
          autopilotShells.shift();
          message = autopilotShells.length
            ? call('run_command', { shell: autopilotShells[0], command: process.platform === 'win32' ? 'python app.py' : 'python3 app.py' })
            : reply('Finished without prompts');
          break;
        }
      }
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
  await app.evaluate(({ dialog, Notification }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] });
    const show = Notification.prototype.show;
    Notification.prototype.show = function () {
      this.once('show', () => { globalThis.stockToastStatus = 'shown'; });
      this.once('failed', (_event, reason) => { globalThis.stockToastStatus = 'failed: ' + reason; });
      return show.call(this);
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
    workspaceId: 'preview-workspace', conversationId: 'preview-conv-2', browserProfiles: [], stdinText: 'Use the workspace tools.' }));
  await page.keyboard.press('Escape');
  const card = page.getByRole('region', {name: 'Agent permission request'});
  const firstTurn = turn();
  const review = page.getByRole('button', {name: 'Review agent request'});
  await review.waitFor();
  assert.equal(await card.count(), 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  if (process.platform === 'win32') {
    const status = await app.evaluate(async () => {
      const until = Date.now() + 3500;
      while (!globalThis.stockToastStatus && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      return globalThis.stockToastStatus || 'delivery not confirmed';
    });
    console.log('Windows notification: ' + status);
  }
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.restore(); win.show(); win.focus(); });
  await review.click();
  await card.getByText(/rejected\.txt/).waitFor();
  await card.getByText(folder, {exact: true}).waitFor();
  assert.equal(await card.locator('pre').textContent(), deniedLine);
  const cardBox = await card.boundingBox(), composerBox = await page.locator('.chat-composer-dock .composer').boundingBox();
  assert(cardBox && composerBox && cardBox.y + cardBox.height <= composerBox.y + 1);
  await card.getByRole('button', {name: 'Deny', exact: true}).click();
  await card.getByText(/visible\.txt/).waitFor();
  assert.equal(await card.locator('pre').textContent(), shellLine);
  await card.getByRole('button', {name: 'Allow once', exact: true}).click();
  const first = await firstTurn;
  if (error) throw error;
  assert.equal(first.stdout, 'Ready for review', first.stderr);
  await assert.rejects(stat(path.join(folder, 'rejected.txt')), { code: 'ENOENT' });
  assert.equal((await readFile(path.join(folder, 'visible.txt'), 'utf8')).trim(), 'approved');
  await card.waitFor({state:'detached'});
  assert.equal((await page.evaluate(() => window.nextbrowser.invoke('user_mcp_list', { workspaceId: 'preview-workspace' }))).length, 0);
  assert.equal(await modal.getByLabel('Server name').inputValue(), 'Fixture service');
  await modal.getByRole('button', { name: 'Connect & save' }).click();
  await modal.getByText('Fixture service', { exact: true }).waitFor();
  await modal.getByRole('button', { name: 'Permissions', exact: true }).click();
  await modal.getByRole('combobox', { name: 'Terminal permission' }).click();
  await modal.getByRole('option', { name: 'Off', exact: true }).click();
  await page.keyboard.press('Escape');
  const nextTurn = turn();
  if (process.env.NB_TEST_ANDROID === '1') await card.getByRole('button', {name:'Allow once'}).click();
  const next = await nextTurn;
  if (error) throw error;
  assert.equal(next.stdout, 'Connected', next.stderr);
  await page.goto(pathToFileURL(path.join(root, 'dist/index.html')).href + '?preview=main');
  await page.getByRole('button', { name: /^Settings(?:,|$)/ }).first().click();
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
  await settings.getByRole('tab', { name: /^Agent\b/ }).click();
  const preset = settings.getByRole('combobox', { name: 'Permission preset' });
  await preset.click();
  await settings.getByRole('option', { name: /^Autonomous\b/ }).click();
  await settings.getByRole('combobox', { name: 'Workspace edits permission' }).getByText('Allow in selected folder').waitFor();
  autonomousStep = 1;
  const autonomous = await turn();
  if (error) throw error;
  assert.equal(autonomous.stdout, 'Created demo/example.txt', autonomous.stderr);
  assert.equal(await readFile(path.join(folder, 'demo/example.txt'), 'utf8'), 'autonomous workspace');
  assert.equal(await card.count(), 0);
  console.log('Settings → Agent: autonomous mode created demo/example.txt through the agent without a dialog.');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Choose agent provider and model'}).click();
  await page.getByRole('button', {name: 'Use model', exact: true}).click();
  const selector = page.getByRole('combobox', {name: 'Agent permission mode'});
  await selector.getByText('Autonomous', {exact: true}).waitFor();
  const agent = await page.locator('.panel-widget[data-tile="Agent"]').boundingBox();
  const permissions = await selector.boundingBox();
  assert(agent && permissions && permissions.x >= agent.x + agent.width - 1 && Math.abs(agent.y - permissions.y) < 8, 'Permission selector follows the model on the same row');
  await selector.click();
  await page.getByRole('option', {name: /^Автопилот/}).click();
  await selector.getByText('Автопилот', {exact: true}).waitFor();
  autopilotStep = 1;
  const result = await turn();
  if (error) throw error;
  assert.equal(result.stdout, 'Finished without prompts', result.stderr);
  assert.ok((await stat(path.join(folder, 'autopilot'))).isDirectory());
  assert.equal(await card.count(), 0);
  await page.getByRole('button', { name: /^Settings(?:,|$)/ }).first().click();
  await settings.getByRole('tab', { name: /^Agent\b/ }).click();
  await preset.getByText('Автопилот', {exact: true}).waitFor();
  await preset.click();
  await settings.getByRole('option', {name: /^Default\b/}).click();
  await page.keyboard.press('Escape');
  await selector.getByText('Default', {exact: true}).waitFor();
  console.log('Composer → Автопилот: app.py ran in every available shell without prompts. Settings and composer stayed in sync.');
  console.log('Passed desktop permissions, denied and approved ' + shell + ', scoped reads, reviewed MCP setup and next-turn tools.' +
    (androidChecked ? ' Verified android_devices with real adb.' : ''));
} finally { await app?.close(); service.closeAllConnections(); await new Promise(resolve => service.close(resolve)); }
