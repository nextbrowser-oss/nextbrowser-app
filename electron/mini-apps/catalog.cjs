const fs = require('node:fs');
const path = require('node:path');
const { parsePackage, metadata } = require('./store.cjs');
const catalogIds = ['kanban', 'music-player', 'swipeforge'];
const root = path.resolve(__dirname, '../..');
const assets = fs.existsSync(path.join(root, 'public/mini-app-listings')) ? path.join(root, 'public') : path.join(root, 'dist');
function catalog(id = 'kanban') {
  if (!catalogIds.includes(id)) throw Error('Unknown catalog app.');
  const dir = path.join(__dirname, 'catalog');
  if (id === 'kanban') return fs.readFileSync(path.join(dir, id + '.nbmini.json'), 'utf8');
  const css = fs.readFileSync(path.join(assets, 'mini-app-ui/select-fields.css'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'));
  const html = fs.readFileSync(path.join(dir, id, 'index.html'), 'utf8').replace('/* shared-select-fields */', () => css);
  return JSON.stringify({ ...manifest, html });
}
// A listing is language-neutral screenshot order in listing.json plus one text file per
// language in locales/<lang>.json. English is required; other languages are optional
// and must translate every field. The English text stays at the top level for exporters.
const LOCALE = /^[a-z]{2}(-[A-Z]{2})?$/;
function catalogEntry(id) {
  const info = metadata(parsePackage(catalog(id)));
  const dir = path.join(assets, 'mini-app-listings', id);
  const fail = () => { throw Error('Invalid catalog listing for ' + id); };
  const text = v => typeof v === 'string' && v.trim().length > 0;
  const { screenshots: files } = JSON.parse(fs.readFileSync(path.join(dir, 'listing.json'), 'utf8'));
  if (!Array.isArray(files) || files.length < 2 || files.length > 8 || new Set(files).size !== files.length ||
      files.some(file => !/^[a-z0-9-]+\.(png|webp)$/.test(file) || !fs.existsSync(path.join(dir, file)))) fail();
  const locales = {};
  for (const name of fs.readdirSync(path.join(dir, 'locales')).filter(n => n.endsWith('.json')).sort()) {
    const lang = name.slice(0, -5);
    const t = JSON.parse(fs.readFileSync(path.join(dir, 'locales', name), 'utf8'));
    if (!LOCALE.test(lang) || !text(t.description) || !Array.isArray(t.useCases) || !t.useCases.length || !t.useCases.every(text) ||
        !text(t.requirements) || !text(t.example) || !t.screenshots || files.some(file => !text(t.screenshots[file]))) fail();
    locales[lang] = { description: t.description, useCases: t.useCases, requirements: t.requirements, example: t.example, screenshots: t.screenshots };
  }
  const en = locales.en ?? fail();
  return { ...info, listing: { screenshots: files.map(file => ({ file, alt: en.screenshots[file] })), useCases: en.useCases,
    requirements: en.requirements, example: en.example, description: en.description, locales } };
}
module.exports = { catalog, catalogIds, catalogEntry };
