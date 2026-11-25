// Exercise the desktop's normal Codex launch configuration with the installed
// Codex MCP client. A disposable account and local media replace live services.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import { _electron } from 'playwright-core';
import WebSocket from 'ws';
import { checkMiniAppAgent } from './test-mini-app-agent.mjs';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const profile = await mkdtemp(path.join(tmpdir(), 'nb-codex-music-'));
const env = { ...process.env, CODEX_HOME: path.join(profile, 'codex'), NEXTBROWSER_DEV_DATA_ROOT: profile,
  NEXTBROWSER_DEVICE_REPORTING: '0', NEXTBROWSER_ERROR_REPORTING: '0', NBC_AUTO_UPDATE: '0' };
delete env.ELECTRON_RUN_AS_NODE;
await mkdir(env.CODEX_HOME);
// Codex exec accepts --profile, its diagnostic app-server subcommand does not.
// Keep the app-injected MCP URL and bearer configuration for the native client.
const windows = process.platform === 'win32';
env.NB_QA_ADAPTER = path.join(profile, windows ? 'codex-qa.cmd' : 'codex-qa');
env.NB_QA_CLIENT = path.join(profile,'client.cjs');
env.NB_QA_NODE = process.execPath;
await writeFile(env.NB_QA_ADAPTER, windows ? '@echo off\r\n"%NB_QA_NODE%" "%NB_QA_CLIENT%" %*\r\n'
  : '#!/bin/sh\nexec "$NB_QA_NODE" "$NB_QA_CLIENT" "$@"\n', {mode:0o700});
