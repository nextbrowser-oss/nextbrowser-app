import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Grip, Maximize2, Minus, Plus, X } from 'lucide-react';
import { invoke } from '../electronBridge';
import { useMiniAppLibrary, useMiniAppsOwner, type AppInfo, type GridSize, type WidgetBlock, type WidgetSurface } from '../lib/miniAppLibrary';
import { settingsStorage } from '../lib/settingsStorage';
import { arrangeTiles, clampCell, type Anchors, type Cell, type TileRect } from '../lib/widgetLayout';
import { Button, IconButton, Popover, Tooltip } from '../shared/ui';
import { OpenGuest } from './MiniAppGuest';
import './panelWidgets.css';

type Item = { key: string; name: string; size: GridSize; content: ReactNode; block?: WidgetBlock; app?: AppInfo };
export type ComposerControl = Pick<Item, 'key' | 'name' | 'size' | 'content'>;
const step = 38;
const gridKey = (owner: string, surface: WidgetSurface) => 'nextbrowser.appearance.widgetLayout.' + owner + '.' + surface;

function readAnchors(key: string): Anchors {
  try {
    const value = JSON.parse(settingsStorage.getItem(key) ?? '{}');
    return Object.fromEntries(Object.entries(value).filter(([,v]) => {
      const a = v as Anchors[string] | null;
      return a && Number.isSafeInteger(a.x) && Number.isSafeInteger(a.y) && Number.isSafeInteger(a.priority);
    })) as Anchors;
  } catch { return {}; }
}

function WidgetTile({ owner, app, block, surface }: { owner: string; app: AppInfo; block: WidgetBlock; surface: WidgetSurface }) {
  const [open, setOpen] = useState(false);
  const guest = { owner, id: app.id, name: block.name, blockId: block.id, surface };
  return <div className="widget-tile">
    <div className="widget-thumbnail" aria-hidden="true" ref={node => { if (node) node.inert = true; }}>
      <OpenGuest {...guest} />
    </div>
    <Popover open={open} onOpenChange={setOpen} label={block.name} side="top" className="widget-controls-popover"
      trigger={props => <Tooltip content={block.name}><button {...props} aria-label={'Open ' + block.name} className="widget-launch" /></Tooltip>}>
      <header><strong>{block.name}</strong><IconButton label={'Close ' + block.name} size="small" appearance="plain" onClick={() => setOpen(false)}><X size={15}/></IconButton></header>
      <OpenGuest {...guest} popover name={block.name + ' controls'} />
    </Popover>
  </div>;
}

export function PanelWidgets({ surface, controls = [], editing = false }: { surface: WidgetSurface; controls?: ComposerControl[]; editing?: boolean }) {
  const owner = useMiniAppsOwner();
  return <WidgetGrid key={(owner ?? '') + surface} owner={owner} surface={surface} controls={controls} editing={editing} />;
}

