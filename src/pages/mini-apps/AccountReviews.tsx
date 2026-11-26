import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { Button } from '../../shared/ui';
import { invoke } from '../../electronBridge';
import { errorText } from './CommunityCatalog';

type Review = { id: string; author: string; rating: number; comment: string; updated_at: string };
type Page = { total: number; average: number; reviews: Review[]; mine: Review | null };
export function AccountReviews({owner, id}: {owner: string; id: string}) {
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState<{rating: number; comment: string}>();
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (owner === 'preview') return;
    let active = true;
    setError(''); setPage(undefined);
    void invoke<Page>('mini_apps_reviews', {owner, id, offset}).then(result => { if (active) setPage(result); })
      .catch(e => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [id, owner, offset, revision]);
  async function save() {
    if (!draft || saving) return;
    setSaving(true); setError('');
    try {
      await invoke('mini_apps_review_save', {owner, id, ...draft});
      setDraft(undefined); setOffset(0); setRevision(n => n + 1);
    } catch (e) { setError(errorText(e)); }
    finally { setSaving(false); }
  }
  return <section className="catalog-account-reviews"><h3>Ratings &amp; reviews</h3>
    {owner === 'preview' ? <p>Sign in to Nextbrowser to rate this mini app.</p> : <>
      {error && <p role="alert">{error} <Button onClick={() => setRevision(n => n + 1)}>Retry</Button></p>}
      {!page && !error && <p role="status">Loading reviews…</p>}
      {page && <>
        <div className="catalog-review-summary"><span>{page.total ? '★ ' + page.average.toFixed(1) + ' / 5 · ' + page.total + (page.total === 1 ? ' rating' : ' ratings') : 'No ratings yet.'}</span>
        {!draft && <Button onClick={() => setDraft({rating: page.mine?.rating ?? 0, comment: page.mine?.comment ?? ''})}>{page.mine ? 'Edit your review' : 'Write a review'}</Button>}</div>
        {draft && <form className="catalog-form" onSubmit={e => {e.preventDefault(); void save();}}>
          <fieldset disabled={saving}><legend>Your rating</legend><div className="catalog-stars">{[1,2,3,4,5].map(n =>
            <label key={n}><input type="radio" name="rating" value={n} checked={draft.rating === n} onChange={() => setDraft({...draft, rating:n})} aria-label={n + (n === 1 ? ' star' : ' stars')} />
              <Star aria-hidden size={19} fill={n <= draft.rating ? 'currentColor' : 'none'} /></label>)}</div></fieldset>
          <label>Comment (optional)<textarea maxLength={2000} rows={3} value={draft.comment} disabled={saving} onChange={e => setDraft({...draft,comment:e.target.value})} /></label>
          <div><Button type="submit" disabled={!draft.rating || saving}>Save review</Button> <Button type="button" disabled={saving} onClick={() => setDraft(undefined)}>Cancel</Button></div>
        </form>}
        {page.reviews.map(review => <article key={review.id}><strong>{review.author}</strong> · <span aria-label={review.rating + ' out of 5 stars'}>{'★'.repeat(review.rating)}</span>
          {review.comment && <p>{review.comment}</p>}</article>)}
        {(offset > 0 || offset + 20 < page.total) && <nav aria-label="Review pages"><Button disabled={!offset} onClick={() => setOffset(offset - 20)}>Previous</Button> <Button disabled={offset+20>=page.total} onClick={() => setOffset(offset + 20)}>Next</Button></nav>}
      </>}
    </>}
  </section>;
}
