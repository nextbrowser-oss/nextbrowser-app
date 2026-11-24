const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { findBrowser } = require('./personal-browser.cjs');
const { sessionFile,readTabs,webAddress } = require('./firefox-session.cjs');

const run = promisify(execFile);
const chromiumEpoch = 11644473600000000n;

function firefoxRoots(platform,home,env) {
  if (platform === 'win32') return [path.join(env.APPDATA || path.join(home,'AppData','Roaming'),'Mozilla','Firefox')];
  if (platform === 'darwin') return [path.join(home,'Library','Application Support','Firefox')];
  return [path.join(home,'.mozilla','firefox'),path.join(env.XDG_CONFIG_HOME || path.join(home,'.config'),'mozilla','firefox'),
    path.join(home,'snap','firefox','common','.mozilla','firefox'),path.join(home,'.var','app','org.mozilla.firefox','.mozilla','firefox')];
}

async function registered(dir) {
  const ini = await fs.readFile(path.join(dir,'profiles.ini'),'utf8');
  const profiles = [];
  let profile;
  for (const line of ini.split(/\r?\n/).map(s => s.trim())) {
    if (line.startsWith('[')) {
      profile = /^\[Profile\d+\]$/i.test(line) ? {} : undefined;
      if (profile) profiles.push(profile);
    } else if (profile) {
      const match = /^(Name|Path|IsRelative)\s*=\s*(.+)$/i.exec(line);
      if (match) profile[match[1].toLowerCase()] = match[2].trim();
    }
  }
  return profiles.filter(p => p.path && (p.isrelative !== '0' || path.isAbsolute(p.path)))
    .map(p => ({dir:path.resolve(dir,p.path),name:p.name || path.basename(p.path)}));
}

function database(file,readOnly) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(file,{readOnly,allowExtension:false});
  db.exec('PRAGMA trusted_schema=OFF');
  return db;
}

const visited = 'FROM moz_historyvisits v JOIN moz_places p ON p.id=v.place_id WHERE v.visit_type IN (1,2,3,5,6,9) AND (p.url LIKE \'https://%\' OR p.url LIKE \'http://%\')';
const bookmarkRows = 'SELECT b.id,b.parent,b.type,b.title,b.guid,b.dateAdded,p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id=b.fk ORDER BY b.parent,b.position,b.id';

function bookmarks(db) {
  const folder = (id,name) => ({id:String(id),name,type:'folder',children:[]});
  const roots = {bookmark_bar:folder(1,'Bookmarks bar'),other:folder(2,'Other bookmarks'),synced:folder(3,'Mobile bookmarks')};
  const targets = {toolbar_____:roots.bookmark_bar,menu________:roots.other,unfiled_____:roots.other,mobile______:roots.synced};
  const rows = db.prepare(bookmarkRows).all();
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.parent)) children.set(row.parent,[]);
    children.get(row.parent).push(row);
  }
  let serial = 3, count = 0;
  const seen = new Set();
  function fill(parent,target,depth) {
    if (depth > 150 || seen.has(parent)) return;
    seen.add(parent);
    for (const row of children.get(parent) || []) {
      const id = String(++serial), name = row.title || '';
      if (row.type === 2) {
        const child = folder(id,name);
        target.children.push(child);
        fill(row.id,child,depth+1);
      } else if (row.type === 1) {
        const url = webAddress(row.url);
        if (!url) continue;
        target.children.push({id,name:name || url,type:'url',url,date_added:String(chromiumEpoch + BigInt(row.dateAdded || 0))});
        count++;
      }
    }
  }
  for (const row of rows) if (Object.hasOwn(targets,row.guid)) fill(row.id,targets[row.guid],0);
  return {tree:{version:1,roots},count};
}

