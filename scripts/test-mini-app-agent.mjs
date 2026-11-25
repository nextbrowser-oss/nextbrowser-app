import http from 'node:http';
import assert from 'node:assert/strict';

// A local model fixture drives real Electron agent turns and the real MCP
// endpoint. Read the resulting board from the user-visible sandboxed guest.
export async function checkMiniAppAgent(page) {
  let step = -1, instance, id, revision, failure, foreign = false;
  const server = http.createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { messages, tools } = JSON.parse(body);
      const last = messages.at(-1).content;
      const reply = content => ({ role: 'assistant', content });
      function ask(name, args) {
        const found = tools.find(t => t.function.description.startsWith('[Installed mini apps] ' + name + ':'));
        assert(found, name);
        return { role: 'assistant', tool_calls: [{ id: 'call_' + step, type: 'function', function: { name: found.function.name, arguments: JSON.stringify(args) } }] };
      }
      const run = (tool, input) => ask('call_app_tool', { app_id: 'kanban', instance, tool, input_json: JSON.stringify(input) });
      let msg;
      if (!tools && messages[0].content.includes('short practical plan')) {
        msg = reply('Read the workspace tools and verify the board.');
      } else if (foreign) {
        assert(!tools.some(t => t.function.description.startsWith('[Installed mini apps]')));
        msg = reply('Other workspace isolated');
      } else switch (step++) {
        case -1:
          assert.match(messages.map(m => m.content).join(' '), /Installed WebMCP app IDs at launch: \["kanban"\]/);
          msg = ask('get_session_settings', {}); break;
        case 0: {
          const config = JSON.parse(last);
          assert.equal(config.agent, 'nextbrowser');
          assert.equal(config.effective.harness2Recovery, true);
          assert.equal(config.effective.preferWebsiteWebMCP, false);
          assert.equal(config.effective.installedAppWebMCP, true);
          msg = ask('list_apps', {}); break;
        }
        case 1:
          assert.deepEqual(JSON.parse(last).apps.map(app => app.id), ['kanban']);
          msg = ask('list_app_tools', { app_id: 'kanban' }); break;
        case 2: {
          const menu = JSON.parse(last);
          assert.equal(menu.tools.length, 6);
          instance = menu.instance;
          msg = run('create_task', { title: 'Agent QA', notes: 'Created via WebMCP' }); break;
        }
        case 3:
          id = JSON.parse(last).card.id;
          assert(id);
          msg = run('get_task', { id }); break;
        case 4:
          assert.equal(JSON.parse(last).card.notes, 'Created via WebMCP');
          msg = run('edit_task', { id, title: 'Updated by agent', notes: 'Edited via WebMCP' }); break;
        case 5:
          assert.equal(JSON.parse(last).card.title, 'Updated by agent');
          msg = run('move_task', { id, stage: 'Done' }); break;
        case 6:
          assert.equal(JSON.parse(last).card.stage, 'Done');
          assert.equal(await page.locator('webview.mini-apps-guest').evaluate(view => view.executeJavaScript("document.querySelectorAll('.lane')[2].querySelector('article strong').textContent")), 'Updated by agent');
          msg = run('list_tasks', { stage: 'Done' }); break;
        case 7:
          revision = JSON.parse(last).revision;
          assert.equal(JSON.parse(last).tasks[0].id, id);
          msg = run('delete_task', { id, revision, confirm: false }); break;
        case 8:
          assert.match(last, /error|confirm/i);
          await page.getByRole('button', { name: 'Back to Mini Apps' }).click();
          await page.locator('webview.mini-apps-guest').waitFor({ state: 'detached' });
          msg = run('delete_task', { id, revision, confirm: true }); break;
        case 9:
          assert.match(last, /discover/i);
          msg = ask('list_app_tools', { app_id: 'kanban' }); break;
        case 10:
          assert.notEqual(JSON.parse(last).instance, instance);
          instance = JSON.parse(last).instance;
          msg = run('delete_task', { id, revision, confirm: true }); break;
        case 11:
          assert.equal(JSON.parse(last).deleted, id);
          msg = reply('Board verified'); break;
        default: throw Error('Unexpected model turn');
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }] }));
    } catch (error) { failure = error; res.writeHead(400); res.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.evaluate(url => window.nextbrowser.updateSettings({ values: {
      'nextbrowser.useHarness2': '1', 'nextbrowser.preferTabTools': '0',
      'nextbrowser.builtinAgent': JSON.stringify({ provider: 'custom', model: 'fixture', baseURL: url }),
    } }), 'http://127.0.0.1:' + server.address().port + '/v1');
    const turn = workspaceId => page.evaluate(workspaceId => window.nextbrowser.invoke('agent_run', {
      agentId: 'nextbrowser', replyId: crypto.randomUUID(), workspaceId, conversationId: 'qa', browserProfiles: [], stdinText: 'Exercise the Kanban board.',
    }), workspaceId);
    const result = await turn('preview-workspace');
    if (failure) throw failure;
    assert.equal(result.stdout, 'Board verified', result.stderr);
    foreign = true;
    const other = await turn('other-workspace');
    if (failure) throw failure;
    assert.equal(other.stdout, 'Other workspace isolated', other.stderr);
    console.log('Passed agent discovery, all six WebMCP actions, visible updates, stale instance and workspace isolation.');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
