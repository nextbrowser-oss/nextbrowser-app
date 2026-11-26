import { useCallback, useEffect, useState } from 'react';
import { invoke } from '../../electronBridge';
import type { CatalogApp } from '../../lib/miniAppLibrary';

export const errorText = (err: unknown) => err instanceof Error ? err.message.replace(/^Error invoking remote method .*?: Error: /, '') : 'Could not reach the catalog.';

export function useCommunityCatalog(owner: string) {
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let active = true;
    if (owner === 'preview') return;
    async function load() {
      let after = '';
      const all: CatalogApp[] = [];
      while (active) {
        const page = await invoke<CatalogApp[]>('mini_apps_community_list', {owner, after});
        if (!active) return;
        all.push(...page);
        if (page.length < 30) break;
        const next = page[page.length - 1].id;
        if (next <= after) throw Error('Invalid catalog page.');
        after = next;
      }
      if (active) { setApps(all); setError(''); }
    }
    void load().catch(err => { if (active) setError(errorText(err)); });
    return () => { active = false; };
  }, [owner, revision]);
  return { apps, error, refresh };
}
export function catalogPackage(owner: string, app: CatalogApp) {
  return invoke<string>('mini_apps_community_file', {owner, id: app.id, version: app.version, file: 'package'});
}
export function CatalogImage({owner, app, shot}: {owner: string; app: CatalogApp; shot: CatalogApp['listing']['screenshots'][number]}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    if (!app.community) return;
    let active = true;
    setSrc(undefined);
    void invoke<string>('mini_apps_community_file', { owner, id: app.id, version: app.version, file: shot.file })
      .then(data => { if (active) setSrc('data:image/png;base64,' + data); }).catch(() => {});
    return () => { active = false; };
  }, [owner, app.id, app.version, app.community, shot.file]);
  return <img src={app.community ? src : './mini-app-listings/' + app.id + '/' + shot.file} alt={shot.alt} />;
}
