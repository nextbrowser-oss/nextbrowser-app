import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Grip, Maximize2, Minus, Plus, X } from 'lucide-react';
import { invoke } from '../electronBridge';
import { useMiniAppLibrary, useMiniAppsOwner, type AppInfo, type GridSize, type WidgetBlock, type WidgetSurface } from '../lib/miniAppLibrary';
import { settingsStorage } from '../lib/settingsStorage';
import { arrangeTiles, clampCell, type Anchors, type TileRect } from '../lib/widgetLayout';
import { Button, IconButton, Popover, Tooltip } from '../shared/ui';
import { OpenGuest } from './MiniAppGuest';
import './panelWidgets.css';

export type ComposerControl = { key: string; name: string; content: ReactNode };
type Item = ComposerControl & { size: GridSize; block?: WidgetBlock; app?: AppInfo };
const step = 38;
const gap = 4;
type Layout = Record<string, Anchors[string] & { size?: GridSize }>;
const gridKey = (owner: string, surface: WidgetSurface) => 'nextbrowser.appearance.widgetLayout.' + owner + '.' + surface;

function readLayout(key: string): Layout {
  try {
    const value = JSON.parse(settingsStorage.getItem(key) ?? '{}');
    const pixels = value.version === 2;
    const entries: Layout = {};
    for (const [id,v] of Object.entries(pixels ? value.items : value)) {
      const a = v as Anchors[string] | null;
      if (!a || !Number.isSafeInteger(a.x) || !Number.isSafeInteger(a.y) || !Number.isSafeInteger(a.priority)) continue;
      const size = (v as Layout[string]).size;
      const validSize = pixels && Array.isArray(size) && size.length === 2 && size.every(n => Number.isSafeInteger(n) && n > 0);
      entries[id] = { x: pixels ? a.x : a.x * step, y:a.y, priority:a.priority, ...(validSize ? {size} : {}) };
    }
    return entries;
  } catch { return {}; }
}

