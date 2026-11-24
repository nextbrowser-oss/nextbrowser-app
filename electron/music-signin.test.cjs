const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMusicPlayer } = require('./mini-apps/music-player.cjs');

test('Google sign-in and playback reopen the same isolated native profile', async () => {
  const record = {generation:'v1',revision:0,value:{}}, launches = [];
  const player = createMusicPlayer({
    store: {read:() => record,save:(_owner,_id,_gen,rev,value) => {
      assert.equal(rev,record.revision); record.value=value; record.revision++; return true;
    }},
    browserRoot: 'music-profiles',
    launchBrowser: async (dir,url) => { launches.push({dir,url}); return new EventEmitter(); },
  });
  const call = (input) => player.action({owner:'account/fixture',generation:'v1'},input,() => true);
  const youtube = await call({action:'add',service:'youtube',label:'Music',login:'google'});
  await call({action:'open',id:youtube.id,signIn:true});
  await call({action:'open',id:youtube.id});
  assert.equal(new URL(launches[0].url).hostname,'accounts.google.com');
  assert.equal(launches[1].url,'https://music.youtube.com');
  assert.equal(launches[0].dir,launches[1].dir);
  const spotify = await call({action:'add',service:'spotify',label:'Existing'});
  await call({action:'open',id:spotify.id,login:'google',signIn:true});
  assert.equal(new URL(launches[2].url).hostname,'accounts.spotify.com');
  assert.notEqual(launches[0].dir,launches[2].dir);
  assert.equal((await call({action:'list'})).accounts[1].login,'google');
  await assert.rejects(call({action:'add',service:'apple',label:'Other',login:'google'}),/does not offer/);
  await assert.rejects(call({action:'forget',id:spotify.id,confirm:true}),/Close the music browser/);
});
