import { MultiloginConnector } from "./MultiloginConnector";
import { useStore } from "../store";

export function ConnectorsView() {
  const s = useStore();
  const workspace = s.workspaces.find((item) => item.id === s.activeWorkspaceId);

  return (
    <div className="page connectors-page">
      <div className="connectors-page-head">
        <div>
          <h2>Connectors</h2>
          <p className="muted">Connect external browser platforms to NextBrowser.</p>
        </div>
      </div>
      <div className="connectors-grid">
        <MultiloginConnector
          workspace={workspace && { id: workspace.id, name: workspace.name }}
          onSelectAsAgentDefault={() => s.selectProfile(undefined)}
        />
      </div>
    </div>
  );
}
