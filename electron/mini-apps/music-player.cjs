const { createHash, randomUUID } = require('node:crypto');
const { isIP } = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const { openBrowser } = require('../personal-browser.cjs');

const googleSignIn = {
  spotify: 'https://accounts.spotify.com/en/login?continue=https%3A%2F%2Fopen.spotify.com%2F',
  youtube: 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fmusic.youtube.com%2F',
};

const services = {
  spotify: ['Spotify', 'https://open.spotify.com', 'spotify.com'],
  apple: ['Apple Music', 'https://music.apple.com', 'apple.com'],
  youtube: ['YouTube Music', 'https://music.youtube.com', 'youtube.com'],
  soundcloud: ['SoundCloud', 'https://soundcloud.com', 'soundcloud.com'],
  tidal: ['TIDAL', 'https://listen.tidal.com', 'tidal.com'],
  deezer: ['Deezer', 'https://www.deezer.com', 'deezer.com'],
  yandex: ['Yandex Music', 'https://music.yandex.ru', 'yandex.ru', 'yandex.com'],
  custom: ['Other music service'],
};
function customService(raw) {
  let url;
  try { url = new URL(raw); } catch { /* Show a field-specific error below. */ }
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      url.href.length > 400 || isIP(url.hostname) || !/^(?:[a-z\d-]+\.)+[a-z]{2,63}$/i.test(url.hostname) ||
      /\.(?:localhost|local|internal|test|invalid)$/i.test(url.hostname)) throw Error('Enter the public HTTPS address of your music service without login details or query parameters.');
  return [url.hostname, url.href, url.hostname];
}
function serviceFor(account) { return account.service === 'custom' ? customService(account.url) : services[account.service]; }
const authHosts = ['accounts.google.com', 'appleid.apple.com', 'account.apple.com', 'idmsa.apple.com', 'www.facebook.com', 'login.live.com'];
function validLocation(raw, service, allowSignIn) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ((allowSignIn && authHosts.includes(url.hostname)) || service.slice(2).some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)));
  } catch { return false; }
}

// These three fixed operations only read media metadata or control the active HTML player.
async function mediaState(action) {
  const players = Array.from(document.querySelectorAll('audio,video'));
  const media = players.find(item => !item.paused && !item.ended) ?? players.find(item => item.currentSrc);
  if (action !== 'status' && !media) throw Error('Start a track in the service player first.');
  if (action === 'play') await media.play();
  if (action === 'pause') media.pause();
  return { available: !!media, playing: !!media && !media.paused && !media.ended,
    title: (navigator.mediaSession?.metadata?.title ?? '').slice(0,180),
    artist: (navigator.mediaSession?.metadata?.artist ?? '').slice(0,180) };
}

