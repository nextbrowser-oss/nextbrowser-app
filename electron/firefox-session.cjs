const fs = require('node:fs/promises');
const path = require('node:path');

const limit = 64 * 1024 * 1024;
const magic = Buffer.from('mozLz40\0','binary');

// Mozilla prepends the uncompressed size to one raw LZ4 block.
function decodeSession(bytes) {
  if (!bytes.subarray(0,8).equals(magic)) return JSON.parse(bytes.toString('utf8'));
  const invalid = () => Error('Unreadable Firefox session file.');
  if (bytes.length < 12) throw invalid();
  const size = bytes.readUInt32LE(8);
  if (!size || size > limit) throw invalid();
  const plain = Buffer.allocUnsafe(size);
  let input = 12, output = 0;
  function length(n) {
    if (n === 15) {
      let extra;
      do {
        if (input >= bytes.length) throw invalid();
        extra = bytes[input++];
        n += extra;
      } while (extra === 255);
    }
    return n;
  }
  while (input < bytes.length) {
    const token = bytes[input++];
    const literals = length(token >> 4);
    if (input + literals > bytes.length || output + literals > size) throw invalid();
    bytes.copy(plain,output,input,input+literals);
    input += literals;
    output += literals;
    if (input === bytes.length) break;
    if (input + 2 > bytes.length) throw invalid();
    const distance = bytes.readUInt16LE(input);
    input += 2;
    const matches = length(token & 15) + 4;
    if (!distance || distance > output || output + matches > size) throw invalid();
    for (let i=0; i<matches; i++,output++) plain[output] = plain[output-distance];
  }
  if (output !== size) throw invalid();
  return JSON.parse(plain.toString('utf8'));
}

async function sessionFile(dir) {
  const names = ['sessionstore.jsonlz4','sessionstore-backups/recovery.jsonlz4','sessionstore.js'];
  const entries = [];
  for (const name of names) {
    const file = path.join(dir,name);
    try {
      const stat = await fs.lstat(file);
      if (stat.isFile() && stat.size) entries.push({file,stat});
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return entries.sort((a,b) => b.stat.mtimeMs-a.stat.mtimeMs)[0];
}

function webAddress(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 16000) return;
  try {
    const url = new URL(value);
    if (['https:','http:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch { /* Internal or malformed URL. */ }
}

async function readTabs(file) {
  const handle = await fs.open(file,'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw Error('Firefox session is too large to import.');
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const {bytesRead} = await handle.read(bytes,offset,bytes.length-offset,offset);
      if (!bytesRead) throw Error('Firefox session changed. Scan again.');
      offset += bytesRead;
    }
    const session = decodeSession(bytes);
    return (session.windows || []).filter(w => !w.isPrivate).flatMap(w =>
      (w.tabs || []).filter(t => !t.isPrivate && Array.isArray(t.entries)).map(t =>
        webAddress(t.entries[(t.index ?? t.entries.length)-1]?.url)).filter(Boolean));
  } finally { await handle.close(); }
}

module.exports = {sessionFile,readTabs,webAddress};
