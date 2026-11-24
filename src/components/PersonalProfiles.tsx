import { useEffect, useRef, useState } from "react";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { Button } from "../shared/ui";
import { categories, PersonalImport, type PersonalProfile as Profile } from "./PersonalImport";

export function PersonalProfiles({ owner }: { owner: string }) {
  const workspaceId = useStore(s => s.activeWorkspaceId);
  const [profiles,setProfiles] = useState<Profile[]>([]);
  const [form,setForm] = useState(false);
  const [initialSource,setInitialSource] = useState<string>();
  const [scanning,setScanning] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [expanded,setExpanded] = useState<string>();
  const generation = useRef(0);
  const scope = { workspaceId, owner: "account/" + owner };
  useEffect(() => {
    let alive = true;
    generation.current++;
    setProfiles([]); setExpanded(undefined); setForm(false); setInitialSource(undefined); setBusy(false); setNotice(""); setError("");
    // Let the shell publish its account/workspace scope in this React commit first.
    let revision = 0;
    async function refresh(completed?: unknown) {
      const ticket = ++revision;
      try {
        const list = await invoke<Profile[]>("personal_profiles_list", { workspaceId, owner: "account/" + owner });
        if (!alive || ticket !== revision) return;
        setProfiles(list);
        if (typeof completed === "string" && list.some(p => p.id === completed && p.backup)) setExpanded(completed);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "Could not load personal profiles."); }
    }
    if (workspaceId) void Promise.resolve().then(() => { if (alive) return refresh(); });
    const unsubscribe = window.nextbrowser?.on("personal-profiles:changed", refresh);
    return () => { alive = false; generation.current++; unsubscribe?.(); };
  }, [workspaceId, owner]);
  async function run(action: "open" | "backup" | "restore" | "reveal", id?: string, file?: "archive" | "key") {
    const seq = generation.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const args = {...scope,id,file};
      if (action === "open" || action === "reveal") { await invoke("personal_profiles_" + action,args); return; }
      const profile = await invoke<Profile | null>("personal_profiles_" + action,args);
      if (seq !== generation.current || !profile) return;
      setProfiles(list => [...list.filter(p => p.id !== profile.id),profile]);
      setForm(false);
      if (profile.backup) setExpanded(profile.id);
      setNotice(action === "restore" ? "Restored into a separate personal profile." : "Encrypted archive saved.");
    } catch (e) { if (seq === generation.current) setError(e instanceof Error ? e.message : "Could not open the profile."); }
    finally { if (seq === generation.current) setBusy(false); }
  }
  return <section className="personal-profiles claw-card">
    <header><h3>Personal browser profiles</h3><Button disabled={busy || scanning || !workspaceId} aria-expanded={form} onClick={() => { setInitialSource(undefined); setForm(!form); }}>{form ? "Close import" : "Import browser data"}</Button></header>
    {form && workspaceId && <PersonalImport workspaceId={workspaceId} owner={owner} initialSource={initialSource} disabled={busy}
      onBusy={setScanning} onRestore={() => void run("restore")} onSaved={profile => {
        setProfiles(list => [...list.filter(p => p.id !== profile.id),profile]);
        setExpanded(profile.id); setError("");
        setNotice("Imported: " + profile.imported.map(kind => categories[kind]).join(", ") + ".");
      }}/>}
    {profiles.map(p => <div key={p.id}>
      <div className="personal-profile-row">
        <span>{p.name}<small>Personal · This device</small></span>
        <div className="personal-profile-actions">
          {p.backup && <Button aria-expanded={expanded === p.id} onClick={() => setExpanded(expanded === p.id ? undefined : p.id)}>Recovery files</Button>}
          {(!p.backup || p.pendingBackup) && <Button disabled={busy} onClick={() => void run("backup",p.id)}>{p.pendingBackup ? "Finish backup" : "Create encrypted archive"}</Button>}
          <Button disabled={busy || scanning} onClick={() => { setInitialSource(p.source?.id); setForm(true); }}>Scan browser data…</Button>
          <Button disabled={busy || scanning} onClick={() => void run("open",p.id)}>Open profile</Button>
        </div>
      </div>
      {p.backup && expanded === p.id && <section className="personal-recovery" aria-label="Recovery files">
        <p>Only someone with the key file can decrypt the archive. Save the key separately and keep both files for recovery. Nextbrowser cannot replace a lost key.</p>
        <div><span>Encrypted archive<code>{p.backup.archivePath}</code></span><Button disabled={busy} onClick={() => void run("reveal",p.id,"archive")}>Show archive</Button></div>
        <div><span>Recovery key<code>{p.backup.keyPath}</code></span><Button disabled={busy} onClick={() => void run("reveal",p.id,"key")}>Show key</Button></div>
      </section>}
    </div>)}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
