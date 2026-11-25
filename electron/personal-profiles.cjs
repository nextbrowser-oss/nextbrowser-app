const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { openBrowser, findBrowser, importPage } = require('./personal-browser.cjs');
const { writeArchive, readArchive } = require('./personal-archive.cjs');
const firefox = require('./personal-firefox.cjs');
const { findSources, inspectSource, hasPortableData, otherBrowsers, categories, files } = require('./personal-sources.cjs');

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const changed = 'The source profile is being updated. Close that browser and try the import again.';

async function statFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile()) throw Error('A selected browser file is not a regular file.');
    return stat;
  } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

// Read the current URL of each surviving tab. Chromium's session file may also
// contain page state and form data, which must stay in the original profile.
function tabUrls(bytes) {
  if (bytes.length < 8 || bytes.toString('ascii',0,4) !== 'SNSS' || ![1,3].includes(bytes.readInt32LE(4))) return [];
  const tabs = new Map(), closed = new Set();
  const tab = id => { if (!tabs.has(id)) tabs.set(id, { pages: new Map(), index: 0 }); return tabs.get(id); };
  for (let offset = 8; offset + 3 <= bytes.length;) {
    const size = bytes.readUInt16LE(offset);
    if (!size || offset + 2 + size > bytes.length) break;
    const cmd = bytes[offset + 2], data = bytes.subarray(offset + 3, offset + 2 + size);
    offset += 2 + size;
    if (data.length >= 8 && cmd === 0) tab(data.readInt32LE(4)).window = data.readInt32LE(0);
    if (data.length >= 8 && cmd === 2) tab(data.readInt32LE(0)).index = data.readInt32LE(4);
    if (data.length >= 8 && cmd === 7) tab(data.readInt32LE(0)).selected = data.readInt32LE(4);
    if (data.length >= 4 && cmd === 16) tabs.delete(data.readInt32LE(0));
    if (data.length >= 4 && cmd === 17) closed.add(data.readInt32LE(0));
    if (data.length >= 8 && (cmd === 5 || cmd === 11 || (cmd === 24 && data.length >= 12))) {
      const item = tab(data.readInt32LE(0)), index = data.readInt32LE(4);
      const start = cmd === 11 ? 0 : index;
      const count = cmd === 5 ? Infinity : cmd === 11 ? index : data.readInt32LE(8);
      if (start >= 0 && count > 0) {
        const newIndex = n => n < start ? n : n >= start + count ? n - count : Math.max(0,start - 1);
        item.pages = new Map([...item.pages].filter(([n]) => n < start || n >= start + count)
          .map(([n,address]) => [newIndex(n),address]));
        if (item.selected !== undefined) item.selected = newIndex(item.selected);
        if (item.last !== undefined) item.last = newIndex(item.last);
      }
    }
    if (cmd !== 6 || data.length < 16) continue;
    const length = data.readInt32LE(12);
    if (length < 0 || length > data.length - 16) continue;
    const item = tab(data.readInt32LE(4)), index = data.readInt32LE(8);
    let address;
    try {
      const url = new URL(data.toString('utf8',16,16 + length));
      if (['http:','https:'].includes(url.protocol) && !url.username && !url.password) address = url.href;
    } catch { /* Internal tabs are skipped. */ }
    item.pages.set(index,address);
    item.last = index;
  }
  return [...tabs.values()].filter(t => !closed.has(t.window)).sort((a,b) => (a.window ?? 0) - (b.window ?? 0) || a.index - b.index)
    .map(t => t.pages.get(t.selected ?? t.last)).filter(Boolean);
}