function createMusicPlayer({ session, BrowserWindow, dialog, guestSessions, store, browserRoot, launchBrowser = openBrowser }) {
  const windows = new Map();
  const nativeWindows = new Map();
  const pending = new Map();
  function serialize(owner, run) {
    const next = (pending.get(owner) ?? Promise.resolve()).catch(() => {}).then(run);
    pending.set(owner, next);
    return next.finally(() => { if (pending.get(owner) === next) pending.delete(owner); });
  }
  const appId = 'music-player';
  const partition = (owner, generation, id) => 'persist:nextbrowser-music-' + createHash('sha256').update(JSON.stringify([owner,generation,id])).digest('hex');
  const browserDirectory = key => path.join(browserRoot, key.slice(key.lastIndexOf('-') + 1));
  async function forget(key, account) {
    if (account.login === 'google') {
      const dir = browserDirectory(key);
      if (nativeWindows.has(key)) throw Error('Close the music browser before removing this login.');
      // A surviving Unix browser owns the profile even after Nextbrowser restarts.
      const lock = await fs.readlink(path.join(dir,'SingletonLock')).catch(() => '');
      const pid = Number(lock.match(/-(\d+)$/)?.[1]);
      if (pid) {
        let running = true;
        try { process.kill(pid,0); } catch (error) { running = error.code !== 'ESRCH'; }
        if (running) throw Error('Close the music browser before removing this login.');
      }
      const retired = dir + '-remove-' + randomUUID();
      try {
        await fs.rename(dir,retired);
      } catch (error) {
        if (error.code !== 'ENOENT') throw Error('Close the music browser before removing this login.');
      }
      await fs.rm(retired,{recursive:true,force:true});
    }
    const win = windows.get(key)?.win;
    if (win && !win.isDestroyed()) win.destroy();
    const profile = session.fromPartition(key);
    await profile.clearStorageData();
    await profile.clearCache();
    await profile.clearAuthCache();
  }
  function protect(win, service) {
    win.setMenuBarVisibility(false);
    win.webContents.setWindowOpenHandler(({url}) => (url === 'about:blank' || validLocation(url, service, true))
      ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, parent: win, webPreferences: { session: win.webContents.session,
        sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } } }
      : { action: 'deny' });
    win.webContents.on('did-create-window', child => protect(child, service));
    for (const event of ['will-navigate','will-redirect']) win.webContents.on(event, (e, url) => {
      if (e.isMainFrame !== false && !validLocation(e.url ?? url, service, true)) e.preventDefault();
    });
  }
  async function open(binding, account, signIn) {
    const key = partition(binding.owner, binding.generation, account.id);
    if (account.login === 'google') {
      const url = signIn ? googleSignIn[account.service] : serviceFor(account)[1];
      const child = await launchBrowser(browserDirectory(key),url);
      const children = nativeWindows.get(key) ?? new Set();
      nativeWindows.set(key,children);
      children.add(child);
      child.once('exit', () => { children.delete(child); if (!children.size) nativeWindows.delete(key); });
      return;
    }
    const existing = windows.get(key)?.win;
    if (existing && !existing.isDestroyed()) { existing.show(); existing.focus(); return; }
    const service = serviceFor(account);
    const profile = session.fromPartition(key);
    guestSessions.add(profile);
    profile.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    profile.setPermissionCheckHandler(() => false);
    const win = new BrowserWindow({ title: service[0], width: 1060, height: 720, autoHideMenuBar: true,
      webPreferences: { session: profile, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    protect(win, service);
    windows.set(key, { shellId: binding.shellId, win });
    win.once('closed', () => windows.delete(key));
    return win.loadURL(signIn && account.service === 'spotify' ? googleSignIn.spotify : service[1]);
  }
  async function action(binding, input, active) {
    if (!active()) throw Error('The active account changed.');
    const record = store.read(binding.owner, appId);
    if (record.generation !== binding.generation) throw Error('Music Player was reinstalled.');
    const accounts = (record.value?.accounts ?? []).filter(a => a && Object.hasOwn(services,a.service) && typeof a.id === 'string');
    const selected = record.value?.selected ?? null;
    const write = (accounts, selected) => {
      if (!active()) throw Error('The active account changed.');
      if (!store.save(binding.owner, appId, binding.generation, record.revision, { accounts, selected })) throw Error('Accounts changed. Refresh and try again.');
    };
    if (input.action === 'list') return { accounts, selected, services: Object.entries(services).map(([id,[name]]) => ({ id,name })) };
    if (input.action === 'add') {
      if (!Object.hasOwn(services,input.service) || typeof input.label !== 'string' || !input.label.trim() || input.label.length > 60 || accounts.length >= 16) throw Error('Choose a service and an account name (up to 16 accounts).');
      const account = { id: randomUUID(), service: input.service, label: input.label.trim() };
      if (input.login === 'google') {
        if (!Object.hasOwn(googleSignIn,input.service)) throw Error('This service does not offer Google sign-in here.');
        account.login = 'google';
      }
      if (input.service === 'custom') {
        const [,address] = customService(input.url);
        const parent = BrowserWindow.getAllWindows().find(w => w.webContents.id === binding.shellId);
        if (!parent) throw Error('Open Music Player in Nextbrowser to add a service.');
        const result = await dialog.showMessageBox(parent, {type:'question',buttons:['Cancel','Add service'],defaultId:0,cancelId:0,
          message:'Add this music service?',detail:address + '\nNextbrowser will open this site in a separate login profile.'});
        if (result.response !== 1) throw Error('Service was not added.');
        account.url = address;
      }
      write([...accounts, account], account.id);
      return account;
    }
    const account = accounts.find(a => a.id === (input.id ?? selected));
    if (!account) throw Error('Choose a music account.');
    const key = partition(binding.owner, binding.generation, account.id);
    if (input.action === 'select') { write(accounts, account.id); return account; }
    if (input.action === 'open') {
      if (input.login === 'google' && account.login !== 'google') {
        if (!Object.hasOwn(googleSignIn,account.service)) throw Error('Google sign-in is unavailable for this service.');
        const updated = {...account,login:'google'};
        await open(binding,updated,true);
        write(accounts.map(item => item.id === account.id ? updated : item),selected);
        const embedded = windows.get(key)?.win;
        if (embedded && !embedded.isDestroyed()) embedded.close();
      } else await open(binding,account,input.signIn === true);
      return { opened: true };
    }
    if (input.action === 'forget') {
      if (input.confirm !== true) throw Error('Confirm removal of the account on this device.');
      await forget(key,account);
      const rest = accounts.filter(a => a.id !== account.id);
      write(rest, selected === account.id ? rest[0]?.id ?? null : selected);
      return { removed: account.id };
    }
    if (!['status','play','pause'].includes(input.action)) throw Error('Unknown playback action.');
    const win = windows.get(key)?.win;
    if (!win || win.isDestroyed() || !validLocation(win.webContents.getURL(), serviceFor(account), false)) {
      if (input.action === 'status') return { available: false, playing: false };
      throw Error('Open the service and start a track first.');
    }
    return win.webContents.executeJavaScriptInIsolatedWorld(177, [{ code: '(' + mediaState.toString() + ')(' + JSON.stringify(input.action) + ')' }]);
  }
  function closeForShell(shellId) {
    for (const {win, shellId: ownerShell} of windows.values()) if (ownerShell === shellId && !win.isDestroyed()) win.destroy();
  }
  async function clear(owner) {
    const record = store.read(owner,appId);
    for (const account of record.value?.accounts ?? []) await forget(partition(owner, record.generation, account.id),account);
  }
  return {
    action(binding, input, active) {
      if (!input || typeof input.action !== 'string') throw Error('Expected a music action.');
      const run = () => action(binding, input, active);
      return ['list','status'].includes(input.action) ? run() : serialize(binding.owner, run);
    },
    closeForShell, clear: owner => serialize(owner, () => clear(owner)),
  };
}
module.exports = { createMusicPlayer };
