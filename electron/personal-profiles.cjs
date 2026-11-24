const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { openBrowser, findBrowser, importPage } = require('./personal-browser.cjs');

const categories = ['bookmarks','history','tabs','favicons','topSites'];
const databases = { history: 'History', favicons: 'Favicons', topSites: 'Top Sites' };
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

async function importProfile(root, source, name, selected, active = () => true) {
  if (!name?.trim() || name.trim().length > 80 || !Array.isArray(selected) || !selected.length || selected.some(s => !categories.includes(s))) throw Error('Choose a name and at least one data type.');
  if (!(await fs.lstat(source)).isDirectory()) throw Error('Select the original browser profile folder.');
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stage = await fs.mkdtemp(path.join(root,'.import-'));
  try {
    const id = randomUUID(), dest = path.join(stage,'browser','Default');
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
      } else if (!await copyDatabase(source,dest,databases[kind])) continue;
      imported.push(kind);
    }
    if (!imported.length) throw Error('No selected data found. Choose the browser profile folder (Default or Profile 1, for example).');
    const profile = { id, name: name.trim(), kind: 'personal', imported };
    await fs.writeFile(path.join(stage,'profile.json'),JSON.stringify(profile));
    if (!active()) throw Error('The active account changed.');
    await fs.rename(stage,path.join(root,id));
    return profile;
  } catch (error) { await fs.rm(stage,{recursive:true,force:true}); throw error; }
}

function ownerRoot(base, owner) { return path.join(base,createHash('sha256').update(owner).digest('hex')); }
async function personalCommand({base, scope, current, dialog, command, args}) {
  if (!scope?.owner.startsWith('account/') || !current()) throw Error('Sign in to import personal profiles.');
  const root = ownerRoot(base,scope.owner);
  if (command === 'personal_profiles_list') {
    let entries;
    try { entries = await fs.readdir(root, {withFileTypes:true}); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return Promise.all(entries.filter(entry => entry.isDirectory() && uuid.test(entry.name)).map(async entry => JSON.parse(await fs.readFile(path.join(root,entry.name,'profile.json'),'utf8'))));
  }
  if (command === 'personal_profiles_import') {
    const {canceled,filePaths} = await dialog.showOpenDialog(scope.window, { title:'Choose your browser profile (Default or Profile 1)', properties:['openDirectory'] });
    if (canceled || !filePaths.length) return null;
    return importProfile(root,filePaths[0],args.name,args.selected,current);
  }
  if (command === 'personal_profiles_native_import' && !args.id) {
    const name = args.name?.trim();
    if (!name || name.length > 80) throw Error('Choose a profile name.');
    const executable = await findBrowser();
    const profile = { id:randomUUID(), name, kind:'personal', imported:[] };
    const dir = path.join(root,profile.id);
    if (!current()) throw Error('The active account changed.');
    await fs.mkdir(dir,{recursive:true,mode:0o700});
    try {
      await fs.writeFile(path.join(dir,'profile.json'),JSON.stringify(profile));
      await openBrowser(path.join(dir,'browser'),importPage(executable),executable);
    } catch (error) { await fs.rm(dir,{recursive:true,force:true}); throw error; }
    return profile;
  }
  if (['personal_profiles_open','personal_profiles_native_import'].includes(command) && uuid.test(args.id)) {
    const dir = path.join(root,args.id);
    if (!await statFile(path.join(dir,'profile.json'))) throw Error('Personal profile not found.');
    if (!current()) throw Error('The active account changed.');
    const executable = await findBrowser();
    const wizard = command === 'personal_profiles_native_import';
    await openBrowser(path.join(dir,'browser'), wizard ? importPage(executable) : undefined, executable, !wizard);
    return true;
  }
  throw Error('Unknown personal profile action.');
}
module.exports = { personalCommand, tabUrls, importProfile, ownerRoot };