async function readTabs(source) {
  const dir = path.join(source,'Sessions');
  let files = [];
  try {
    if (!(await fs.lstat(dir)).isDirectory()) throw Error('Invalid browser sessions directory.');
    files = (await fs.readdir(dir)).filter(name => /^Session_\d+$/.test(name)).sort((a,b) => b.length - a.length || b.localeCompare(a)).map(name => path.join(dir,name));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!files.length) files = ['Current Session','Last Session'].map(name => path.join(source,name));
  for (const file of files) {
    const stat = await statFile(file);
    if (!stat || stat.size < 8) continue;
    if (stat.size > 256 * 1024 * 1024) throw Error('Session file is too large to import.');
    const bytes = await fs.readFile(file);
    const after = await statFile(file);
    if (!after || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error(changed);
    if (bytes.toString('ascii',0,4) === 'SNSS') return tabUrls(bytes);
  }
  return [];
}

// Seed a new Chromium session with only the visible URLs. Startup-page prefs
// are protected on some browsers and would reopen old pages on every launch.
async function writeTabSession(dest, urls) {
  const parts = [Buffer.from('SNSS\x03\0\0\0','binary')];
  function ints(...values) {
    const bytes = Buffer.alloc(values.length * 4);
    values.forEach((n,i) => bytes.writeInt32LE(n,i * 4));
    return bytes;
  }
  function command(id, data) {
    const header = Buffer.alloc(3);
    header.writeUInt16LE(data.length + 1);
    header[2] = id;
    parts.push(header,data);
  }
  const windowId = 1;
  command(9,ints(windowId,0)); // Normal browser window.
  urls.forEach((url,i) => {
    const id = i + 2, address = Buffer.from(url), aligned = Math.ceil(address.length / 4) * 4;
    // A navigation pickle holds tab ID, history index, URL, title, page state and transition.
    const data = Buffer.alloc(16 + aligned + 12);
    data.writeUInt32LE(data.length - 4); data.writeInt32LE(id,4);
    data.writeInt32LE(address.length,12); address.copy(data,16);
    command(0,ints(windowId,id)); command(2,ints(id,i));
    command(6,data); command(7,ints(id,0));
  });
  command(8,ints(windowId,0)); command(255,Buffer.alloc(0));
  const sessions = path.join(dest,'Sessions');
  await fs.mkdir(sessions);
  const timestamp = (BigInt(Date.now()) + 11644473600000n) * 1000n;
  await fs.writeFile(path.join(sessions,'Session_' + timestamp),Buffer.concat(parts));
  await fs.writeFile(path.join(dest,'Preferences'),JSON.stringify({session:{restore_on_startup:1}}));
}

async function copyDatabase(source, dest, name) {
  const file = path.join(source,name);
  const before = await statFile(file);
  if (!before) return false;
  const busy = async () => (await Promise.all(['-wal','-journal'].map(s => statFile(file + s)))).some(stat => stat?.size);
  if (await busy()) throw Error(changed);
  const handle = await fs.open(file,'r');
  try {
    const header = Buffer.alloc(16);
    await handle.read(header,0,16,0);
    if (header.toString('ascii') !== 'SQLite format 3\0') throw Error('Invalid browser database: ' + name);
  } finally { await handle.close(); }
  await fs.copyFile(file, path.join(dest,name));
  const after = await statFile(file);
  if (!after || before.size !== after.size || before.mtimeMs !== after.mtimeMs || await busy()) throw Error(changed);
  return true;
}

async function snapshot(source, dest, selected) {
  if (!Array.isArray(selected) || !selected.length || selected.some(s => !categories.includes(s))) throw Error('Choose at least one supported data type.');
  if (!(await fs.lstat(source)).isDirectory()) throw Error('Select the original browser profile folder.');
  await fs.mkdir(dest, { recursive: true, mode: 0o700 });
  const imported = [];
  for (const kind of new Set(selected)) {
    if (kind === 'bookmarks') {
      const file = path.join(source,'Bookmarks');
      if (!await statFile(file)) continue;
      const raw = await fs.readFile(file,'utf8');
      if (!JSON.parse(raw).roots) throw Error('Invalid Chromium bookmarks.');
      await fs.writeFile(path.join(dest,'Bookmarks'), raw);
    } else if (kind === 'tabs') {
      const urls = await readTabs(source);
      if (!urls.length) continue;
      await writeTabSession(dest,urls);
    } else if (!await copyDatabase(source,dest,files[kind])) continue;
    imported.push(kind);
  }
  if (!imported.length) throw Error('No supported data found. Select a browser profile with the chosen data.');
  return imported;
}

function keyDirectory(root) {
  return path.join(path.dirname(root),'.recovery-keys',path.basename(root));
}
async function makeBackup(root, destination, profile, snapshotDir) {
  const archive = randomUUID() + '.nbarchive';
  const key = await writeArchive(path.join(destination,archive),keyDirectory(root),profile,snapshotDir);
  return {archive,key};
}
function describe(root, profile) {
  const backup = profile.backup;
  if (!backup) return profile;
  const validFile = (name,ext) => typeof name === 'string' && name.endsWith(ext) && uuid.test(name.slice(0,-ext.length));
  if (!validFile(backup.archive,'.nbarchive') || !validFile(backup.key,'.nbkey') || !uuid.test(profile.id)) {
    throw Error('Invalid local recovery file reference.');
  }
  return {...profile, backup: {archivePath:path.join(root,profile.id,backup.archive), keyPath:path.join(keyDirectory(root),backup.key)}};
}
async function importProfile(root, source, name, selected, active = () => true, origin) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 80) throw Error('Choose a profile name (up to 80 characters).');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(root,'.import-'));
  try {
    const id = randomUUID(), dest = path.join(stage,'browser','Default');
    const imported = origin?.browser === 'Firefox' ? await firefox.snapshot(source,dest,selected,writeTabSession) : await snapshot(source,dest,selected);
    const profile = {id,name:name.trim(),kind:'personal',imported};
    if (origin) {
      const after = await inspectSource(source,origin.browser);
      const versions = {};
      for (const kind of imported) {
        const version = origin.items[kind]?.version;
        if (!version || after.items[kind]?.version !== version || after.items[kind].busy) throw Error(changed);
        versions[kind] = version;
      }
      profile.source = {id:origin.id,browser:origin.browser,versions};
    }
    if (!active()) throw Error('The active account changed.');
    profile.backup = await makeBackup(root,stage,profile,dest);
    await fs.writeFile(path.join(stage,'profile.json'),JSON.stringify(profile));
    if (!active()) throw Error('The active account changed.');
    await fs.rename(stage,path.join(root,id));
    return describe(root,profile);
  } catch (error) { await fs.rm(stage,{recursive:true,force:true}); throw error; }
}

