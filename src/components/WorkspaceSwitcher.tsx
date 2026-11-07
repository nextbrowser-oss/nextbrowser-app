import { useState } from "react";
import { Glyph, Popover } from "../shared/ui";
import { useStore } from "../store";
import { Icon } from "./Icon";

export function WorkspaceSwitcher({ disabled = false }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const workspaces = useStore(state => state.workspaces);
  const activeId = useStore(state => state.activeWorkspaceId);
  const select = useStore(state => state.selectWorkspace);
  const active = workspaces.find(workspace => workspace.id === activeId);
  const action = (event: string) => { setOpen(false); window.dispatchEvent(new CustomEvent(event)); };
  return <Popover label="Workspaces" open={open} onOpenChange={setOpen} align="start" className="titlebar-workspaces shared-scrollbarless"
    trigger={props => <button {...props} className="titlebar-workspace-switcher" disabled={disabled} aria-label={`Switch workspace, ${active?.name ?? "no workspace"}`}>
      <span>({active?.name ?? "Workspace"})</span><Icon name="chevron.down" size={10} />
    </button>}>
    <div className="workspace-switcher-list">
      {workspaces.map(workspace => <button key={workspace.id} aria-current={workspace.id === activeId ? "true" : undefined}
        onClick={() => { select(workspace.id); setOpen(false); }}><Icon name={workspace.id === activeId ? "checkmark" : "square.grid.2x2"} size={13} /><span>{workspace.name}</span></button>)}
    </div>
    <button onClick={() => action("nextbrowser:create-workspace")}><Icon name="plus" size={13} /><span>Create workspace</span></button>
    <button onClick={() => action("nextbrowser:manage-workspace")}><Glyph name="sliders" size={14} /><span>Profiles and proxies</span></button>
    {active && <button onClick={() => action("nextbrowser:delete-workspace")}><Icon name="trash" size={13} /><span>Delete current workspace…</span></button>}
  </Popover>;
}
