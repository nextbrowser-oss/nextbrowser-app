import { useLayoutEffect, useRef, useState } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { invoke } from '../electronBridge';
import { useMiniAppLibrary, useMiniAppsOwner, type GridSize, type WidgetSurface } from '../lib/miniAppLibrary';
import { Button, Dialog, IconButton } from '../shared/ui';
import { OpenGuest } from './MiniAppGuest';
import './panelWidgets.css';

const surfaces = { 'chat.panel': 'Chat panel', 'settings.design': 'Theme settings' } as const;
const cell = 40;
export function PanelWidgets({ surface }: { surface: WidgetSurface }) {
  const owner = useMiniAppsOwner();
  return owner ? <WidgetGrid key={owner} owner={owner} surface={surface} /> : null;
}

function WidgetGrid({ owner, surface }: { owner: string; surface: WidgetSurface }) {
  const { library } = useMiniAppLibrary(owner);
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current!;
    const resize = () => setColumns(Math.min(12, Math.floor(element.clientWidth / cell)));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="panel-widget-grid" ref={ref} style={{ gridTemplateColumns: 'repeat(' + Math.max(1,columns) + ',minmax(0,1fr))' }}>
    {library?.installed?.flatMap(app => (app.widgets ?? []).map(block => {
      const size = app.placements?.[surface + '/' + block.id];
      if (!size || columns < block.grid.min[0]) return null;
      return <div key={app.generation + '/' + block.id} className="panel-widget" style={{ gridColumn: 'span ' + Math.min(columns,size[0]), gridRow: 'span ' + size[1] }}>
        <OpenGuest owner={owner} id={app.id} blockId={block.id} surface={surface} name={block.name} />
      </div>;
    }))}
  </div>;
}

export function WidgetSettingsButton() {
  const [open,setOpen] = useState(false);
  const owner = useMiniAppsOwner();
  return <>
    <IconButton label="Configure panel widgets" className="panel-widgets-trigger" size="small" appearance="embedded" onClick={() => setOpen(true)}>
      <PanelsTopLeft size={15} />
    </IconButton>
    {open && <Dialog title="Panel widgets" onClose={() => setOpen(false)}>
      {owner ? <WidgetSettings owner={owner} key={owner} /> : <p>Sign in to manage widgets for your account.</p>}
    </Dialog>}
  </>;
}

function WidgetSettings({ owner }: { owner: string }) {
  const { library, refresh, loadError } = useMiniAppLibrary(owner);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function change(command: string, args: Record<string,unknown>) {
    setBusy(true); setError('');
    try { await invoke(command,{owner,...args}); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not save widget settings.'); }
    finally { setBusy(false); }
  }
  return <div className="widget-settings">
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    {!library && !loadError && <p>Loading widgets…</p>}
    {library?.catalog?.filter(app => app.widgets?.length && !library.installed.some(a => a.id === app.id)).map(app =>
      <section key={app.id}><strong>{app.name}</strong><p>{app.description}</p>
        <Button disabled={busy} onClick={() => void change('mini_apps_install',{id:app.id, catalog:true})}>Install {app.name}</Button>
      </section>)}
    {library?.installed?.flatMap(app => app.widgets?.map(block => <section key={app.id + '/' + block.id}>
      <strong>{block.name}</strong>
      {block.surfaces.map(surface => {
        const size = app.placements?.[surface + '/' + block.id];
        const save = (next: GridSize | null) => change('mini_apps_set_widget',{id:app.id,blockId:block.id,surface,size:next});
        return <div key={surface} className="widget-placement">
          <label><input type="checkbox" checked={!!size} disabled={busy} onChange={() => void save(size ? null : block.grid.preferred)} /> {surfaces[surface]}</label>
          {size && [0,1].map(axis => <label key={axis}>{axis === 0 ? 'Columns' : 'Rows'}
            <select value={size[axis]} aria-label={block.name + ' ' + surfaces[surface] + (axis === 0 ? ' columns' : ' rows')} disabled={busy}
              onChange={e => { const next: GridSize = [...size]; next[axis] = Number(e.target.value); void save(next); }}>
              {Array.from({length:block.grid.max[axis] - block.grid.min[axis] + 1}, (_,i) => block.grid.min[axis] + i).map(n => <option key={n}>{n}</option>)}
            </select></label>)}
        </div>;
      })}
    </section>) ?? [])}
  </div>;
}
