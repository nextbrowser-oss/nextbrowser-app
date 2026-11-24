const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const firefox = require('./personal-firefox.cjs');

const files = {bookmarks:'Bookmarks',history:'History',favicons:'Favicons',topSites:'Top Sites'};
const categories = ['bookmarks','history','tabs','favicons','topSites'];

function browserRoots(platform = process.platform, home = os.homedir(), env = process.env) {
  const brands = [
    ['Chrome','Google/Chrome','google-chrome'],
    ['Edge','Microsoft/Edge','microsoft-edge'],
    ['Brave','BraveSoftware/Brave-Browser','BraveSoftware/Brave-Browser'],
    ['Chromium','Chromium','chromium'],
  ];
  return brands.map(([browser,brand,unix]) => {
    if (platform === 'win32') return {browser,dir:path.join(env.LOCALAPPDATA || path.join(home,'AppData','Local'),brand,'User Data')};
    if (platform === 'darwin') return {browser,dir:path.join(home,'Library','Application Support',brand)};
    return {browser,dir:path.join(env.XDG_CONFIG_HOME || path.join(home,'.config'),unix)};
  }).concat(firefox.firefoxRoots(platform,home,env).map(dir => ({browser:'Firefox',dir})));
}

async function regularFile(file) {
  try {
    const stat = await fs.lstat(file);
    return stat.isFile() ? stat : undefined;
  } catch (e) { if (e.code === 'ENOENT') return; throw e; }
}

async function latestSession(dir) {
  const sessions = path.join(dir,'Sessions');
  let names = [];
  try {
    if ((await fs.lstat(sessions)).isDirectory()) {
      names = (await fs.readdir(sessions)).filter(n => /^Session_\d+$/.test(n))
        .sort((a,b) => b.length - a.length || b.localeCompare(a)).map(n => path.join(sessions,n));
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!names.length) names = ['Current Session','Last Session'].map(n => path.join(dir,n));
  for (const file of names) {
    const stat = await regularFile(file);
    if (stat?.size > 8) return {file,stat};
  }
}

// The renderer receives availability and import status, never the profile contents.
async function inspectSource(directory,browser,displayName) {
  const dir = await fs.realpath(directory);
  if (!(await fs.lstat(dir)).isDirectory()) throw Error('Choose a browser profile folder.');
  const key = process.platform === 'win32' ? dir.toLowerCase() : dir;
  const id = createHash('sha256').update(key).digest('hex');
  if (browser === 'Firefox' || (browser === 'Selected folder' && (await regularFile(path.join(dir,'places.sqlite')) || await regularFile(path.join(dir,'prefs.js'))))) {
    return {id,dir,browser:'Firefox',name:displayName || path.basename(dir),items:await firefox.inspect(dir)};
  }
  const items = {};
  for (const kind of categories) {
    try {
      const file = path.join(dir,files[kind] || 'Sessions');
      const entry = kind === 'tabs' ? await latestSession(dir) : {file,stat:await regularFile(file)};
      if (!entry?.stat?.size) continue;
      const database = kind !== 'bookmarks' && kind !== 'tabs';
      const busy = database && (await Promise.all(['-wal','-journal'].map(s => regularFile(file+s)))).some(s => s?.size);
      items[kind] = {version:[path.basename(entry.file),entry.stat.size,entry.stat.mtimeMs].join('|'),busy};
    } catch (e) {
      if (!['EACCES','EPERM','EBUSY'].includes(e.code)) throw e;
      items[kind] = {busy:true};
    }
  }
  const folder = path.basename(dir);
  let name = folder;
  try {
    const prefs = path.join(dir,'Preferences');
    const stat = await regularFile(prefs);
    if (stat && stat.size < 4 * 1024 * 1024) {
      const displayName = JSON.parse(await fs.readFile(prefs,'utf8')).profile?.name;
      if (typeof displayName === 'string' && displayName.trim() && displayName.trim() !== folder) {
        name = displayName.trim().slice(0,60) + ' (' + folder + ')';
      }
    }
  } catch { /* A profile can be found even when its display name is unavailable. */ }
  return {id,dir,browser,name,items};
}

async function hasPortableData(dir,kind) {
  if (kind === 'bookmarks') {
    const tree = JSON.parse(await fs.readFile(path.join(dir,files[kind]),'utf8'));
    if (!tree.roots) throw Error('Unrecognized bookmark file.');
    const queue = Object.values(tree.roots);
    while (queue.length) {
      const node = queue.pop();
      if (node?.type === 'url' && node.url) return true;
      for (const child of node?.children || []) queue.push(child);
    }
    return false;
  }
  const tables = {history:['urls','downloads'],favicons:['favicons'],topSites:['top_sites','thumbnails']}[kind];
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(path.join(dir,files[kind]),{readOnly:true,allowExtension:false});
  try {
    db.exec('PRAGMA trusted_schema=OFF');
    const exists = db.prepare("SELECT 1 FROM sqlite_schema WHERE name = ? AND type = 'table'");
    return tables.some(t => exists.get(t) && !!db.prepare('SELECT 1 FROM ' + t + ' LIMIT 1').get());
  } finally { db.close(); }
}

async function findSources(roots = browserRoots()) {
  const sources = [];
  const unavailable = new Set();
  for (const {dir,browser} of roots) {
    if (browser === 'Firefox') {
      try {
        for (const entry of await firefox.registered(dir)) {
          try {
            const profile = await inspectSource(entry.dir,browser,entry.name);
            if (!sources.some(s => s.id === profile.id)) sources.push(profile);
          } catch (e) { if (e.code !== 'ENOENT') unavailable.add(browser); }
        }
      } catch (e) { if (e.code !== 'ENOENT') unavailable.add(browser); }
      continue;
    }
    let entries;
    try { entries = await fs.readdir(dir,{withFileTypes:true}); }
    catch (e) { if (e.code !== 'ENOENT') unavailable.add(browser); continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^(Default|Profile \d+)$/.test(entry.name)) continue;
      try { sources.push(await inspectSource(path.join(dir,entry.name),browser)); }
      catch (e) { if (e.code !== 'ENOENT') unavailable.add(browser); }
    }
  }
  return {sources,unavailable:[...unavailable]};
}

async function otherBrowsers(platform = process.platform, home = os.homedir()) {
  const detected = [];
  if (platform === 'darwin') {
    try { if ((await fs.lstat(path.join(home,'Library','Safari'))).isDirectory()) detected.push('Safari'); } catch { /* Optional source. */ }
  }
  return detected;
}
module.exports = {browserRoots,findSources,inspectSource,hasPortableData,otherBrowsers,files,categories};
