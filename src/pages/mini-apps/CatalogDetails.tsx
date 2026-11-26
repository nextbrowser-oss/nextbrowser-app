import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog, Button } from '../../shared/ui';
import { listingText, type CatalogApp } from '../../lib/miniAppLibrary';
import { MiniAppIcon } from '../../components/MiniAppIcon';
import { CatalogReviews } from './CatalogReviews';
import { catalogLabels } from './catalogLabels';

export function screenshotUrl(id: string, file: string) {
  return './mini-app-listings/' + id + '/' + file;
}

export function CatalogDetails({ app, installed, busy, launch, onClose }: {
  app: CatalogApp; installed: boolean; busy: boolean; launch: () => void; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const text = listingText(app);
  const t = catalogLabels();
  const shots = app.listing.screenshots.map(shot => ({ file: shot.file, alt: text.screenshots[shot.file] ?? shot.alt }));
  const shot = shots[index];
  return <Dialog title={app.name} onClose={onClose} className="catalog-detail">
    <header className="catalog-hero">
      <span className="catalog-hero-icon"><MiniAppIcon app={app} /></span>
      <p>{text.description}</p>
      <div className="catalog-hero-actions">
        <Button className="primary" disabled={busy} onClick={launch}>{installed ? t.open : t.install}</Button>
      </div>
    </header>
    <figure className="catalog-gallery">
      <div className="catalog-gallery-frame"><img src={screenshotUrl(app.id, shot.file)} alt={shot.alt} /></div>
      <figcaption aria-live="polite">{shot.alt}</figcaption>
      <div className="catalog-gallery-thumbs" role="group" aria-label="Screenshots">
        {shots.map((item, i) => <button key={item.file} type="button" aria-label={item.alt} aria-pressed={i === index} onClick={() => setIndex(i)}>
          <img src={screenshotUrl(app.id, item.file)} alt="" />
        </button>)}
      </div>
    </figure>
    <div className="catalog-facts">
      <section><h3>{t.whatItDoes}</h3><ul>{text.useCases.map(line => <li key={line}><Check size={15} aria-hidden="true" />{line}</li>)}</ul></section>
      <section><h3>{t.requirements}</h3><p>{text.requirements}</p></section>
      <section className="catalog-ask"><h3>{t.askAgent}</h3><p>“{text.example}”</p></section>
    </div>
    <CatalogReviews id={app.id} />
  </Dialog>;
}