function ControlFace({ item, editing, sized, onMeasure }: { item: Item; editing: boolean; sized: boolean; onMeasure: (key: string, width: number) => void }) {
  const face = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (sized) return;
    const content = face.current;
    if (!content) return;
    const measure = () => {
      const width = Math.ceil(parseFloat(getComputedStyle(content).width));
      if (width > 0) onMeasure(item.key, width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content, {box:'border-box'});
    return () => observer.disconnect();
  }, [item.key, sized, onMeasure]);
  useLayoutEffect(() => { if (face.current) face.current.inert = editing; }, [editing]);
  return <div ref={face} className="widget-face">{item.content}</div>;
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
  const [width, setWidth] = useState(1);
  const key = gridKey(owner ?? 'guest', surface);
  const [anchors, setAnchors] = useState(() => readLayout(key));
  const [measured, setMeasured] = useState<Record<string,number>>({});
  const measureButton = useCallback((id: string, value: number) => {
    setMeasured(prev => prev[id] === value ? prev : {...prev,[id]:value});
  }, []);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<{ key: string; rect: TileRect } | null>(null);
  const gesture = useRef<{ pointer: number; key: string; resize: boolean; start: TileRect; px: number; py: number; rows: number }>();
  useLayoutEffect(() => {
    const element = ref.current!;
    const measure = () => setWidth(Math.max(1, element.clientWidth + gap));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => { gesture.current = undefined; setDrag(null); }, [editing, width]);
  // Widths include the trailing gutter. Controls fit their text, while widget manifests use whole grid cells.
  const items: Item[] = controls.map(control => ({...control, size: anchors[control.key]?.size ?? [(measured[control.key] ?? 32) + gap,1]}));
  for (const app of library?.installed ?? []) for (const block of app.widgets ?? []) {
    const size = app.placements?.[surface + '/' + block.id];
    if (owner && size && width >= step * block.grid.min[0]) items.push({key:app.generation + '/' + block.id, name:block.name, size:[size[0] * step,size[1]], block, app,
      content:<WidgetTile owner={owner} app={app} block={block} surface={surface} />});
  }
  const rects = arrangeTiles(items.map(item => drag?.key === item.key ? { ...item, size: [drag.rect.w, drag.rect.h] } : item), width,
    drag ? { ...anchors, [drag.key]: { ...drag.rect, priority: Number.MAX_SAFE_INTEGER } } : anchors);
  const usedRows = Math.max(1, ...Array.from(rects.values(), r => r.y + r.h));
  function place(id: string, rect: TileRect, size?: GridSize) {
    const next = readLayout(key);
    next[id] = { ...next[id], x:rect.x, y:rect.y, priority: Date.now(), ...(size ? {size} : {}) };
    for (const old of Object.keys(next)) if (!items.some(item => item.key === old) && !library?.installed.some(a => old.startsWith(a.generation + '/'))) delete next[old];
    settingsStorage.setItem(key, JSON.stringify({ version:2, items:next })); setAnchors(next);
  }
  async function save(item: Item, start: TileRect, rect: TileRect, resizing: boolean) {
    if (rect.x === start.x && rect.y === start.y && rect.w === start.w && rect.h === start.h) return;
    setError('');
    try {
      if (resizing && item.block && item.app) {
        const size: GridSize = [Math.round((rect.w === start.w ? item.size[0] : rect.w) / step), rect.h];
        await invoke('mini_apps_set_widget', { owner, id:item.app.id, blockId:item.block.id, surface, size });
        await refresh();
      }
      place(item.key, rect, resizing && !item.block ? [rect.w,rect.h] : undefined);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this layout.'); }
  }
  function constrained(item: Item, r: TileRect, dx: number, dy: number, resize: boolean, rows: number): TileRect {
    if (resize && item.block) {
      const {min,max} = item.block.grid;
      const cells = clampCell(Math.round((r.w + dx) / step),min[0],Math.min(Math.floor((width - r.x) / step),max[0]));
      return { ...r, w:cells * step, h:clampCell(r.h + dy,min[1],max[1]) };
    }
    if (resize) return { ...r, w:clampCell(r.w + dx, Math.min(step,width - r.x), width - r.x), h:clampCell(r.h + dy,1,4) };
    return { ...r, x:clampCell(r.x + dx,0,width - r.w), y:clampCell(r.y + dy,0,Math.min(64,rows)) };
  }
  function pointerDown(e: PointerEvent<HTMLButtonElement>, item: Item, resize: boolean) {
    if (e.button !== 0 || !e.isPrimary || !editing || gesture.current) return;
    const start = rects.get(item.key)!;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { pointer:e.pointerId, key:item.key, resize, start, px:e.clientX, py:e.clientY, rows:usedRows };
    e.preventDefault();
  }
  function pointerMove(e: PointerEvent<HTMLButtonElement>, item: Item) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId || g.key !== item.key) return;
    const dx = Math.round(e.clientX - g.px), dy = Math.round((e.clientY - g.py) / step);
    setDrag({key:item.key, rect:constrained(item, g.start, dx, dy, g.resize, g.rows)});
  }
  function finish(e: PointerEvent<HTMLButtonElement>, item: Item, commit: boolean) {
    const g = gesture.current;
    if (!g || g.pointer !== e.pointerId || g.key !== item.key) return;
    gesture.current = undefined;
    if (!commit) { setDrag(null); return; }
    const dx = Math.round(e.clientX - g.px), dy = Math.round((e.clientY - g.py) / step);
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
    void save(item, r, constrained(item,r,d[0] * (item.block ? step : 8),d[1],resize,usedRows), resize);
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
      style={{height: usedRows * step - gap}}>
      {items.map(item => {
        const r = rects.get(item.key)!;
        const resizing = drag?.key === item.key && gesture.current?.resize;
        const sized = !!anchors[item.key]?.size || !!resizing || (width > gap && r.w < item.size[0]);
        const inset = item.block ? 0 : 3;
        return <div key={item.key} className={'panel-widget' + (item.block ? ' is-widget' : ' is-control')} data-tile={item.name}
          data-sized={sized || undefined} data-icon-only={!item.block && sized && r.w <= step + gap || undefined}
          style={{ left:r.x, top:r.y * step + inset, width:Math.max(1,r.w - gap), height:r.h * step - gap - 2 * inset }}>
          {item.block ? <div className="widget-face" ref={el => { if (el) el.inert = editing; }}>{item.content}</div>
            : <ControlFace item={item} editing={editing} sized={sized} onMeasure={measureButton}/>}
          {editing && <>{handle(item,false)}{handle(item,true)}</>}
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
