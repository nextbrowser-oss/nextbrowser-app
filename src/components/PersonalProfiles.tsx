import { useEffect, useRef, useState } from "react";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { Button } from "../shared/ui";

const categories = { bookmarks: "Bookmarks", history: "Browsing and download history", tabs: "Open tabs", favicons: "Site icons", topSites: "Frequently visited sites" };
type Category = keyof typeof categories;
interface Profile { id: string; name: string; imported: Category[] }
const all = Object.keys(categories) as Category[];

export function PersonalProfiles({ owner }: { owner: string }) {
  const workspaceId = useStore(s => s.activeWorkspaceId);
  const [profiles,setProfiles] = useState<Profile[]>([]);
  const [form,setForm] = useState(false);
  const [name,setName] = useState("Personal");
  const [selected,setSelected] = useState<Category[]>(all);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const generation = useRef(0);
  const scope = { workspaceId, owner: "account/" + owner };
  useEffect(() => {
    let alive = true;
    generation.current++;
    setBusy(false); setNotice(""); setError("");
    // Let the shell publish its account/workspace scope in this React commit first.
    if (workspaceId) void Promise.resolve().then(() => invoke<Profile[]>("personal_profiles_list", { workspaceId, owner: "account/" + owner }))
      .then(list => { if (alive) setProfiles(list); }).catch(e => { if (alive) setError(String(e.message)); });
    return () => { alive = false; generation.current++; };
  }, [workspaceId, owner]);
  async function run(action: "import" | "open" | "native_import", id?: string) {
    const seq = generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!id) {
        const profile = await invoke<Profile | null>("personal_profiles_" + action, { ...scope, name, selected });
        if (seq !== generation.current || !profile) return;
        setProfiles(list => [...list,profile]); setForm(false);
        const missing = selected.filter(kind => !profile.imported.includes(kind));
        setNotice(action === "native_import" ? "Complete the import in the browser window." :
          "Imported: " + profile.imported.map(kind => categories[kind]).join(", ") + "." +
          (missing.length ? " Unavailable in this profile: " + missing.map(kind => categories[kind]).join(", ") + "." : ""));
      } else await invoke("personal_profiles_" + action,{...scope,id});
    } catch (e) { if (seq === generation.current) setError(e instanceof Error ? e.message : "Could not open the profile."); }
    finally { if (seq === generation.current) setBusy(false); }
  }
  return <section className="personal-profiles claw-card">
    <header><h3>Personal browser profiles</h3><Button disabled={busy || !workspaceId} aria-expanded={form} onClick={() => setForm(!form)}>{form ? "Cancel" : "Import browser data"}</Button></header>
    {form && <form className="personal-import" onSubmit={e => { e.preventDefault(); void run("import"); }}>
      <label>Profile name<input autoFocus required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label>
      <fieldset aria-label="Data to import">{all.map(kind => <label key={kind}><input type="checkbox" checked={selected.includes(kind)} onChange={e =>
        setSelected(values => e.target.checked ? [...values,kind] : values.filter(v => v !== kind))} /> {categories[kind]}</label>)}</fieldset>
      <p>Choose the profile folder from Chrome, Edge, Brave or Chromium. Find its path on the browser’s version page. Close the source browser before importing.</p>
      <div className="personal-profile-actions">
        <Button type="submit" disabled={busy || !name.trim() || !selected.length}>{busy ? "Opening…" : "Import selected from folder…"}</Button>
        <Button type="button" disabled={busy || !name.trim()} onClick={() => void run("native_import")}>Use browser’s import wizard…</Button>
      </div>
    </form>}
    {profiles.map(p => <div className="personal-profile-row" key={p.id}><span>{p.name}<small>Personal · This device</small></span><div className="personal-profile-actions"><Button disabled={busy} onClick={() => void run("native_import",p.id)}>Import more…</Button><Button disabled={busy} onClick={() => void run("open",p.id)}>Open profile</Button></div></div>)}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
