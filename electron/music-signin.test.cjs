const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMusicPlayer, openMusicBrowser } = require('./mini-apps/music-player.cjs');

test('Google sign-in and playback reopen the same isolated native profile', async () => {
  const record = {generation:'v1',revision:0,value:{}}, launches = [], visits = [];
  const player = createMusicPlayer({
    store: {read:() => record,save:(_owner,_id,_gen,rev,value) => {
      assert.equal(rev,record.revision); record.value=value; record.revision++; return true;
    }},
    browserRoot: 'music-profiles',
    launchBrowser: async dir => {
      const context = new EventEmitter(), pages = [];
      context.pages = () => pages;
      context.newPage = async () => {
        let url = 'about:blank';
        const page = { url: () => url, goto: async target => { url = target; visits.push(url); }, bringToFront: async () => {} };
        pages.push(page);
        return page;
      };
      launches.push(dir);
      return context;
    },
  });
  const call = (input) => player.action({owner:'account/fixture',generation:'v1'},input,() => true);
  const youtube = await call({action:'add',service:'youtube',label:'Music',login:'google'});
  await call({action:'open',id:youtube.id,signIn:true});
  await call({action:'open',id:youtube.id});
  assert.equal(new URL(visits[0]).hostname,'accounts.google.com');
  assert.equal(visits[1],'https://music.youtube.com');
  assert.equal(launches.length,1);
  const spotify = await call({action:'add',service:'spotify',label:'Existing'});
  await call({action:'open',id:spotify.id,login:'google',signIn:true});
  assert.equal(new URL(visits[2]).hostname,'accounts.spotify.com');
  assert.notEqual(launches[0],launches[1]);
  assert.equal((await call({action:'list'})).accounts[1].login,'google');
  await assert.rejects(call({action:'add',service:'apple',label:'Other',login:'google'}),/does not offer/);
  await assert.rejects(call({action:'forget',id:spotify.id,confirm:true}),/Close the music browser/);
});

test('the selected Google music profile plays and pauses actual media without touching a sign-in tab', { skip: !process.env.NB_TEST_NATIVE_MUSIC }, async t => {
  const fs = require('node:fs/promises');
  const root = await fs.mkdtemp(require('node:path').join(require('node:os').tmpdir(), 'nb-music-'));
  const record = { generation: 'test', revision: 0, value: {} };
  let context;
  t.after(async () => {
    await context?.close();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
  });
  const player = createMusicPlayer({
    store: { read: () => record, save: (_owner, _id, _gen, _rev, value) => { record.value = value; record.revision++; return true; } },
    browserRoot: root,
    launchBrowser: async dir => {
      context = await openMusicBrowser(dir);
      const wav = Buffer.alloc(44 + 8000, 128);
      wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
      wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
      wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(8000, 40);
      await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body:
        '<audio muted controls loop preload="auto" src="data:audio/wav;base64,' + wav.toString('base64') + '"></audio>' }));
      return context;
    },
  });
  const call = input => player.action({ owner:'qa', generation:'test', shellId:1 }, input, () => true);
  await call({ action: 'add', service: 'youtube', login: 'google', label: 'QA' });
  await call({ action: 'open', signIn: true });
  assert.deepEqual(await call({ action: 'status' }), { available: false, playing: false });
  await call({ action: 'open' });
  const page = context.pages().find(p => p.url().startsWith('https://music.youtube.com/'));
  await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 2);
  assert.equal((await call({ action: 'play' })).playing, true);
  assert.equal(await page.locator('audio').evaluate(media => media.paused), false);
  assert.equal((await call({ action: 'pause' })).playing, false);
  assert.equal(await page.locator('audio').evaluate(media => media.paused), true);
});
