"use client";

import { useEffect, useState } from 'react';

const repo = 'nextbrowser-oss/nextbrowser-app';
type Issue = { number: number; title: string; body: string | null; user: { login: string } | null };

// Also used on the public listing. No account token is sent to the public read API.
export function CatalogReviews({ id }: { id: string }) {
  return <ReviewFeed key={id} id={id} />;
}
function ReviewFeed({ id }: { id: string }) {
  const marker = 'NBReview-' + id;
  const query = 'repo:' + repo + ' is:issue in:title "' + marker + '"';
  const issues = 'https://github.com/' + repo + '/issues';
  const [attempt, setAttempt] = useState(0);
  const [reviews, setReviews] = useState<Issue[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 12000);
    let active = true;
    async function load() {
      try {
        const params = new URLSearchParams({q: query, sort: 'created', order: 'desc', per_page: '30'});
        const response = await fetch('https://api.github.com/search/issues?' + params, { signal: abort.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw Error('Review feed unavailable');
        const {items}: {items: Issue[]} = await response.json();
        if (active) setReviews(items.filter(issue => issue.title.startsWith(marker + ':')).slice(0, 5));
      } catch { if (active) setFailed(true); }
      finally { clearTimeout(timeout); }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); abort.abort(); };
  }, [attempt, query, marker]);

  return <section className="catalog-reviews" aria-label="Community reviews">
    <h3>Community reviews</h3>
    <div aria-live="polite">
      {failed ? <p>The review feed is unavailable. <button type="button" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>Retry</button></p> :
        reviews === undefined ? <p>Loading reviews…</p> :
        reviews.length === 0 ? <p>No reviews yet.</p> :
        reviews.map(issue => <article key={issue.number}>
          <a href={issues + '/' + issue.number} target="_blank" rel="noreferrer">{issue.title.slice(marker.length + 1).trim() || 'Review'}</a>
          <small>{issue.user?.login || 'GitHub user'}</small>
          {issue.body && <p>{issue.body.slice(0, 360)}{issue.body.length > 360 ? '…' : ''}</p>}
        </article>)}
    </div>
    <div className="catalog-review-links">
      <a href={issues + '?q=' + encodeURIComponent(query)} target="_blank" rel="noreferrer">View all reviews</a></div>
  </section>;
}
