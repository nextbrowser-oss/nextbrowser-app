const fs = require('node:fs/promises');
const path = require('node:path');
const { resolveEntry, readWorkspaceText, editEntry } = require('./stock-mcp-operations.cjs');

const ignoredDirectories = new Set(['node_modules', 'dist', 'build', 'target', 'coverage', '__pycache__', 'vendor']);

async function searchFiles(root, relative, query, signal) {
  if (typeof query !== 'string' || !query.trim() || query.length > 300 || /[\0\r\n]/.test(query)) throw Error('Enter one line of literal search text.');
  const matches = [];
  const directories = [relative];
  let entries = 0, bytes = 0, skipped = 0;
  while (directories.length) {
    const dir = directories.pop();
    const directory = await fs.opendir(await resolveEntry(root, dir));
    for await (const entry of directory) {
      signal.throwIfAborted();
      if (++entries > 10000 || bytes >= 32 * 1024 * 1024) return { matches, truncated: true, skipped };
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const file = path.posix.join(dir.replaceAll('\\', '/'), entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) directories.push(file);
        continue;
      }
      if (!entry.isFile()) continue;
      let content;
      try {
        const stat = await fs.stat(await resolveEntry(root, file));
        if (stat.size > 512 * 1024) { skipped++; continue; }
        bytes += stat.size;
        ({ content } = await readWorkspaceText(root, file));
      } catch { skipped++; continue; }
      const lines = content.split('\n');
      for (let line = 0; line < lines.length; line++) {
        const column = lines[line].indexOf(query);
        if (column < 0) continue;
        if (matches.length === 20) return { matches, truncated: true, skipped };
        matches.push({ path: file, line: line + 1, text: lines[line].slice(Math.max(0, column - 50), column + 140).trimEnd() });
      }
    }
  }
  return { matches, truncated: false, skipped };
}

// Only the supplied hunk is disclosed by the edit permission. Untouched bytes,
// the original BOM and the file's final newline survive the replacement.
async function patchFile(root, args, check) {
  const { path: file, old_text, new_text, expected_sha256 } = args;
  if (!old_text || [old_text, new_text].some(s => typeof s !== 'string' || s.includes('\0') || Buffer.byteLength(s) > 16 * 1024)) {
    throw Error('Supply old and new complete lines, up to 16 KiB each.');
  }
  const { content, sha256, bom } = await readWorkspaceText(root, file);
  if (sha256 !== expected_sha256) throw Error('File changed. Read it again before editing.');
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) || [];
  const logicalLines = lines.map(line => line.replace(/\r?\n$/, ''));
  const block = s => s.replaceAll('\r\n', '\n').replace(/\n$/, '').split('\n');
  const before = block(old_text), after = new_text === '' ? [] : block(new_text);
  const searchable = '\n' + logicalLines.join('\n') + '\n';
  const needle = '\n' + before.join('\n') + '\n';
  const at = searchable.indexOf(needle);
  if (!lines.length || at < 0 || searchable.indexOf(needle, at + 1) >= 0) throw Error('The old lines must match exactly once. Include more surrounding lines.');
  if (before.join('\n') === after.join('\n') && before.length === after.length) throw Error('The patch would leave the file unchanged.');
  const start = searchable.slice(0, at).split('\n').length - 1;
  const last = lines[start + before.length - 1];
  const lastEnding = last.match(/\r?\n$/)?.[0] || '';
  const ending = lines[start].match(/\r?\n$/)?.[0] || content.match(/\r?\n/)?.[0] || '\n';
  const replacement = after.length ? after.join(ending) + lastEnding : '';
  const updated = (bom ? '\uFEFF' : '') + lines.slice(0, start).join('') + replacement + lines.slice(start + before.length).join('');
  const result = await editEntry(root, file, false, updated, sha256, check, 512 * 1024);
  const diff = ['--- a/' + file, '+++ b/' + file, '@@ -' + (start + 1) + ',' + before.length + ' +' + (after.length ? start + 1 : start) + ',' + after.length + ' @@',
    ...before.map(line => '-' + line), ...(!lastEnding ? ['\\ No newline at end of file'] : []),
    ...after.map(line => '+' + line), ...(!lastEnding && after.length ? ['\\ No newline at end of file'] : [])].join('\n');
  return { ...result, diff: diff.slice(0, 3500), diffTruncated: diff.length > 3500 };
}

module.exports = { searchFiles, patchFile };
