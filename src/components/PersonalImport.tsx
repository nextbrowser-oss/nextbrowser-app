import { useEffect, useId, useRef, useState } from "react";
import { ArchiveRestore, Bookmark, ChevronRight, Clock3, Download, Flame, FolderOpen, Globe, Image, PanelsTopLeft, RefreshCw, TrendingUp } from "lucide-react";
import { invoke } from "../electronBridge";
import { Button } from "../shared/ui";

export const categories = { bookmarks: "Bookmarks", history: "Browsing and download history", tabs: "Open tabs", favicons: "Site icons", topSites: "Frequently visited sites" };
export type Category = keyof typeof categories;
export interface PersonalProfile {
  id: string; name: string; imported: Category[];
  source?: {id: string; browser?: string};
  backup?: {archivePath: string; keyPath: string};
  pendingBackup?: boolean;
}
interface Source {
  id: string; browser: string; name: string;
  items: Partial<Record<Category,{busy?: boolean; imported: boolean; updated?: boolean; unreadable?: boolean}>>;
}
interface Props {
  workspaceId: string; owner: string; initialSource?: string; disabled: boolean;
  onSaved: (profile: PersonalProfile) => void; onRestore: () => void; onBusy: (pending: boolean) => void;
}
const kinds = Object.keys(categories) as Category[];
const categoryIcons = { bookmarks:Bookmark, history:Clock3, tabs:PanelsTopLeft, favicons:Image, topSites:TrendingUp };
export const categoryLabel = (kind:Category,browser?:string) => browser === "Firefox" && kind === "history" ? "Browsing history" : categories[kind];
const label = (s: Source) => s.browser + " · " + s.name;
const readyCount = (s: Source) => Object.values(s.items).filter(item => item && !item.busy && !item.unreadable && !item.imported).length;

