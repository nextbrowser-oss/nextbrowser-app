const fs = require('node:fs/promises');
const path = require('node:path');
const { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } = require('node:crypto');

// v1: magic | salt | manifest length (BE) | encrypted manifest + tag |
// encrypted file + tag for each entry. Only the salt and framing are public.
const magic = Buffer.from('NBPA0001');
const headerBytes = magic.length + 16 + 4;
const tagBytes = 16;
const chunkBytes = 256 * 1024;
const maxManifest = 8192;
const maxRecordBytes = 2 ** 36 - 32; // AES-GCM limit for a single invocation.
const fileNames = new Map([['bookmarks','Bookmarks'], ['history','History'], ['tabs','Current Session'],
  ['favicons','Favicons'], ['topSites','Top Sites']]);
const invalid = 'Cannot open this archive. Check the recovery key and that the archive is intact.';
const keyName = /^[a-f0-9-]{36}\.nbkey$/;

async function readKey(file) {
  const handle = await fs.open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== 32) throw Error('Choose a Nextbrowser recovery key file (.nbkey).');
    return await readBytes(handle, 32);
  } finally { await handle.close(); }
}

async function findOrCreateKeyFile(directory) {
  await fs.mkdir(directory, {recursive:true, mode:0o700});
  const existing = (await fs.readdir(directory)).filter(name => keyName.test(name)).sort()[0];
  if (existing) return existing;
  const name = randomUUID() + '.nbkey';
  const file = path.join(directory,name);
  const temp = file + '.tmp';
  const key = randomBytes(32);
  try {
    const handle = await fs.open(temp,'wx',0o600);
    try { await handle.writeFile(key); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp,file);
    return name;
  } finally { key.fill(0); await fs.rm(temp,{force:true}); }
}

// Several imports can start before the user's first key has been published.
const pendingKeyFiles = new Map();
async function userKey(directory) {
  let pending = pendingKeyFiles.get(directory);
  if (!pending) {
    pending = findOrCreateKeyFile(directory).finally(() => pendingKeyFiles.delete(directory));
    pendingKeyFiles.set(directory,pending);
  }
  const name = await pending;
  return {name,key:await readKey(path.join(directory,name))};
}

async function readBytes(handle, size) {
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const {bytesRead} = await handle.read(bytes,offset,size - offset,null);
    if (!bytesRead) throw Error(invalid);
    offset += bytesRead;
  }
  return bytes;
}

// A fresh derived key per archive makes the manifest (index 0) and each file
// (indices 1..n) separate authenticated records with non-repeating nonces.
function record(key, header, index, decrypt) {
  const nonce = Buffer.alloc(12);
  nonce.writeUInt32BE(index,8);
  const create = decrypt ? createDecipheriv : createCipheriv;
  const cipher = create('aes-256-gcm',key,nonce,{authTagLength:tagBytes});
  cipher.setAAD(header);
  return cipher;
}

async function transfer(source, destination, bytes, cipher) {
  for (let left = bytes; left > 0;) {
    const count = Math.min(left,chunkBytes);
    await destination.writeFile(cipher.update(await readBytes(source,count)));
    left -= count;
  }
}

async function writeArchive(file, keyDirectory, profile, sourceDir) {
  const files = [];
  for (const type of profile.imported) {
    let input = fileNames.get(type);
    if (!input) throw Error('Unsupported backup data type.');
    if (type === 'tabs') {
      // sourceDir is an isolated snapshot created by writeTabSession.
      const sessions = (await fs.readdir(path.join(sourceDir,'Sessions'))).filter(n => /^Session_\d+$/.test(n));
      if (sessions.length !== 1) throw Error('Expected one imported tab session.');
      input = path.join('Sessions',sessions[0]);
    }
    const localPath = path.join(sourceDir,input);
    const stat = await fs.stat(localPath);
    if (stat.size > maxRecordBytes) throw Error('This browser file is too large for the archive format.');
    files.push({type, size:stat.size, localPath});
  }
  const manifest = Buffer.from(JSON.stringify({name:profile.name,files:files.map(({type,size}) => ({type,size}))}));
  const header = Buffer.alloc(headerBytes);
  magic.copy(header);
  randomBytes(16).copy(header, magic.length);
  header.writeUInt32BE(manifest.length,headerBytes-4);
  const recovery = await userKey(keyDirectory);
  const key = Buffer.from(hkdfSync('sha256',recovery.key,header.subarray(magic.length,-4),magic,32));
  recovery.key.fill(0);
  try {
    const out = await fs.open(file,'wx',0o600);
    try {
      const meta = record(key,header,0,false);
      await out.writeFile(Buffer.concat([header,meta.update(manifest),meta.final(),meta.getAuthTag()]));
      for (const [index,entry] of files.entries()) {
        const cipher = record(key,header,index+1,false);
        const input = await fs.open(entry.localPath,'r');
        try { await transfer(input,out,entry.size,cipher); } finally { await input.close(); }
        await out.writeFile(Buffer.concat([cipher.final(),cipher.getAuthTag()]));
      }
      await out.sync();
    } finally { await out.close(); }
    return recovery.name;
  } finally { key.fill(0); }
}

// dest is private staging. Its caller discards the entire directory on any
// error and publishes a new local profile only after all records authenticate.
async function readArchive(file, keyFile, dest) {
  const recovery = await readKey(keyFile);
  let input, key;
  try {
    input = await fs.open(file,'r');
    const stat = await input.stat();
    if (!stat.isFile()) throw Error(invalid);
    const header = await readBytes(input,headerBytes);
    const length = header.readUInt32BE(headerBytes-4);
    if (!header.subarray(0,magic.length).equals(magic) || !length || length > maxManifest) throw Error(invalid);
    key = Buffer.from(hkdfSync('sha256',recovery,header.subarray(magic.length,-4),magic,32));
    const meta = record(key,header,0,true);
    const sealed = await readBytes(input,length);
    meta.setAuthTag(await readBytes(input,tagBytes));
    const {name,files} = JSON.parse(Buffer.concat([meta.update(sealed),meta.final()]).toString('utf8'));
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || !Array.isArray(files)
      || !files.length || files.length > fileNames.size || new Set(files.map(e=>e.type)).size !== files.length
      || files.some(e=>!fileNames.has(e.type) || !Number.isSafeInteger(e.size) || e.size < 0 || e.size > maxRecordBytes)
      || headerBytes + length + tagBytes + files.reduce((n,e)=>n+e.size+tagBytes,0) !== stat.size) throw Error(invalid);
    for (const [index,entry] of files.entries()) {
      const cipher = record(key,header,index+1,true);
      const out = await fs.open(path.join(dest,fileNames.get(entry.type)),'wx',0o600);
      try {
        await transfer(input,out,entry.size,cipher);
        cipher.setAuthTag(await readBytes(input,tagBytes));
        await out.writeFile(cipher.final());
      } finally { await out.close(); }
    }
    return {name, selected:files.map(e=>e.type)};
  } catch (error) {
    if (error.code && /^E(ACCES|PERM|NOENT|NOSPC|IO)$/.test(error.code)) throw error;
    throw Error(invalid);
  } finally { recovery.fill(0); key?.fill(0); await input?.close(); }
}

module.exports = {writeArchive, readArchive, userKey, readKey};
