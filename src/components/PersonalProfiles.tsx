import { translate } from "../shared/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { AppWindow, Archive, Download, Ellipsis, FolderKey, Monitor, ScanSearch, X } from "lucide-react";
import { Menu, MenuItem, MenuTrigger, Popover, Pressable } from "react-aria-components";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { Button, glassSurfaceClassName, IconButton } from "../shared/ui";
import { categoryLabel, PersonalImport, type PersonalProfile as Profile } from "./PersonalImport";

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
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : translate("Could not load personal profiles.")); }
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
      setNotice(action === "restore" ? translate("Restored into a separate personal profile.") : translate("Encrypted archive saved."));
    } catch (e) { if (seq === generation.current) setError(e instanceof Error ? e.message : translate("Could not open the profile.")); }
    finally { if (seq === generation.current) setBusy(false); }
  }
  return <section className="personal-profiles account-network-section">
    <header><h3>{translate("Personal browser profiles")}</h3><Button className="personal-import-trigger" disabled={busy || scanning || !workspaceId} aria-expanded={form} onClick={() => { setInitialSource(undefined); setForm(!form); }}>
      {form ? <X size={14} aria-hidden="true"/> : <Download size={14} aria-hidden="true"/>}{form ? translate("Close import") : translate("Import browser data")}
    </Button></header>
    {form && workspaceId && <PersonalImport workspaceId={workspaceId} owner={owner} initialSource={initialSource} disabled={busy}
      onBusy={setScanning} onRestore={() => void run("restore")} onSaved={profile => {
        setProfiles(list => [...list.filter(p => p.id !== profile.id),profile]);
        setExpanded(profile.id); setError("");
        setNotice("Imported: " + profile.imported.map(kind => categoryLabel(kind,profile.source?.browser)).join(", ") + ".");
      }}/>}
    {profiles.map(p => <div key={p.id}>
      <div className="personal-profile-row">
        <Monitor size={16} aria-hidden="true"/>
        <div className="personal-profile-label">
          <span>{p.name}</span><small>{translate("Personal · This device")}</small>
        </div>
        <MenuTrigger>
          <Pressable>
            <IconButton appearance="plain" size="small" label={translate("Actions for %1", p.name)} hint={translate("Profile actions")}>
              <Ellipsis size={18} aria-hidden="true"/>
            </IconButton>
          </Pressable>
          <Popover placement="bottom end" offset={4} className={`${glassSurfaceClassName} personal-profile-menu`}>
            <Menu aria-label={translate("Actions for %1", p.name)}>
              <MenuItem textValue="Open profile" isDisabled={busy || scanning} onAction={() => void run("open", p.id)}>
                <AppWindow/>{translate("Open profile")}</MenuItem>
              <MenuItem textValue="Scan browser data" isDisabled={busy || scanning} onAction={() => { setInitialSource(p.source?.id); setForm(true); }}>
                <ScanSearch/>{translate("Scan browser data…")}</MenuItem>
              {p.backup && <MenuItem textValue="Recovery files" onAction={() => setExpanded(expanded === p.id ? undefined : p.id)}>
                <FolderKey/>{expanded === p.id ? translate("Hide recovery files") : translate("Recovery files")}
              </MenuItem>}
              {(!p.backup || p.pendingBackup) && <MenuItem isDisabled={busy} textValue={p.pendingBackup ? "Finish backup" : "Create encrypted archive"} onAction={() => void run("backup", p.id)}>
                <Archive/>{p.pendingBackup ? translate("Finish backup") : translate("Create encrypted archive")}
              </MenuItem>}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
      {p.backup && expanded === p.id && <section className="personal-recovery" aria-label={translate("Recovery files")}>
        <p>{translate("Only someone with the key file can decrypt the archive. Save the key separately and keep both files for recovery. Nextbrowser cannot replace a lost key.")}</p>
        <div><span>{translate("Encrypted archive")}<code>{p.backup.archivePath}</code></span><Button disabled={busy} onClick={() => void run("reveal",p.id,"archive")}>{translate("Show archive")}</Button></div>
        <div><span>{translate("Recovery key")}<code>{p.backup.keyPath}</code></span><Button disabled={busy} onClick={() => void run("reveal",p.id,"key")}>{translate("Show key")}</Button></div>
      </section>}
    </div>)}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
  </section>;
}