function ownerRoot(base, owner) { return path.join(base,createHash('sha256').update(owner).digest('hex')); }
async function saveMetadata(dir, profile) {
  const temp = path.join(dir,'.meta-' + randomUUID());
  try {
    await fs.writeFile(temp,JSON.stringify(profile),{flag:'wx',mode:0o600});
    await fs.rename(temp,path.join(dir,'profile.json'));
  } finally { await fs.rm(temp,{force:true}); }
}

const ongoingBackups = new Map();
const wizardWindows = new Map();
function watchWizard(child,root,id,current,scope,autoBackup) {
  const dir = path.join(root,id);
  wizardWindows.set(dir,child);
  child.once('exit', async code => {
    if (wizardWindows.get(dir) !== child) return;
    wizardWindows.delete(dir);
    if (!autoBackup || code !== 0 || !current()) return;
    try {
      await backupExisting(root,id,current);
      if (current()) scope.window.webContents.send('personal-profiles:changed',id);
    } catch { /* Keep the pending marker so the user can retry. */ }
  });
}
async function backupExisting(root,id,current) {
  const dir = path.join(root,id);
  if (wizardWindows.has(dir)) throw Error('Close the profile browser, then finish the backup.');
  if (ongoingBackups.has(dir)) return ongoingBackups.get(dir);
  const job = (async () => {
    const profile = JSON.parse(await fs.readFile(path.join(dir,'profile.json'),'utf8'));
    if (profile.backup && !profile.pendingBackup) return describe(root,profile);
    const stage = await fs.mkdtemp(path.join(root,'.backup-'));
    try {
      const imported = await snapshot(path.join(dir,'browser','Default'),path.join(stage,'snapshot'),categories);
      if (!current()) throw Error('The active account changed.');
      const updated = {...profile,imported,pendingBackup:false};
      updated.backup = await makeBackup(root,stage,updated,path.join(stage,'snapshot'));
      if (!current()) throw Error('The active account changed.');
      const archive = path.join(dir,updated.backup.archive);
      await fs.rename(path.join(stage,updated.backup.archive),archive);
      try { await saveMetadata(dir,updated); }
      catch (error) { await fs.rm(archive,{force:true}); throw error; }
      return describe(root,updated);
    } finally { await fs.rm(stage,{recursive:true,force:true}); }
  })();
  ongoingBackups.set(dir,job);
  try { return await job; }
  finally { ongoingBackups.delete(dir); }
}

