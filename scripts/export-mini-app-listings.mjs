import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../electron/mini-apps/catalog.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const site = process.argv[2];
if (!site || JSON.parse(await fs.readFile(path.join(site, 'package.json'), 'utf8')).name !== 'nextbrowser-site') {
  throw Error('Pass the site directory of nextbrowser-landing.');
}
const entries = catalog.catalogIds.map(catalog.catalogEntry);
const content = path.join(site, 'src/content/mini-apps.json');
const reviews = path.join(site, 'src/components/mini-apps/CatalogReviews.tsx');
await fs.mkdir(path.dirname(reviews), { recursive: true });
await fs.copyFile(path.join(root,'src/pages/mini-apps/CatalogReviews.tsx'), reviews);
await fs.writeFile(content, JSON.stringify(entries.map(({id,name,version,description,tools,listing}) => ({id,name,version,description,tools,...listing})), null, 2) + '\n');
for (const app of entries) {
  const dest = path.join(site, 'public/assets/mini-apps', app.id);
  await fs.mkdir(dest, {recursive:true});
  for (const shot of app.listing.screenshots) await fs.copyFile(path.join(root,'public/mini-app-listings',app.id,shot.file), path.join(dest,shot.file));
  await fs.writeFile(path.join(dest, app.id + '.nbmini.json'), catalog.catalog(app.id));
}