await writeFile(env.NB_QA_CLIENT, `
  const args = process.argv.slice(2), server = args.indexOf('app-server');
  const config = args.filter(value => value.startsWith('mcp_servers.nextbrowser_desktop.'));
  if (server < 0 || config.length !== 2) throw Error('Missing desktop MCP launch configuration');
  const flags = config.flatMap(value => {
    const pos = value.indexOf('=');
    return ['-c',value.slice(0,pos+1) + JSON.stringify(value.slice(pos+1).replace(/^"|"$/g,''))];
  });
  const child = require('node:child_process').spawn(process.env.CODEX_BIN || 'codex',[...flags,...args.slice(server)],{stdio:'inherit'});
  child.once('exit',code=>process.exit(code ?? 1));
`);
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const url = 'ws://127.0.0.1:' + probe.address().port;
await new Promise(resolve => probe.close(resolve));
const token = randomUUID(), replyId = randomUUID();
let app, page, socket, turn;
try {
  app = await _electron.launch({ args: [root, '--user-data-dir=' + path.join(profile, 'app')], executablePath: createRequire(import.meta.url)('electron'), env, timeout:25000 });
  page = await app.firstWindow({timeout:20000});
  await page.goto(new URL('../dist/index.html?preview=main', import.meta.url).href);
  const invoke = (name, args) => page.evaluate(([name,args]) => window.nextbrowser.invoke(name,args),[name,args]);
  await page.getByRole('button', { name: 'Open Extensions', exact: true }).waitFor({state:'attached'});
  await page.evaluate(() => window.nextbrowser.updateSettings({values:{'nextbrowser.useHarness2':'1','nextbrowser.preferTabTools':'0'}}));
  await invoke('mini_apps_context',{owner:'preview',workspaceId:'preview-workspace'});
  const broken = { apiVersion:2, id:'missing-popover-action', name:'Incomplete widget', version:'1.0.0',
    description:'Widget conformance fixture', permissions:[], tools:['read'], skill:'Use read.',
    widgets:[{id:'tile',name:'Tile',surfaces:['chat.panel'],grid:{min:[1,1],preferred:[1,1],max:[1,1]}}],
    html:`<script>fetch('/context').then(r=>r.json()).then(c=>{if(c.view!=='popover') document.modelContext.registerTool({
      name:'read',description:'Read value',inputSchema:{type:'object',properties:{}},execute:()=>({ok:true,value:1})
    })})</script>` };
  await assert.rejects(invoke('mini_apps_install',{owner:'preview',raw:JSON.stringify(broken)}),/register every declared WebMCP tool/);
  await invoke('mini_apps_install',{id:'kanban',catalog:true,owner:'preview'});
  await checkMiniAppAgent(page);
  await invoke('mini_apps_install',{id:'music-player',catalog:true,owner:'preview'});
  await invoke('mini_apps_set_widget',{id:'music-player',owner:'preview',blockId:'now-playing',surface:'chat.panel',size:[1,1]});
  console.log('Installed both packages in the isolated Electron profile.');
  turn = invoke('agent_run',{replyId, agentId:'codex', binary:'codex', envVar:'NB_QA_ADAPTER', workspaceId:'preview-workspace',
    conversationId:'codex-qa', browserProfiles:[], stdinText:'Check my settings and pause Music Player.',
    args:['app-server','--listen',url,'--ws-auth','capability-token','--ws-token-sha256',createHash('sha256').update(token).digest('hex')]});
  const done = turn.then(result => { throw Error('Codex exited before MCP verification: ' + (result.stderr || result.reason || result.code)); });
  done.catch(()=>{});
  const deadline = Date.now() + 35000;
  while (!socket && Date.now() < deadline) {
    const candidate = new WebSocket(url, {headers:{Authorization:'Bearer '+token}});
    const ready = await Promise.race([done,new Promise(resolve => {
      candidate.once('open', () => resolve(true)); candidate.once('error', () => resolve(false));
    })]);
    if (ready) socket = candidate;
    else await delay(200);
  }
  assert(socket, 'Codex app-server did not accept the local test client');
  let seq = 0;
  function rpc(method, params) {
    const id = ++seq;
    return new Promise((resolve,reject) => {
      const timeout = setTimeout(() => {socket.off('message',listen); reject(Error('Timed out: '+method));}, 35000);
      function listen(data) {
        const msg = JSON.parse(data);
        if (msg.id !== id) return;
        clearTimeout(timeout); socket.off('message',listen);
        if (msg.error) reject(Error(method+': '+msg.error.message)); else resolve(msg.result);
      }
      socket.on('message',listen); socket.send(JSON.stringify({id,method,params}));
    });
  }
  await rpc('initialize',{clientInfo:{name:'nextbrowser_qa',version:'1'},capabilities:{experimentalApi:true}});
  socket.send(JSON.stringify({method:'initialized'}));
  const {thread} = await rpc('thread/start',{cwd:profile,ephemeral:true});
  const server = 'nextbrowser_desktop';
  const inventory = await rpc('mcpServerStatus/list',{threadId:thread.id,serverName:server});
  assert(inventory.data.some(item => item.name === server && item.tools.get_session_settings), 'Codex did not discover the desktop MCP');
  const call = async (tool,args={}) => {
    const result = await rpc('mcpServer/tool/call',{threadId:thread.id,server,tool,arguments:args});
    assert(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const config = await call('get_session_settings');
  assert.equal(config.agent,'codex');
  assert.equal(config.settingsAtLaunch.useHarness2,true);
  assert.deepEqual(config.effective,{harness2Recovery:true,harness2Mode:'mcp',preferWebsiteWebMCP:false,installedAppWebMCP:true});
  for (const evidence of ['', 'The user prefers an evening flight.']) {
    const review = await call('harness2_propose',{goal:'Choose a first search',evidence,first:'Search direct flights',second:'Compare flexible dates'});
    await assert.rejects(call('harness2_compose',{id:review.id,choice:2,conclusion:'Compare dates'}),/Probe both/);
    for (const option of [1,2]) {
      const probe = await call('harness2_probe',{id:review.id,option,assessment:option===1?'A direct search verifies availability for one day.':'Adjacent dates allow a comparison but need more queries.'});
      assert.equal(probe.evidence,evidence);
    }
    assert.equal((await call('harness2_compose',{id:review.id,choice:1,conclusion:'Start with direct flights.'})).strategy,'Search direct flights');
  }
  const {apps} = await call('list_apps');
  assert.deepEqual(apps.map(a=>a.id).sort(),['kanban','music-player']);
  assert.deepEqual(apps.find(a=>a.id==='music-player').widgets[0].enabled_on,['chat.panel']);
  const app_id = 'music-player';
  const {instance,tools} = await call('list_app_tools',{app_id});
  assert.equal(tools.length,8);
  const player = (tool,input={}) => call('call_app_tool',{app_id,instance,tool,input_json:JSON.stringify(input)});
  const {id} = await player('add_account',{service:'spotify',label:'QA'});
  await app.evaluate(({app}) => app.once('session-created',session => {
    const bytes = Buffer.alloc(44+8000,128);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16);
    bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(8000,24); bytes.writeUInt32LE(8000,28);
    bytes.writeUInt16LE(1,32); bytes.writeUInt16LE(8,34); bytes.write('data',36); bytes.writeUInt32LE(8000,40);
    session.protocol.handle('https', () => new Response('<audio controls muted loop preload="auto" src="data:audio/wav;base64,'+bytes.toString('base64')+'"></audio>',{headers:{'Content-Type':'text/html'}}));
  }) && undefined);
  await player('open_player',{id});
  assert.equal((await player('play',{id})).playing,true);
  assert.equal((await player('pause',{id})).playing,false);
  assert.equal((await player('get_playback',{id})).playing,false);
  assert.equal(await app.evaluate(({webContents}) => webContents.getAllWebContents().find(w=>w.getURL()==='https://open.spotify.com/').executeJavaScript('document.querySelector("audio").paused')),true);
  await invoke('mini_apps_context',{owner:'another-account',workspaceId:'preview-workspace'});
  await assert.rejects(call('list_apps'));
  console.log('Codex verified proactive and repeat Harness² comparisons, session settings, account isolation, widget discovery and actual audio play/pause through MCP.');
} finally {
  socket?.close();
  if (turn) { await page.evaluate(id=>window.nextbrowser.invoke('agent_terminate',{replyId:id}),replyId).catch(()=>{}); await turn.catch(()=>{}); }
  await app?.close();
  await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:250});
}
