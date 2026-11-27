import { translate } from "../../shared/lib/i18n";
import { useState } from 'react';
import { Check } from 'lucide-react';
import { Dialog, Button } from '../../shared/ui';
import { listingText, type CatalogApp } from '../../lib/miniAppLibrary';
import { MiniAppIcon } from '../../components/MiniAppIcon';
import { CatalogReviews } from './CatalogReviews';
import { catalogLabels } from './catalogLabels';

import { CatalogImage } from './CommunityCatalog';
import { AccountReviews } from './AccountReviews';

export function CatalogDetails({ owner, app, installed, busy, launch, onClose }: {
  owner: string;
  app: CatalogApp; installed: boolean; busy: boolean; launch: () => void; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [archive, setArchive] = useState(false);
  const text = listingText(app);
  const t = catalogLabels();
  const shots = app.listing.screenshots.map(shot => ({ file: shot.file, alt: text.screenshots[shot.file] ?? shot.alt }));
  const shot = shots[index];
  return <Dialog title={app.name} onClose={onClose} className="catalog-detail">
    <header className="catalog-hero">
      <span className="catalog-hero-icon"><MiniAppIcon app={app} /></span>
      <div><small className="catalog-author">{translate("By")} {app.listing.author}</small><p>{text.description}</p></div>
      <div className="catalog-hero-actions">
        <Button className="primary" disabled={busy} onClick={launch}>{installed ? t.open : t.install}</Button>
      </div>
    </header>
    <figure className="catalog-gallery">
      <div className="catalog-gallery-frame"><CatalogImage owner={owner} app={app} shot={shot} /></div>
      <figcaption aria-live="polite">{shot.alt}</figcaption>
      <div className="catalog-gallery-thumbs" role="group" aria-label={translate("Screenshots")}>
        {shots.map((item, i) => <button key={item.file} type="button" aria-label={item.alt} aria-pressed={i === index} onClick={() => setIndex(i)}>
          <CatalogImage owner={owner} app={app} shot={{...item,alt:""}} />
        </button>)}
      </div>
    </figure>
    <div className="catalog-facts">
      <section><h3>{t.whatItDoes}</h3><ul>{text.useCases.map(line => <li key={line}><Check size={15} aria-hidden="true" />{line}</li>)}</ul></section>
      <section><h3>{t.requirements}</h3><p>{text.requirements}</p></section>
      <section className="catalog-ask"><h3>{t.askAgent}</h3><p>“{text.example}”</p></section>
    </div>
    <AccountReviews owner={owner} id={app.id} />
    {!app.community && <details onToggle={e => setArchive(e.currentTarget.open)}><summary>{translate("Archived GitHub reviews")}</summary>{archive && <CatalogReviews id={app.id} />}</details>}
  </Dialog>;
}
