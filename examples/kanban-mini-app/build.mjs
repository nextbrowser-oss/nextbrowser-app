import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const read = name => fs.readFileSync(new URL(name, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(read('manifest.json'));
const html = read('index.html').replace('<!-- style -->', () => '<style>' + read('board.css') + '</style>')
  .replace('<!-- script -->', () => '<script type="module">' + read('board.js') + '</script>');
const output = process.argv[2] || fileURLToPath(new URL(manifest.id + '.nbmini.json', import.meta.url));
fs.writeFileSync(output, JSON.stringify({ ...manifest, html }) + '\n');
console.log(output);
