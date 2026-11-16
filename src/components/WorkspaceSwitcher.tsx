import { useCallback, useState } from "react";
import { Dialog, IconButton, Popover } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";

export function WorkspaceSwitcher({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const workspaces = useStore(state => state.workspaces);
  const activeId = useStore(state => state.activeWorkspaceId);
  const select = useStore(state => state.selectWorkspace);
  const active = workspaces.find(workspace => workspace.id === activeId);
  const search = query.trim().toLowerCase();
  const visible = workspaces.filter(workspace => workspace.name.toLowerCase().includes(search));
  const changeOpen = useCallback((value: boolean) => {
    setOpen(value);
    if (!value) setQuery("");
  }, []);
  const action = (event: string, id?: string) => {
    changeOpen(false);
    window.dispatchEvent(new CustomEvent(event, { detail: id }));
  };
  return <>
    <Popover label="Workspaces" open={open && !disabled} onOpenChange={changeOpen} openOnHover align="start"
      className="titlebar-workspaces shared-scrollbarless"
      trigger={props => <button {...props} className="titlebar-workspace-switcher" disabled={disabled} aria-label={`Switch workspace, ${active?.name ?? "no workspace"}`}>
        <span>Workspaces{active ? ` (${active.name})` : ""}</span><Icon name="chevron.down" size={10} />
      </button>}>
      <div className="workspace-switcher-toolbar">
        <label className="workspace-switcher-search">
          <Icon name="magnifyingglass" size={13} />
          <input aria-label="Search workspaces" placeholder="Search workspaces" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <IconButton label="Create workspace" appearance="plain" size="small" onClick={() => action("nextbrowser:create-workspace")}><Icon name="plus" size={15} /></IconButton>
      </div>
      <div className="workspace-switcher-list shared-scrollbarless">
        {visible.map(workspace => <div className="workspace-switcher-row" key={workspace.id}>
          <button type="button" className="workspace-switcher-item" aria-current={workspace.id === activeId ? "true" : undefined}
            onClick={() => { select(workspace.id); changeOpen(false); }}>
            <Icon name={workspace.id === activeId ? "checkmark" : "square.grid.2x2"} size={13} /><span>{workspace.name}</span>
          </button>
          <IconButton label={`Delete workspace ${workspace.name}`} appearance="plain" size="small" className="workspace-switcher-delete"
            onClick={() => action("nextbrowser:delete-workspace", workspace.id)}><Icon name="trash" size={13} /></IconButton>
        </div>)}
        {!visible.length && <p className="workspace-switcher-empty">{search ? "No matching workspaces" : "No workspaces yet"}</p>}
      </div>
      <button type="button" className="workspace-switcher-reset" onClick={() => { changeOpen(false); setResetOpen(true); }}>
        <Icon name="exclamationmark.triangle.fill" size={13} />Emergency data reset
      </button>
    </Popover>
    {resetOpen && <WorkspaceResetDialog onClose={() => setResetOpen(false)} />}
  </>;
}

function WorkspaceResetDialog({ onClose }: { onClose: () => void }) {
  const reset = useStore(state => state.resetWorkspaceData);
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [resetting, setResetting] = useState(false);
  const close = () => { if (!resetting) onClose(); };
  return <Dialog title="Emergency data reset" className="workspace-reset-dialog" onClose={close}>
    <form onSubmit={event => {
      event.preventDefault();
      if (confirmation !== "DROP" || resetting) return;
      setResetting(true);
      setError("");
      void reset(confirmation, setProgress).catch(failure => {
        setError(failure instanceof Error ? failure.message : String(failure));
        setResetting(false);
      });
    }}>
      <p>This permanently deletes all workspaces in your connected Nextbrowser account, including synced projects, chats, and schedules. It also erases this device’s Nextbrowser data, including local browser profiles, files in the Nextbrowser agent workspace, settings, and saved credentials. The app then restarts.</p>
      <label className="modal-field">
        <span>Type DROP to confirm. This cannot be undone.</span>
        <input data-autofocus value={confirmation} onChange={event => setConfirmation(event.target.value)}
          disabled={resetting} autoComplete="off" autoCapitalize="off" spellCheck={false} />
      </label>
      {resetting && <p className="muted small" role="status">{progress}</p>}
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={close} disabled={resetting}>Cancel</button>
        <button type="submit" className="primary danger" disabled={confirmation !== "DROP" || resetting}>Delete all data</button>
      </div>
    </form>
  </Dialog>;
}
