const test = require('node:test');
const assert = require('node:assert/strict');
const {Readable} = require('node:stream');
const desktop = require('./mini-apps/mcp.cjs');

async function request(method, params, capabilities) {
  const req = Readable.from([Buffer.from(JSON.stringify({jsonrpc:'2.0', id:1, method, params}))]);
  Object.assign(req, {method:'POST', headers:{'content-type':'application/json'}});
  let result;
  await desktop.serve(req, {writeHead:()=>{}, end:body=>{result=JSON.parse(body).result;}}, ()=>'called', capabilities);
  return result;
}
test('disabled comparison tools cannot be discovered or invoked; a comparison-only session has no app actions', async () => {
  const list = async caps => (await request('tools/list',{},caps)).tools.map(t=>t.name);
  const enabled = {apps:false, comparisons:true}, disabled = {apps:true, comparisons:false};
  assert.deepEqual(await list(enabled),['get_session_settings','harness2_propose','harness2_probe','harness2_compose']);
  assert(!(await list(disabled)).includes('harness2_propose'));
  assert.equal((await request('tools/call',{name:'harness2_propose'},disabled)).isError,true);
  assert.equal((await request('tools/call',{name:'call_app_tool'},enabled)).isError,true);
});
test('native, MCP and inline chat modes respect the saved switch and current scope', () => {
  for (const [agent, expected] of [['nextbrowser','native'],['codex','mcp'],['claude','mcp'],['hermes','inline']]) {
    const settings = desktop.sessionSettings(agent,{'nextbrowser.useHarness2':'1'},false,true);
    assert.equal(settings.effective.harness2Mode,expected);
    const disabled = desktop.sessionSettings(agent,{'nextbrowser.useHarness2':'0'},false,true);
    assert.equal(disabled.effective.harness2Mode,'off');
    assert.equal(disabled.effective.harness2Recovery,false);
  }
  assert.equal(desktop.sessionSettings('codex',{'nextbrowser.useHarness2':'1'},false,false).effective.harness2Mode,'inline');
  const [,json] = desktop.claudeArgs('http://127.0.0.1:4567');
  assert.deepEqual(JSON.parse(json).mcpServers.nextbrowser_desktop, {
    type:'http',url:'http://127.0.0.1:4567/mini-apps/mcp',headers:{Authorization:'Bearer ${NEXTBROWSER_CONTROL_TOKEN}'},
  });
});