async function restoreProfile(root,archive,key,current) {
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const stage = await fs.mkdtemp(path.join(root,'.restore-'));
  try {
    const {name,selected} = await readArchive(archive,key,stage);
    if (!current()) throw Error('The active account changed.');
    return await importProfile(root,stage,name,selected,current);
  } finally { await fs.rm(stage,{recursive:true,force:true}); }
}

async function localProfiles(root) {
  let entries;
  try { entries = await fs.readdir(root, {withFileTypes:true}); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return Promise.all(entries.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(async entry => {
    const profile = JSON.parse(await fs.readFile(path.join(root,entry.name,'profile.json'),'utf8'));
    if (profile.id !== entry.name) throw Error('Invalid local profile reference.');
    return describe(root,profile);
  }));
}

const sourceCatalogues = new WeakMap();
const importingSources = new Set();

// Receipts contain an opaque source ID and file revisions. For profiles predating
// receipts, report a match only when the actual portable content is identical.
async function sourceStatus(root,source,profiles,digests = new Map()) {
  async function digest(file) {
    if (!digests.has(file)) digests.set(file,(async () => {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      return hash.digest('hex');
    })());
    return digests.get(file);
  }
  const items = {};
  for (const [kind,item] of Object.entries(source.items)) {
    const prior = profiles.filter(p => p.source?.id === source.id && p.source.versions?.[kind]);
    let imported = !item.busy && !!item.version && prior.some(p => p.source.versions[kind] === item.version);
    if (source.browser === 'Firefox') {
      items[kind] = {imported,busy:item.busy,unreadable:item.unreadable,updated:!imported && prior.length > 0};
      continue;
    }
    let sourceTabs;
    if (!item.busy && !imported) {
      try {
        if (kind === 'tabs') {
          sourceTabs = await readTabs(source.dir);
          if (!sourceTabs.length) continue;
        } else if (!await hasPortableData(source.dir,kind)) continue;
      } catch (error) {
        const busy = error.code === 'EBUSY' || error.message === changed || [5,6].includes(error.errcode);
        items[kind] = {busy,unreadable:!busy,imported:false};
        continue;
      }
    }
    for (const legacy of profiles) {
      if (imported || item.busy) break;
      if (legacy.source || !legacy.imported?.includes(kind)) continue;
      const local = path.join(root,legacy.id,'browser','Default');
      try {
        if (kind === 'tabs') {
          const b = await readTabs(local);
          imported = sourceTabs.length === b.length && sourceTabs.every((url,i) => url === b[i]);
        } else {
          const a = path.join(source.dir,files[kind]), b = path.join(local,files[kind]);
          const [sa,sb] = await Promise.all([statFile(a),statFile(b)]);
          if (sa && sa.size === sb?.size) imported = await digest(a) === await digest(b);
        }
      } catch { /* An unavailable legacy copy cannot establish a match. */ }
    }
    items[kind] = {imported,busy:item.busy,updated:!imported && prior.length > 0};
  }
  const previouslyImported = profiles.some(p => p.source?.id === source.id) || Object.values(items).some(item => item.imported);
  return {id:source.id,browser:source.browser,name:source.name,items,previouslyImported};
}

async function personalCommand({base, scope, current, dialog, shell, command, args}) {
  if (!scope?.owner.startsWith('account/') || !current()) throw Error('Sign in to import personal profiles.');
  const root = ownerRoot(base,scope.owner);
  if (command.startsWith('personal_profiles_agent_')) {
    return require('./agent-library.cjs').agentCommand({root,keyDirectory:keyDirectory(root),scope,current,dialog,args,action:command.slice('personal_profiles_agent_'.length)});
  }
  if (command === 'personal_profiles_list') {
    const profiles = await localProfiles(root);
    return current() ? profiles : [];
  }
  if (command === 'personal_profiles_scan' || command === 'personal_profiles_choose_source') {
    let catalogue = sourceCatalogues.get(scope);
    if (!catalogue) { catalogue = new Map(); sourceCatalogues.set(scope,catalogue); }
    const profiles = await localProfiles(root);
    if (command === 'personal_profiles_choose_source') {
      const picked = await dialog.showOpenDialog(scope.window,{title:'Choose a browser profile folder',properties:['openDirectory']});
      if (picked.canceled || !picked.filePaths.length) return null;
      if (!current()) throw Error('The active account changed.');
      const source = await inspectSource(picked.filePaths[0],'Selected folder');
      const known = catalogue.get(source.id);
      if (known) { source.browser = known.browser; source.name = known.name; }
      source.manual = true;
      catalogue.set(source.id,source);
      const result = await sourceStatus(root,source,profiles);
      if (!current()) throw Error('The active account changed.');
      return result;
    }
    const {sources,unavailable} = await findSources();
    for (const source of catalogue.values()) {
      if (!source.manual || sources.some(s => s.id === source.id)) continue;
      try { sources.push({...await inspectSource(source.dir,source.browser,source.name),manual:true}); }
      catch { unavailable.push(source.name); }
    }
    catalogue.clear();
    const digests = new Map();
    const results = [];
    for (const source of sources) {
      catalogue.set(source.id,source);
      results.push(await sourceStatus(root,source,profiles,digests));
    }
    const unsupported = await otherBrowsers();
    if (!current()) throw Error('The active account changed.');
    return {sources:results,unavailable,unsupported};
  }
  if (command === 'personal_profiles_import_source') {
    const source = sourceCatalogues.get(scope)?.get(args.sourceId);
    if (!source) throw Error('Scan again to select a browser profile.');
    if (!Array.isArray(args.selected) || !args.selected.length || args.selected.some(k => !categories.includes(k))) throw Error('Select the data to import.');
    const lock = path.join(root,source.id);
    if (importingSources.has(lock)) throw Error('This source is already being imported.');
    importingSources.add(lock);
    try {
      const fresh = await inspectSource(source.dir,source.browser);
      if (fresh.id !== source.id) throw Error('The selected profile folder changed. Scan again.');
      const status = await sourceStatus(root,fresh,await localProfiles(root));
      const selected = [...new Set(args.selected)].filter(k => !status.items[k]?.imported);
      if (!selected.length) throw Error('The selected data has already been imported.');
      if (selected.some(k => status.items[k]?.busy)) throw Error(changed);
      if (selected.some(k => status.items[k]?.unreadable)) throw Error('The selected browser file cannot be read.');
      if (selected.some(k => !status.items[k] || fresh.items[k].version !== source.items[k]?.version)) throw Error('The source data changed. Scan again.');
      if (!current()) throw Error('The active account changed.');
      return await importProfile(root,fresh.dir,args.name,selected,current,fresh);
    } finally { importingSources.delete(lock); }
  }
  if (command === 'personal_profiles_import') {
    const {canceled,filePaths} = await dialog.showOpenDialog(scope.window, { title:'Choose a browser profile folder', properties:['openDirectory'] });
    if (canceled || !filePaths.length) return null;
    if (!current()) throw Error('The active account changed.');
    const source = await inspectSource(filePaths[0],'Selected folder');
    return importProfile(root,source.dir,args.name,args.selected,current,source);
  }
  if (command === 'personal_profiles_restore') {
    const choose = async (title,extension) => {
      const result = await dialog.showOpenDialog(scope.window,{title,properties:['openFile'],filters:[{name:title,extensions:[extension]}]});
      if (!current()) throw Error('The active account changed.');
      return result.canceled ? undefined : result.filePaths[0];
    };
    const archive = await choose('Choose your encrypted profile archive','nbarchive');
    if (!archive) return null;
    const key = await choose('Choose the recovery key for this archive','nbkey');
    return key ? restoreProfile(root,archive,key,current) : null;
  }
  if (command === 'personal_profiles_backup' && uuid.test(args.id)) return backupExisting(root,args.id,current);
  if (command === 'personal_profiles_reveal' && uuid.test(args.id)) {
    const profile = describe(root,JSON.parse(await fs.readFile(path.join(root,args.id,'profile.json'),'utf8')));
    const file = args.file === 'key' ? profile.backup?.keyPath : args.file === 'archive' ? profile.backup?.archivePath : undefined;
    if (!file || !await statFile(file)) throw Error('Recovery file not found. Use your saved copy.');
    if (!current()) throw Error('The active account changed.');
    shell.showItemInFolder(file);
    return;
  }
  if (command === 'personal_profiles_native_import' && !args.id) {
    const name = args.name?.trim();
    if (!name || name.length > 80) throw Error('Choose a profile name.');
    const executable = await findBrowser();
    const profile = { id:randomUUID(), name, kind:'personal', imported:[], pendingBackup:true };
    const dir = path.join(root,profile.id);
    if (!current()) throw Error('The active account changed.');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    try {
      await fs.writeFile(path.join(dir,'profile.json'),JSON.stringify(profile));
      const child = await openBrowser(path.join(dir,'browser'),importPage(executable),executable);
      watchWizard(child,root,profile.id,current,scope,true);
    } catch (error) { await fs.rm(dir,{recursive:true,force:true}); throw error; }
    return profile;
  }
  if (['personal_profiles_open','personal_profiles_native_import'].includes(command) && uuid.test(args.id)) {
    const dir = path.join(root,args.id);
    if (!await statFile(path.join(dir,'profile.json'))) throw Error('Personal profile not found.');
    if (!current()) throw Error('The active account changed.');
    const executable = await findBrowser();
    const wizard = command === 'personal_profiles_native_import';
    const profile = JSON.parse(await fs.readFile(path.join(dir,'profile.json'),'utf8'));
    if (wizard && (wizardWindows.has(dir) || ongoingBackups.has(dir))) throw Error('A profile import or backup is already in progress.');
    if (!current()) throw Error('The active account changed.');
    if (!wizard) {
      await openBrowser(path.join(dir,'browser'),undefined,executable,true);
      return true;
    }
    const pending = {...profile,pendingBackup:true};
    await saveMetadata(dir,pending);
    try {
      const child = await openBrowser(path.join(dir,'browser'),importPage(executable),executable);
      // An existing browser can receive this launch and let the second process exit
      // immediately. Only the user can confirm that its import wizard has finished.
      watchWizard(child,root,profile.id,current,scope,false);
    } catch (error) { await saveMetadata(dir,profile); throw error; }
    return describe(root,pending);
  }
  throw Error('Unknown personal profile action.');
}
module.exports = { personalCommand, tabUrls, importProfile, ownerRoot, restoreProfile };