function WidgetGrid({ owner, surface, controls, editing }: { owner?: string; surface: WidgetSurface; controls: ComposerControl[]; editing: boolean }) {
  const { library, refresh } = useMiniAppLibrary(owner);
  const ref = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(12);
  const key = gridKey(owner ?? 'guest', surface);
  const [anchors, setAnchors] = useState(() => readAnchors(key));
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ key: string; rect: TileRect } | null>(null);
  const gesture = useRef<{ pointer: number; key: string; resize: boolean; start: TileRect; current: TileRect; px: number; py: number; pitch: number; rows: number }>();
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => setColumns(Math.max(1, Math.floor((element.clientWidth + 4) / step)));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { gesture.current = undefined; setDrag(null); }, [editing, columns]);
  const items: Item[] = [...controls];
  for (const app of library?.installed ?? []) for (const block of app.widgets ?? []) {
    const size = app.placements?.[surface + '/' + block.id];
    if (owner && size && columns >= block.grid.min[0]) items.push({key:app.generation + '/' + block.id, name:block.name, size, block, app,
      content:<WidgetTile owner={owner} app={app} block={block} surface={surface} />});
  }
  const rects = arrangeTiles(items.map(item => drag?.key === item.key ? { ...item, size: [drag.rect.w, drag.rect.h] } : item), columns,
    drag ? { ...anchors, [drag.key]: { ...drag.rect, priority: Number.MAX_SAFE_INTEGER } } : anchors);
  const usedRows = Math.max(1, ...Array.from(rects.values(), r => r.y + r.h));
  function place(id: string, cell: Cell) {
    const next = { ...readAnchors(key), [id]: { ...cell, priority: Date.now() } };
    for (const old of Object.keys(next)) if (!items.some(item => item.key === old) && !library?.installed.some(a => old.startsWith(a.generation + '/'))) delete next[old];
    settingsStorage.setItem(key, JSON.stringify(next)); setAnchors(next);
  }
  async function save(item: Item, start: TileRect, rect: TileRect, resizing: boolean) {
    setError('');
    try {
      if (resizing && item.block && item.app) {
        const size: GridSize = [rect.w === start.w ? item.size[0] : rect.w, rect.h];
        if (size[0] !== item.size[0] || size[1] !== item.size[1]) {
          await invoke('mini_apps_set_widget', { owner, id:item.app.id, blockId:item.block.id, surface, size });
          await refresh();
        }
      }
      if (rect.x !== start.x || rect.y !== start.y) place(item.key, { x:rect.x, y:rect.y });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this layout.'); }
  }
  function constrained(item: Item, r: TileRect, dx: number, dy: number, resize: boolean, rows: number): TileRect {
    if (resize && item.block) {
      const {min,max} = item.block.grid;
      return { ...r, w:clampCell(r.w + dx,min[0],Math.min(columns - r.x,max[0])), h:clampCell(r.h + dy,min[1],max[1]) };
    }
    return { ...r, x:clampCell(r.x + dx,0,columns - r.w), y:clampCell(r.y + dy,0,Math.min(64,rows)) };
  }
  function pointerDown(e: PointerEvent<HTMLButtonElement>, item: Item, resize: boolean) {
    if (e.button !== 0 || !e.isPrimary || !editing || gesture.current) return;
    const start = rects.get(item.key)!;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointer:e.pointerId, key:item.key, resize, start, current:start, px:e.clientX, py:e.clientY, pitch:(ref.current!.clientWidth + 4) / columns, rows:usedRows };
    e.preventDefault();
  }
  function pointerMove(e: PointerEvent<HTMLButtonElement>, item: Item) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId || g.key !== item.key) return;
    const dx = Math.round((e.clientX - g.px) / g.pitch), dy = Math.round((e.clientY - g.py) / step);
    g.current = constrained(item, g.start, dx, dy, g.resize, g.rows);
    setDrag({key:item.key, rect:g.current});
  }
  function finish(e: PointerEvent<HTMLButtonElement>, item: Item, commit: boolean) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId || g.key !== item.key) return;
    gesture.current = undefined;
    if (!commit) { setDrag(null); return; }
    const dx = Math.round((e.clientX - g.px) / g.pitch), dy = Math.round((e.clientY - g.py) / step);
    const rect = constrained(item, g.start, dx, dy, g.resize, g.rows);
    const final = {key:item.key, rect};
    setDrag(final);
    void save(item, g.start, rect, g.resize).finally(() => setDrag(current => current === final ? null : current));
  }
  function handleKeys(e: KeyboardEvent, item: Item, resize: boolean) {
    const directions: Record<string, GridSize> = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
    const d = directions[e.key]; if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const r = rects.get(item.key)!;
    void save(item, r, constrained(item,r,d[0],d[1],resize,usedRows), resize);
  }
  function handle(item: Item, resize: boolean) {
    const label = (resize ? 'Resize ' : 'Move ') + item.name;
    return <Tooltip content={label + ' · drag or use arrow keys'}><button type="button" aria-label={label}
      className={resize ? 'widget-resize' : 'widget-move'}
      onPointerDown={e => pointerDown(e,item,resize)} onPointerMove={e => pointerMove(e,item)}
      onPointerUp={e => finish(e,item,true)} onPointerCancel={e => finish(e,item,false)} onLostPointerCapture={e => finish(e,item,false)}
      onKeyDown={e => handleKeys(e,item,resize)}>{resize ? <Maximize2 size={12}/> : <Grip size={12}/>}</button></Tooltip>;
  }
  return <div className="composer-widget-region" data-surface={surface}>
    <div ref={ref} className="panel-widget-grid" data-editing={editing || undefined} aria-label="Widget grid"
      style={{ '--widget-cols': columns, gridTemplateRows: editing ? 'repeat(' + (gesture.current ? Math.max(usedRows, gesture.current.rows + 1) : usedRows + 1) + ',34px)' : undefined } as CSSProperties}>
      {items.map(item => {
        const r = rects.get(item.key)!;
        return <div key={item.key} className={'panel-widget' + (item.block ? ' is-widget' : ' is-control')} data-tile={item.name}
          style={{gridColumn:(r.x + 1) + ' / span ' + r.w, gridRow:(r.y + 1) + ' / span ' + r.h}}>
          <div className="widget-face" ref={el => { if (el) el.inert = editing; }}>{item.content}</div>
          {editing && <>{handle(item,false)}{item.block && handle(item,true)}</>}
        </div>;
      })}
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function WidgetPicker({ surface = 'chat.panel' }: { surface?: WidgetSurface }) {
  const owner = useMiniAppsOwner();
  return owner ? <WidgetOptions key={owner} owner={owner} surface={surface}/> : null;
}

function WidgetOptions({ owner, surface }: { owner: string; surface: WidgetSurface }) {
  const { library, refresh, loadError } = useMiniAppLibrary(owner);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function toggle(app: AppInfo, block: WidgetBlock, installed: boolean, enabled: boolean) {
    setBusy(true); setError('');
    try {
      if (!installed) await invoke('mini_apps_install',{ owner, id: app.id, catalog:true });
      await invoke('mini_apps_set_widget',{ owner, id:app.id, blockId:block.id, surface, size:enabled ? null : block.grid.preferred });
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update this widget.'); }
    finally { setBusy(false); }
  }
  const choices = [...library?.installed ?? [], ...library?.catalog.filter(app => !library.installed.some(a => a.id === app.id)) ?? []];
  return <section className="composer-widget-picker" aria-label="Widgets"><h3>Widgets</h3>
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    {choices.flatMap(app => app.widgets?.filter(b => b.surfaces.includes(surface)).map(block => {
      const saved = library!.installed.find(a => a.id === app.id);
      const enabled = !!saved?.placements?.[surface + '/' + block.id];
      const label = enabled ? 'Remove' : saved ? 'Add' : 'Install and add';
      return <div key={app.id + '/' + block.id}><span><strong>{block.name}</strong><small>{app.name}</small></span>
        <Button aria-label={label + ' ' + block.name} disabled={busy} onClick={() => void toggle(app,block,!!saved,enabled)}>
          {enabled ? <Minus size={14}/> : <Plus size={14}/>} {label}
        </Button></div>;
    }) ?? [])}
  </section>;
}