export function PersonalImport({workspaceId,owner,initialSource,disabled,onSaved,onRestore,onBusy}: Props) {
  const [sources,setSources] = useState<Source[]>([]);
  const [active,setActive] = useState("");
  const [name,setName] = useState("");
  const [selected,setSelected] = useState<Category[]>([]);
  const [pending,setPending] = useState(true);
  const [error,setError] = useState("");
  const [unavailable,setUnavailable] = useState<string[]>([]);
  const [unsupported,setUnsupported] = useState<string[]>([]);
  const generation = useRef(0);
  const statusId = useId();
  const scope = {workspaceId,owner:"account/"+owner};
  const source = sources.find(s => s.id === active);
  const locked = pending || disabled;
  useEffect(() => { onBusy(pending); return () => onBusy(false); }, [pending,onBusy]);
  function choose(s?: Source) {
    setActive(s?.id ?? ""); setName(s ? label(s).slice(0,80) : ""); setSelected([]);
  }
  async function scan(preferred?: string) {
    const ticket = ++generation.current;
    setPending(true); setError("");
    try {
      const result = await invoke<{sources:Source[];unavailable:string[];unsupported:string[]}>("personal_profiles_scan",scope);
      if (ticket !== generation.current) return;
      const ranked = [...result.sources].sort((a,b) => readyCount(b) - readyCount(a));
      setSources(ranked); setUnavailable(result.unavailable); setUnsupported(result.unsupported);
      choose(ranked.find(s => s.id === preferred) ?? ranked[0]);
    } catch (e) { if (ticket === generation.current) setError((e as Error).message); }
    finally { if (ticket === generation.current) setPending(false); }
  }
  useEffect(() => {
    void scan(initialSource);
    return () => { generation.current++; };
  }, [workspaceId,owner,initialSource]); // A new account starts a separate scan.
  async function pickFolder() {
    const ticket = ++generation.current;
    setPending(true); setError("");
    try {
      const picked = await invoke<Source | null>("personal_profiles_choose_source",scope);
      if (ticket !== generation.current || !picked) return;
      setSources(list => [...list.filter(s => s.id !== picked.id),picked]); choose(picked);
    } catch (e) { if (ticket === generation.current) setError((e as Error).message); }
    finally { if (ticket === generation.current) setPending(false); }
  }
  async function save() {
    if (locked || !source || !selected.length) return;
    const ticket = ++generation.current;
    setPending(true); setError("");
    try {
      const profile = await invoke<PersonalProfile>("personal_profiles_import_source",{...scope,sourceId:source.id,selected,name});
      if (ticket !== generation.current) return;
      onSaved(profile);
      await scan(source.id);
    } catch (e) { if (ticket === generation.current) setError((e as Error).message); }
    finally { if (ticket === generation.current) setPending(false); }
  }

  return <form className="personal-import" aria-label="Import browser data" aria-busy={pending} onSubmit={e => { e.preventDefault(); void save(); }}>
    <div className="personal-profile-actions">
      <Button disabled={locked} onClick={() => void scan(active)}><RefreshCw/>Scan again</Button>
      <Button disabled={locked} onClick={() => void pickFolder()}><FolderOpen/>Choose another folder…</Button>
      <Button disabled={locked} onClick={onRestore}><ArchiveRestore/>Restore from archive…</Button>
    </div>
    {unavailable.length > 0 && <p>Could not scan {unavailable.join(", ")}.</p>}
    {unsupported.length > 0 && <p>Automatic import is unavailable for {unsupported.join(", ")}.</p>}
    {source ? <div className="personal-source-layout">
      <div className="personal-source-column">
        <h4>Browser profiles <span>{sources.length}</span></h4>
        <ul aria-label="Browser profiles on this device" className="personal-source-list">
          {sources.map(s => {
            const Icon = s.browser === "Firefox" ? Flame : Globe;
            return <li key={s.id}><button type="button" aria-pressed={s.id === active} disabled={locked}
              onClick={() => { if (s.id !== active) choose(s); setError(""); }}>
              <Icon size={17} aria-hidden="true"/>
              <span><strong>{s.name}</strong><small>{s.browser} · {readyCount(s)} available</small></span>
              {s.id === active && <ChevronRight size={15} aria-hidden="true"/>}
            </button></li>;
          })}
        </ul>
      </div>
      <div className="personal-source-detail">
        <fieldset className="personal-source-items">
          <legend>Data to import</legend>
          {kinds.filter(kind => source.browser !== "Firefox" || ["bookmarks","history","tabs"].includes(kind)).map(kind => {
            const item = source.items[kind];
            const title = categoryLabel(kind,source.browser);
            const status = !item ? "No data found" : item.imported ? "Imported" : item.unreadable ? "Unreadable" : item.busy ? "Close browser and rescan" : item.updated ? "Changed since import" : "Available";
            const Icon = categoryIcons[kind];
            return <label key={kind} className="personal-data-row">
              <Icon size={15} aria-hidden="true"/><span>{title}</span><small id={statusId + kind}>{status}</small>
              <span className="toggle"><input type="checkbox" role="switch" aria-label={title} aria-describedby={statusId + kind}
                disabled={locked || !item || item.busy || item.unreadable || item.imported} checked={!!item?.imported || selected.includes(kind)}
                onChange={e => { const checked = e.target.checked; setSelected(list => checked ? [...list,kind] : list.filter(k => k !== kind)); }}/>
                <span className="toggle-track"><span className="toggle-knob"/></span>
              </span>
            </label>;
          })}
        </fieldset>
        <label className="personal-profile-name">New personal profile name
          <input className="shared-text-field" maxLength={80} required value={name} disabled={locked} onChange={e => setName(e.target.value)}/>
        </label>
        <div className="personal-import-footer">
          <p>Saved on this device with an encrypted backup. Websites will ask you to sign in again.</p>
          <Button type="submit" className="primary" disabled={locked || !name.trim() || !selected.length}><Download/>Import selected data</Button>
        </div>
      </div>
    </div> : <p>{pending ? "Scanning local browser profiles…" : "No browser profiles found. Choose a Firefox or Chromium profile folder to scan."}</p>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
