import { MultiloginConnector } from "./MultiloginConnector";
import { useStore } from "../store";
import { CONNECTORS } from "../connectorsCatalog";

export function ConnectorsView() {
  const s = useStore();
  const workspace = s.workspaces.find((item) => item.id === s.activeWorkspaceId);
  const prompt = s.connectorPrompt;

  return (
    <div className="page connectors-page">
      <div className="connectors-page-head">
        <div>
          <h2>Connectors</h2>
          <p className="muted">Connect external browser platforms to NextBrowser.</p>
        </div>
      </div>
      <div className="connectors-grid">
        {CONNECTORS.map((connector) => connector.id === "multilogin" && (
          <MultiloginConnector
            key={connector.id}
            workspace={workspace && { id: workspace.id, name: workspace.name }}
            onSelectAsAgentDefault={() => s.selectProfile(undefined)}
            autoOpen={prompt?.id === connector.id}
            onConnected={() => s.completeConnectorPrompt()}
            onDismiss={() => s.clearConnectorPrompt()}
          />
        ))}
      </div>
    </div>
  );
}