async function inspect(dir) {
  const items = {};
  const places = path.join(dir,'places.sqlite');
  const stat = await fs.lstat(places).catch(e => { if (e.code !== 'ENOENT') throw e; });
  if (stat?.isFile() && stat.size) {
    let db;
    try {
      db = database(places,true);
      db.exec('BEGIN');
      for (const kind of ['bookmarks','history']) {
        try {
          // Revisions are independent even though Firefox stores both sets in places.sqlite.
          const query = kind === 'bookmarks'
            ? 'SELECT COUNT(*) AS n,MAX(id) AS id,MAX(lastModified) AS revision FROM moz_bookmarks'
            : 'SELECT COUNT(*) AS n,MAX(id) AS id,MAX(visit_date) AS revision FROM moz_historyvisits';
          const {n,id,revision} = db.prepare(query).get();
          if (!n) continue;
          const any = kind === 'bookmarks' ? bookmarks(db).count : db.prepare('SELECT 1 '+visited+' LIMIT 1').get();
          if (any) items[kind] = {version:[n,id,revision].join('|')};
        } catch (e) { items[kind] = fileError(e); }
      }
    } catch (e) {
      items.bookmarks = items.history = fileError(e);
    } finally { db?.close(); }
  }
  try {
    const session = await sessionFile(dir);
    const urls = session ? await readTabs(session.file) : [];
    if (urls.length) items.tabs = {version:createHash('sha256').update(JSON.stringify(urls)).digest('hex')};
  } catch (e) { items.tabs = fileError(e); }
  return items;
}

function fileError(e) {
  const busy = ['EACCES','EPERM','EBUSY'].includes(e.code) || [5,6].includes(e.errcode);
  return {busy,unreadable:!busy};
}

async function importHistory(source,dest) {
  // Let the installed destination browser create its own version of the History schema.
  const temp = await fs.mkdtemp(path.join(path.dirname(dest),'.history-schema-'));
  try {
    await run(await findBrowser(),['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
      '--disable-sync','--disable-background-networking','--disable-extensions','--disable-component-update',
      '--user-data-dir='+temp,'--dump-dom','about:blank'],{windowsHide:true,timeout:30000});
    const file = path.join(dest,'History');
    await fs.copyFile(path.join(temp,'Default','History'),file);
    const target = database(file,false);
    try {
      target.exec('BEGIN');
      const insertURL = target.prepare('INSERT INTO urls(url,title,visit_count,typed_count,last_visit_time,hidden) VALUES(?,?,1,?,?,0)');
      const updateURL = target.prepare('UPDATE urls SET visit_count=visit_count+1,typed_count=typed_count+?,last_visit_time=MAX(last_visit_time,?) WHERE id=?');
      const insertVisit = target.prepare('INSERT INTO visits(url,visit_time,from_visit,transition,visit_duration) VALUES(?,?,0,?,0)');
      const lookup = target.prepare('SELECT id FROM urls WHERE url=?');
      let count = 0;
      const rows = source.prepare('SELECT p.url,p.title,v.visit_date,v.visit_type '+visited+' ORDER BY v.id');
      for (const row of rows.iterate()) {
        const url = webAddress(row.url);
        if (!url || !Number.isSafeInteger(row.visit_date)) continue;
        const date = chromiumEpoch + BigInt(row.visit_date);
        const typed = Number(row.visit_type === 2);
        const prior = lookup.get(url);
        const id = prior?.id ?? insertURL.run(url,row.title || '',typed,date).lastInsertRowid;
        if (prior) updateURL.run(typed,date,id);
        insertVisit.run(id,date,0x30000000 + (row.visit_type === 9 ? 8 : typed));
        count++;
      }
      target.exec('COMMIT');
      return count;
    } finally { target.close(); }
  } finally { await fs.rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:100}); }
}

async function snapshot(dir,dest,selected,writeTabSession) {
  await fs.mkdir(dest,{recursive:true,mode:0o700});
  const imported = [];
  let places;
  try {
    if (selected.includes('bookmarks') || selected.includes('history')) {
      places = database(path.join(dir,'places.sqlite'),true);
      places.exec('BEGIN');
    }
    for (const kind of new Set(selected)) {
      if (kind === 'bookmarks') {
        const {tree,count} = bookmarks(places);
        if (!count) continue;
        await fs.writeFile(path.join(dest,'Bookmarks'),JSON.stringify(tree),{mode:0o600});
      } else if (kind === 'history') {
        if (!await importHistory(places,dest)) throw Error('No transferable Firefox visits were found.');
      } else if (kind === 'tabs') {
        const session = await sessionFile(dir);
        const urls = session && await readTabs(session.file);
        if (!urls?.length) continue;
        await writeTabSession(dest,urls);
      } else throw Error('Unsupported Firefox data type.');
      imported.push(kind);
    }
  } finally { places?.close(); }
  if (!imported.length) throw Error('No selected Firefox data was found. Scan again.');
  return imported;
}

module.exports = {firefoxRoots,registered,inspect,snapshot};
