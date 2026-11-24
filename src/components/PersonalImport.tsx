import { useEffect, useRef, useState } from "react";
import { invoke } from "../electronBridge";
import { Button, Select } from "../shared/ui";

export const categories = { bookmarks: "Bookmarks", history: "Browsing and download history", tabs: "Open tabs", favicons: "Site icons", topSites: "Frequently visited sites" };
export type Category = keyof typeof categories;
export interface PersonalProfile {
  id: string; name: string; imported: Category[];
  source?: {id: string};
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
const label = (s: Source) => s.browser + " · " + s.name;

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
      setSources(result.sources); setUnavailable(result.unavailable); setUnsupported(result.unsupported);
      choose(result.sources.find(s => s.id === preferred) ?? result.sources.find(s => Object.keys(s.items).length) ?? result.sources[0]);
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
      <Button type="button" disabled={locked} onClick={() => void scan(active)}>Scan again</Button>
      <Button type="button" disabled={locked} onClick={() => void pickFolder()}>Choose another folder…</Button>
      <Button type="button" disabled={locked} onClick={onRestore}>Restore from archive…</Button>
    </div>
    {sources.length > 0 ? <><p>{sources.length === 1 ? "1 browser profile found" : sources.length + " browser profiles found"}</p>
      <Select label="Browser profile on this device" value={active}
      options={sources.map(s => ({value:s.id,label:label(s)}))} disabled={locked}
      onChange={id => { choose(sources.find(s => s.id === id)); setError(""); }} /></>
      : <p>{pending ? "Scanning local browser profiles…" : "No supported browser profiles found. Choose a Chromium profile folder to scan it."}</p>}
    {unavailable.length > 0 && <p>Could not scan: {unavailable.join(", ")}.</p>}
    {unsupported.length > 0 && <p>Detected without automatic import support: {unsupported.join(", ")}.</p>}
    {source && <>
      <fieldset className="personal-source-items" aria-label="Data to import">
        {kinds.map(kind => {
          const item = source.items[kind];
          return <label key={kind}><input type="checkbox" aria-label={categories[kind]}
            disabled={locked || !item || item.busy || item.unreadable || item.imported} checked={!!item?.imported || selected.includes(kind)}
            onChange={e => setSelected(list => e.target.checked ? [...list,kind] : list.filter(k => k !== kind))}/>
            <span>{categories[kind]}</span><small>{!item ? "No data found" : item.imported ? "Imported" : item.unreadable ? "Unreadable" : item.busy ? "Close browser and rescan" : item.updated ? "Changed since import" : "Available"}</small>
          </label>;
        })}
      </fieldset>
      <label>New personal profile name<input maxLength={80} required value={name} disabled={locked} onChange={e => setName(e.target.value)} /></label>
      <p>Selected data is copied to a new local profile with an encrypted backup. Sign in to websites separately in that profile.</p>
      <Button type="submit" disabled={locked || !name.trim() || !selected.length}>Import selected data</Button>
    </>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
