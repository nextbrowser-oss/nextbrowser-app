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
function catalogEntry(id) {
  const info = metadata(parsePackage(catalog(id)));
  const dir = path.join(assets, 'mini-app-listings', id);
  const listing = JSON.parse(fs.readFileSync(path.join(dir, 'listing.json'), 'utf8'));
  const text = v => typeof v === 'string' && v.trim().length > 0;
  if (!text(listing.author) || !Array.isArray(listing.useCases) || !listing.useCases.length || !listing.useCases.every(text) ||
      !text(listing.requirements) || !text(listing.example) || !Array.isArray(listing.screenshots) ||
      listing.screenshots.length < 2 || listing.screenshots.length > 8 ||
      new Set(listing.screenshots.map(s => s.file)).size !== listing.screenshots.length ||
      listing.screenshots.some(s => !/^[a-z0-9-]+\.(png|webp)$/.test(s.file) || !text(s.alt) || !fs.existsSync(path.join(dir, s.file)))) {
    throw Error('Invalid catalog listing for ' + id);
  }
  return { ...info, listing };
}
module.exports = { catalog, catalogIds, catalogEntry };
