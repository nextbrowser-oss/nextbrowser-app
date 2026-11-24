import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// An isolated service fixture exercises real Electron media without contacting a user's account.
export async function checkMusicWidget(app,page,downloadPath) {
  await page.getByRole('button',{name:'Widgets',exact:true}).click();
  assert.equal(await page.getByRole('heading',{name:'Kanban',exact:true}).count(),0);
  const musicCard = page.locator('article').filter({has:page.getByRole('heading',{name:'Music Player',exact:true})});
  await app.evaluate(({dialog},filePath) => { dialog.showSaveDialog = async () => ({canceled:false,filePath}); },downloadPath);
  await musicCard.getByRole('button',{name:'Download package'}).click();
  await waitFor(async () => JSON.parse(await readFile(downloadPath,'utf8')).widgets[0].id === 'now-playing');
  await musicCard.getByRole('button',{name:'Install',exact:true}).click();
  await page.getByRole('button',{name:'Install mini app',exact:true}).click();
  await page.getByRole('heading',{name:'Music Player',exact:true}).waitFor();
  const chatURL = new URL(page.url());
  chatURL.searchParams.set('tab','chat');
  await page.goto(chatURL.href);
  const composer = page.locator('.chat-composer-dock .composer').last();
  await composer.getByRole('button',{name:'Customize composer appearance'}).click();
  const config = page.getByRole('dialog',{name:'Composer appearance'});
  await config.getByRole('button',{name:'Add Now playing'}).click();
  await config.getByRole('button',{name:'Remove Now playing'}).waitFor();
  await config.getByRole('button',{name:'Close Composer appearance'}).click();
  const tile = composer.locator('[data-tile="Now playing"]');
  const thumb = tile.locator('webview');
  await thumb.waitFor();
  await waitFor(() => thumb.evaluate(v => v.executeJavaScript("document.body.dataset.view === 'tile'")));
  const noOverflow = () => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight;
  assert.equal(await thumb.evaluate((v,f) => v.executeJavaScript('('+f+')()'),noOverflow.toString()),true);
  const artwork = await thumb.evaluate(v => v.executeJavaScript(`(() => {
    const box = document.querySelector('.art svg').getBoundingClientRect();
    return { width:innerWidth, height:innerHeight, x:box.x, y:box.y, w:box.width, h:box.height };
  })()`));
  assert.ok(artwork.w >= 12 && artwork.h >= 12 && artwork.x >= -1 && artwork.y >= -1 &&
    artwork.x + artwork.w <= artwork.width + 1 && artwork.y + artwork.h <= artwork.height + 1,JSON.stringify(artwork));
  const edit = composer.getByRole('button',{name:'Edit widget grid'});
  async function geometry() {
    return composer.evaluate(el => [el, el.querySelector('textarea'), ...el.querySelectorAll('[data-tile], .composer-grid-trigger, .composer-skin-trigger')].map(node => {
      const {x,y,width,height} = node.getBoundingClientRect(); return [x,y,width,height];
    }));
  }
  const buttonTiles = composer.locator('.is-control');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const compact = await buttonTiles.evaluateAll(nodes => nodes.map(node => {
    const tile = node.getBoundingClientRect(), button = node.querySelector('.shared-icon-button').getBoundingClientRect();
    const control = node.querySelector('.shared-icon-button'), style = getComputedStyle(control);
    return {name:node.dataset.tile,left:tile.left,right:tile.right,w:tile.width,h:tile.height,bw:button.width,bh:button.height,buttonLeft:button.left,cssWidth:style.width,transform:style.transform,zoom:style.zoom,first:node.querySelector('button')?.getAttribute('aria-label')};
  }));
  compact.forEach((box,i) => {
    assert.ok(Math.abs(box.w-box.bw) <= 1 && Math.abs(box.h-box.bh) <= 1, JSON.stringify(box));
    if (i) assert.ok(Math.abs(box.left-compact[i-1].right-4) <= 1,JSON.stringify(compact));
  });
  const resting = await geometry();
  await edit.click();
  assert.deepEqual(await geometry(),resting,'Entering layout editing moved the composer or its contents');
  await composer.getByRole('button',{name:'Finish editing grid'}).click();
  assert.deepEqual(await geometry(),resting,'Leaving layout editing moved the composer or its contents');
  await edit.click();
  async function dragCell(handle, dx, dy) {
    const box = await handle.boundingBox(); assert.ok(box);
    const moving = (await handle.getAttribute('aria-label')).startsWith('Move ');
    const x = box.x + (moving ? 7 : box.width/2), y = box.y + (moving ? 7 : box.height/2);
    assert.ok(await handle.evaluate((el,[x,y]) => el.contains(document.elementFromPoint(x,y)),[x,y]), 'Drag handle must receive pointer input');
    await page.mouse.move(x,y);
    await page.mouse.down(); await page.mouse.move(x+dx,y+dy,{steps:8}); await page.mouse.up();
  }
  const pitch = 38;
  const before = await tile.boundingBox();
  await dragCell(tile.getByRole('button',{name:'Resize Now playing'}),pitch,38);
  await waitFor(async () => (await tile.boundingBox()).width >= before.width + pitch - 2);
  await waitFor(() => thumb.evaluate((v,initial) => v.executeJavaScript("document.querySelector('.art svg').getBoundingClientRect().height > " + (initial + 8)),artwork.h));
  await dragCell(tile.getByRole('button',{name:'Move Now playing'}),-pitch,38);
  await waitFor(() => tile.evaluate(el => el.style.top === '38px'));
  const position = await tile.evaluate(el=>[el.style.left,el.style.top]);
  const scripts = composer.locator('[data-tile="Scripts"]');
  const attach = composer.locator('[data-tile="Attach"]');
  const attachBefore = await attach.boundingBox();
  for (const name of ['Attach','Scripts','Agent']) await composer.getByRole('button',{name:'Resize '+name,exact:true}).waitFor();
  await dragCell(attach.getByRole('button',{name:'Resize Attach'}),24,38);
  await waitFor(async () => (await attach.boundingBox()).width >= attachBefore.width+23);
  const resized = await attach.boundingBox(), inner = await attach.locator('.shared-icon-button').boundingBox();
  assert.equal(inner.width,resized.width); assert.equal(inner.height,resized.height);
  assert.ok(inner.height >= attachBefore.height+37);
  const previousScripts = await scripts.evaluate(el=>el.style.top);
  await scripts.getByRole('button',{name:'Move Scripts'}).press('ArrowDown');
  assert.notEqual(await scripts.evaluate(el=>el.style.top),previousScripts);
  await composer.getByRole('button',{name:'Finish editing grid'}).click();
  await page.reload();
  await tile.waitFor();
  assert.deepEqual(await tile.evaluate(el=>[el.style.left,el.style.top]),position);
  assert.equal((await attach.boundingBox()).width,resized.width);
  await tile.getByRole('button',{name:'Open Now playing'}).click();
  const popup = page.getByRole('dialog',{name:'Now playing',exact:true});
  const widget = popup.locator('webview');
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
  assert.deepEqual(await evaluate("fetch('/context').then(r=>r.json())"), {blockId:'now-playing',surface:'chat.panel',view:'popover'});
  assert.equal(await evaluate('('+noOverflow.toString()+')()'),true);
  await waitFor(() => widget.evaluate(v => v.clientHeight < 170));
  await evaluate("document.querySelector('#choose').click()");
  await waitFor(() => evaluate("!document.querySelector('#form').hidden && document.querySelector('#form .primary').getBoundingClientRect().bottom <= innerHeight"));
  assert.equal(await evaluate("getComputedStyle(document.querySelector('#services')).appearance"),'base-select');
  assert.equal(await evaluate("document.querySelectorAll('#services option svg use').length"),8);
  async function clickGuest(selector) {
    const frame = await widget.boundingBox();
    const [x,y] = await evaluate(`(() => {const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]})()`);
    await page.mouse.click(frame.x+x,frame.y+y);
  }
  await clickGuest('#services');
  await waitFor(() => evaluate("document.querySelector('#services').matches(':open')"));
  const pickerGeometry = () => evaluate(`(() => {const s=document.querySelector('#services'),last=s.options[s.options.length-1],style=getComputedStyle(s,'::picker(select)');
    return {height:innerHeight, box:last.getBoundingClientRect().toJSON(), top:s.getBoundingClientRect().bottom, main:document.querySelector('main').offsetHeight, display:style.display, columns:style.gridTemplateColumns};})()`);
  try { await waitFor(async () => {const g=await pickerGeometry(); return g.box.height > 0 && g.box.bottom <= g.height + 1;}); }
  catch { throw Error('Music service list is clipped: '+JSON.stringify(await pickerGeometry())); }
  await clickGuest('#services option[value="apple"]');
  await waitFor(() => evaluate("!document.querySelector('#services').matches(':open')"));
  assert.equal(await evaluate("document.querySelector('#services selectedcontent use').getAttribute('href')"),'#icon-apple');
  await evaluate("document.querySelector('#label').value='Studio';document.querySelector('#services').value='spotify';document.querySelector('#form').requestSubmit()");
  assert.equal(await evaluate('('+noOverflow.toString()+')()'),true);
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
  await popup.getByRole('button',{name:'Close Now playing'}).click();
  await popup.waitFor({state:'detached'});
  await waitFor(() => thumb.evaluate(view => view.executeJavaScript("document.querySelector('#accounts')?.selectedOptions[0]?.textContent === 'Personal'")));
  assert.equal((await thumb.evaluate(view => view.executeJavaScript("fetch('/context').then(r=>r.json())"))).surface,'chat.panel');
  await mkdir('e2e-out',{recursive:true});
  const frame = await app.browserWindow(page);
  async function capture(locator, file) {
    const bounds = await locator.boundingBox();
    const clip = Object.fromEntries(Object.entries(bounds).map(([k,v]) => [k,Math.round(v)]));
    const png = await frame.evaluate(async (win, clip) => (await win.capturePage(clip)).toPNG().toString('base64'),clip);
    await writeFile('e2e-out/' + file,Buffer.from(png,'base64'));
  }
  await edit.click();
  await capture(composer,'music-widget-grid.png');
  await composer.getByRole('button',{name:'Finish editing grid'}).click();
  await tile.getByRole('button',{name:'Open Now playing'}).click();
  await waitFor(() => evaluate("document.querySelector('#choose')?.textContent === 'Personal'"));
  await capture(popup, 'music-widget-popover.png');
  console.log('Passed downloading, moving and resizing widgets. Passed installing and placing Music Player, widget grid size, service profile isolation, native WebMCP and actual HTML audio play/pause.');
}
