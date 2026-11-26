import { useRef, useState } from 'react';
import { OpenGuest } from '../../components/MiniAppGuest';
import { Button, Dialog, IconButton } from '../../shared/ui';
import { ChevronLeft, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { TitlebarActions } from '../../components/DesktopShell';
import { invoke } from '../../electronBridge';
import { useStore } from '../../store';
import { MiniAppIcon } from '../../components/MiniAppIcon';
import { useMiniAppLibrary, useMiniAppsOwner, type AppInfo } from '../../lib/miniAppLibrary';
import { settingsStorage } from '../../lib/settingsStorage';
import './mini-apps.css';
import { CatalogDetails } from './CatalogDetails';
import { CatalogImage, catalogPackage, useCommunityCatalog } from './CommunityCatalog';
import { PublishMiniApp } from './PublishMiniApp';
import type { CatalogApp } from '../../lib/miniAppLibrary';

type Review = { action: 'install' | 'remove'; app: AppInfo; raw?: string; previousGeneration?: string; publicationId?: string };

export function MiniAppsPage() {
  const scope = useMiniAppsOwner();
  if (!scope) return <section className="mini-apps"><h1>Mini Apps</h1><p>Sign in to manage your mini apps.</p></section>;
  return <LibraryView key={scope} owner={scope} />;
}

function LibraryView({ owner }: { owner: string }) {
  const { library, refresh, loadError } = useMiniAppLibrary(owner);
  const selected = useStore(s => s.selectedMiniApp);
  const setTab = useStore(s => s.setTab);
  const [widgetsOnly, setWidgetsOnly] = useState(false);
  const [review, setReview] = useState<Review>();
  const [guide, setGuide] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState('');
  const community = useCommunityCatalog(owner);
  const [details, setDetails] = useState<CatalogApp>();
  const [railHidden, setRailHidden] = useState(() => settingsStorage.getItem('miniAppRailHidden') === 'true');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const locked = useRef(false);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method .*?: Error: /, '') : 'Mini app action failed.'); }
    finally { locked.current = false; setBusy(false); }
  }
  function open(id?: string) { setTab('mini-apps', id ? { owner, id } : undefined); }
  async function importFile(selected: File) {
    if (selected.size > 256 * 1024) throw Error('Package exceeds 256 KiB.');
    const raw = await selected.text();
    const app = await invoke<AppInfo>('mini_apps_inspect', { raw });
    const previous = library?.installed.find(item => item.id === app.id && item.apiVersion === 1);
    setReview({ action: 'install', app, raw, previousGeneration: previous?.generation });
  }
  async function chooseInstall(app: CatalogApp) {
    if (!app.community) { setReview({action:'install', app}); return; }
    const raw = await catalogPackage(owner, app);
    const info = await invoke<AppInfo>('mini_apps_inspect', {raw});
    if (app.id !== info.id || app.version !== info.version) throw Error('The listing changed. Refresh and try again.');
    const previous = library?.installed.find(item => item.id === app.id && item.sourcePublication === app.publicationId);
    setReview({action:'install', app: info, raw, publicationId:app.publicationId, previousGeneration:previous?.generation});
  }
  async function applyReview() {
    if (!review) return;
    const { action, app, raw } = review;
    if (action === 'remove') {
      await invoke('mini_apps_remove', { owner, id: app.id });
      if (selected?.id === app.id) open();
    } else await invoke('mini_apps_install', { owner, id: app.id, raw, catalog: raw === undefined, previousGeneration: review.previousGeneration, publicationId:review.publicationId });
    setReview(undefined);
    await refresh();
    if (action === 'install') open(app.id);
  }
  const current = selected?.owner === owner ? library?.installed.find(app => app.id === selected.id) : undefined;
  return <section className={current ? 'mini-apps mini-apps-open' : 'mini-apps'} data-rail-hidden={current && railHidden || undefined}>
    {!current && <header className="mini-apps-header"><h1>Mini Apps</h1>
      <div className="mini-apps-header-actions"><Button onClick={() => setPublishing(true)}>Publish mini app</Button><Button onClick={() => setGuide(true)}>Build a mini app</Button>
        <Button disabled={busy} onClick={() => file.current?.click()}>Install from file</Button></div>
      <input ref={file} type="file" hidden accept=".json" aria-label="Mini app package" onChange={e => {
        const selected = e.target.files?.[0]; e.target.value = '';
        if (selected) void run(() => importFile(selected));
      }} /></header>}
    {(error || loadError) && !review && <p role="alert">{error || loadError} <Button onClick={() => void run(refresh)}>Refresh</Button></p>}
    {!library && !error && !loadError && <p role="status">Loading mini apps…</p>}
    {community.error && !current && <p role="status">Community catalog unavailable. {community.error} <Button onClick={community.refresh}>Retry catalog</Button></p>}
    {published && !current && <p role="status">{published} published.</p>}
    {library && <>
      {!current && <nav className="mini-apps-tabs" aria-label="Installed mini apps">
        <Button aria-pressed={!widgetsOnly} onClick={() => setWidgetsOnly(false)}>Catalog</Button>
        <Button aria-pressed={widgetsOnly} onClick={() => setWidgetsOnly(true)}>Widgets</Button>
        {library.installed.map(app => <Button key={app.id} disabled={busy}
          onClick={() => open(app.id)}>{app.name}</Button>)}
      </nav>}
      {current ? <>
        <TitlebarActions><div className="mini-app-titlebar">
          <IconButton label={railHidden ? 'Show navigation rail' : 'Hide navigation rail'} appearance="plain" size="small"
            aria-controls="app-sidebar" aria-expanded={!railHidden} onClick={() => {
              setRailHidden(!railHidden);
              settingsStorage.setItem('miniAppRailHidden', String(!railHidden));
            }}>
            {railHidden ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
          </IconButton>
          <IconButton label="Back to Mini Apps" text="Mini Apps" appearance="plain" size="small" onClick={() => open()}>
            <ChevronLeft size={16} aria-hidden="true" />
          </IconButton>
          <MiniAppIcon app={current} /><h2>{current.name}</h2>
          <label className="mini-apps-pin">Show in rail <span className="toggle">
            <input type="checkbox" role="switch" checked={current.pinned} disabled={busy}
              onChange={event => { const pinned = event.target.checked; void run(async () => {
                await invoke('mini_apps_set_pinned', { owner, id: current.id, pinned });
                await refresh();
              }); }} />
            <span className="toggle-track"><span className="toggle-knob" /></span></span>
          </label>
          <Button onClick={() => setReview({ action: 'remove', app: current })}>Uninstall</Button>
        </div></TitlebarActions>
        <OpenGuest key={current.id} id={current.id} owner={owner} name={current.name} />
      </> : <div className="mini-apps-catalog">{[...library.catalog, ...community.apps].filter(app => !widgetsOnly || app.widgets?.length || app.hasWidgets).map(app => {
        const installed = library.installed.some(item => item.id === app.id);
        const cover = app.listing.screenshots[0];
        return <article key={app.id} className="catalog-card">
          <button className="catalog-card-preview" aria-label={'Preview ' + app.name} onClick={() => setDetails(app)}>
            <CatalogImage owner={owner} app={app} shot={cover} />
          </button>
          <div className="catalog-app-title"><MiniAppIcon app={app} /><h2><button onClick={() => setDetails(app)}>{app.name}</button></h2></div>
          <small className="catalog-author">By {app.listing.author}</small>
          <p>{app.description}</p>
          <div className="catalog-card-actions"><Button disabled={busy} onClick={() => installed ? open(app.id) : void run(() => chooseInstall(app))}>{installed ? 'Open' : 'Install'}</Button>
          {app.community && library.installed.some(item => item.id === app.id && item.sourcePublication === app.publicationId && item.version.localeCompare(app.version, 'en', {numeric:true}) < 0) && <Button disabled={busy} onClick={() => void run(() => chooseInstall(app))}>Update</Button>}
          <Button disabled={busy} onClick={() => void run(async () => invoke('mini_apps_download', { owner, id: app.id, raw: app.community ? await catalogPackage(owner, app) : undefined }))}>Download package</Button>
          </div></article>;
      })}</div>}
    </>}
    {publishing && <PublishMiniApp owner={owner} onClose={() => setPublishing(false)} onPublished={name => {setPublished(name);setPublishing(false);community.refresh();}} />}
    {details && <CatalogDetails owner={owner} app={details} installed={!!library?.installed.some(a => a.id === details.id)} busy={busy} onClose={() => setDetails(undefined)} launch={() => {
      setDetails(undefined);
      if (library?.installed.some(a => a.id === details.id)) open(details.id);
      else void run(() => chooseInstall(details));
    }} />}
    {guide && <Dialog title="Build a mini app" onClose={() => setGuide(false)}>
      <ol><li>Download the Kanban package from the catalog.</li>
        <li>Give it a unique ID and name. Put your interface, scripts and styles in the HTML field.</li>
        <li>Declare every app action in <code>tools</code> and register each with <code>document.modelContext.registerTool()</code>.</li>
        <li>To embed a widget, declare its surfaces, grid limits and a skill explaining how to use its WebMCP tools. Download Music Player for a working example.</li>
        <li>For a catalog listing, credit the author and include two or more screenshots of real screens, descriptive captions, requirements and an example agent request alongside the package.</li>
        <li>Choose Install from file to validate the WebMCP tools and install. Request storage to persist data using <code>/state</code>.</li></ol>
      <Button onClick={() => void run(() => invoke('mini_apps_download', { owner, id: 'kanban' }))}>Download Kanban package</Button>
    </Dialog>}
    {review && <Dialog title={(review.action === 'install' ? 'Install ' : 'Uninstall ') + review.app.name + '?'} onClose={() => { if (!busy) { setReview(undefined); setError(''); } }}>
      <p>{review.app.id} · v{review.app.version}</p>
      {review.action === 'install' && <p>Agent actions: {review.app.tools?.join(', ')}</p>}
      {review.action === 'install' && review.app.skill && <p>{review.app.skill}</p>}
      {review.previousGeneration && <p>This updates the installed app. The new version can access its existing saved data.</p>}
      <p>{review.action === 'remove' ? 'This removes the app and its saved data from this account on this device.'
        : review.app.permissions.includes('storage') ? 'Permission requested: save and read its own data on this device.' : 'No host permissions requested.'}</p>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} onClick={() => void run(applyReview)}>{review.action === 'remove' ? 'Uninstall and delete data' : review.previousGeneration ? 'Upgrade and keep data' : 'Install mini app'}</Button>
    </Dialog>}
  </section>;
}
