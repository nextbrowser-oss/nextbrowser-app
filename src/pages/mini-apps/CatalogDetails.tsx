import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, IconButton, Button } from '../../shared/ui';
import type { CatalogApp } from '../../lib/miniAppLibrary';
import { CatalogReviews } from './CatalogReviews';

export function screenshotUrl(id: string, file: string) {
  return './mini-app-listings/' + id + '/' + file;
}

export function CatalogDetails({ app, installed, busy, launch, onClose }: {
  app: CatalogApp; installed: boolean; busy: boolean; launch: () => void; onClose: () => void;
}) {
  const [index, setIndex] = useState(0);
  const { screenshots, useCases, requirements, example } = app.listing;
  const shot = screenshots[index];
  return <Dialog title={app.name} onClose={onClose} className="catalog-detail">
    <p>{app.description}</p>
    <figure className="catalog-gallery">
      <img src={screenshotUrl(app.id, shot.file)} alt={shot.alt} />
      <figcaption>
        <IconButton label="Previous screenshot" appearance="plain" onClick={() => setIndex((index + screenshots.length - 1) % screenshots.length)}><ChevronLeft size={16} /></IconButton>
        <span aria-live="polite">{index + 1} / {screenshots.length} · {shot.alt}</span>
        <IconButton label="Next screenshot" appearance="plain" onClick={() => setIndex((index + 1) % screenshots.length)}><ChevronRight size={16} /></IconButton>
      </figcaption>
    </figure>
    <div className="catalog-detail-actions">
      <Button className="primary" disabled={busy} onClick={launch}>{installed ? 'Open' : 'Install'}</Button>
    </div>
    <ul>{useCases.map(line => <li key={line}>{line}</li>)}</ul><p>{requirements}</p>
    <h3>Ask your agent</h3><p>{example}</p>
    <CatalogReviews id={app.id} />
  </Dialog>;
}
