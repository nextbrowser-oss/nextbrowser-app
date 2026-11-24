import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// An isolated service fixture exercises real Electron media without contacting a user's account.
export async function checkMusicWidget(app,page) {
  await page.getByRole('button',{name:/^Settings(?:,|$)/}).click();
  const settings = page.getByRole('dialog',{name:'Settings',exact:true});
  await settings.getByRole('tab',{name:'Themes'}).click();
  await settings.getByRole('button',{name:'Configure panel widgets'}).click();
  const config = page.getByRole('dialog',{name:'Panel widgets'});
  await config.getByRole('button',{name:'Install Music Player'}).click();
  await config.getByLabel('Theme settings',{exact:true}).check();
  await config.getByLabel('Chat panel',{exact:true}).check();
  await config.getByLabel('Now playing Theme settings columns').selectOption('7');
  await config.getByRole('button',{name:'Close Panel widgets'}).click();
  const widget = settings.locator('webview[aria-label="Now playing"]');
  await widget.waitFor();
  async function evaluate(code) {
    return widget.evaluate((view,code) => view.executeJavaScript(code),code);
  }
  async function waitFor(check) {
    const end = Date.now()+10000;
    do {
      if (await check().catch(() => false)) return;
      await new Promise(r => setTimeout(r,125));
    } while (Date.now()<end);
    throw Error('Music widget did not become ready.');
  }
  await waitFor(() => evaluate("document.querySelector('#services')?.options.length > 0"));
  assert.deepEqual(await evaluate("fetch('/context').then(r=>r.json())"), {blockId:'now-playing',surface:'settings.design'});
  assert.equal(await widget.locator('..').evaluate(el => el.style.gridColumn), 'span 7');
  await evaluate("document.querySelector('#manage').click();document.querySelector('#label').value='Studio';document.querySelector('#services').value='spotify';document.querySelector('#form').requestSubmit()");
  const stringInput = await app.evaluate(() => Number(process.versions.chrome.split('.')[0]) < 155);
  async function tool(name,input={}) {
    const result = await evaluate('(async () => { const api = document.modelContext ?? navigator.modelContext; const registered = await api.getTools(); return api.executeTool(registered.find(t => t.name === ' + JSON.stringify(name) + '),' +
      JSON.stringify(stringInput ? JSON.stringify(input) : input) + '); })()');
    return JSON.parse(result);
  }
  await waitFor(() => evaluate("document.querySelector('#accounts')?.options.length === 1"));
  const list = await tool('list_accounts');
  assert.equal(list.value.accounts[0].label,'Studio');
  assert.equal((await tool('add_account',{service:'custom',label:'Invalid',url:'file:///local-player'})).ok,false);
  await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response:0}); });
  assert.equal((await tool('add_account',{service:'custom',label:'Other',url:'https://music.example.com'})).ok,false);
  const id = list.value.selected;
  const [record] = await page.evaluate(async () => (await window.nextbrowser.invoke('mini_apps_list',{owner:'preview'})).installed.filter(a => a.id === 'music-player'));
  const profileKey = accountId => 'persist:nextbrowser-music-' + createHash('sha256').update(JSON.stringify(['preview',record.generation,accountId])).digest('hex');
  const key = profileKey(id);
  await app.evaluate(({session},key) => {
    const isolated = session.fromPartition(key);
    const audio = Buffer.alloc(44 + 16000,128);
    audio.write('RIFF',0);audio.writeUInt32LE(audio.length-8,4);audio.write('WAVEfmt ',8);audio.writeUInt32LE(16,16);
    audio.writeUInt16LE(1,20);audio.writeUInt16LE(1,22);audio.writeUInt32LE(8000,24);audio.writeUInt32LE(8000,28);
    audio.writeUInt16LE(1,32);audio.writeUInt16LE(8,34);audio.write('data',36);audio.writeUInt32LE(audio.length-44,40);
    isolated.protocol.handle('https',() => new Response('<audio muted loop preload="auto" controls src="data:audio/wav;base64,'+audio.toString('base64')+'"></audio><script>navigator.mediaSession.metadata=new MediaMetadata({title:"Widget test track",artist:"Fixture artist"})</script>',{headers:{'Content-Type':'text/html'}}));
  },key);
  const opened = await tool('open_player',{id});
  assert.deepEqual(opened,{ok:true,value:{opened:true}});
  await waitFor(async () => (await tool('get_playback',{id})).value?.available);
  assert.equal((await tool('get_playback',{id})).value.title,'Widget test track');
  const play = await tool('play',{id}); assert.equal(play.value?.playing,true,JSON.stringify(play));
  assert.equal((await tool('pause',{id})).value.playing,false);
  const second = await tool('add_account',{service:'spotify',label:'Personal'});
  assert.notEqual(second.value.id,id);
  await app.evaluate(async ({session},key) => session.fromPartition(key).cookies.set({url:'https://open.spotify.com',name:'qa_session',value:'fixture'}),key);
  const cookieCount = key => app.evaluate(async ({session},key) => (await session.fromPartition(key).cookies.get({name:'qa_session'})).length,key);
  assert.equal(await cookieCount(key),1);
  assert.equal(await cookieCount(profileKey(second.value.id)),0);
  await tool('select_account',{id});
  assert.equal((await tool('list_accounts')).value.selected,id);
  assert.equal((await tool('forget_account',{id,confirm:false})).ok,false);
  assert.equal((await tool('forget_account',{id,confirm:true})).value.removed,id);
  assert.equal(await cookieCount(key),0);
  const remaining = await tool('list_accounts');
  assert.equal(remaining.value.selected,second.value.id);
  assert.equal(remaining.value.accounts.length,1);
  await settings.getByRole('button',{name:'Close settings'}).click();
  const chatURL = new URL(page.url());
  chatURL.searchParams.set('tab','chat');
  await page.goto(chatURL.href);
  const dock = page.locator('.chat-composer-dock .panel-widget webview');
  await dock.waitFor();
  await waitFor(() => dock.evaluate(view => view.executeJavaScript("document.querySelector('#accounts')?.selectedOptions[0]?.textContent === 'Personal'")));
  assert.equal((await dock.evaluate(view => view.executeJavaScript("fetch('/context').then(r=>r.json())"))).surface,'chat.panel');
  await mkdir('e2e-out',{recursive:true});
  await dock.locator('..').screenshot({path:'e2e-out/music-panel-widget.png'});
  console.log('Passed installing and placing Music Player, widget grid size, service profile isolation, native WebMCP and actual HTML audio play/pause.');
}
