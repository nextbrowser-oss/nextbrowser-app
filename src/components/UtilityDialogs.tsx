import { translate } from "../shared/lib/i18n";
import { Dialog } from "../shared/ui";
import { useStore } from "../store";
import { ConnectorsView } from "./ConnectorsView";
import { ScheduledRunsPanel } from "./ScheduledRunsPanel";
import { McpView, type McpProposal } from "./McpView";
import { useEffect, useState } from "react";
import { useMiniAppsOwner } from "../lib/miniAppLibrary";
import "./utilityDialogs.css";

export function UtilityDialogs() {
  const modal = useStore(state => state.utilityDialog);
  const close = useStore(state => state.closeUtilityDialog);
  const setTab = useStore(state => state.setTab);
  const workspaceId = useStore(state => state.activeWorkspaceId);
  const owner = useMiniAppsOwner();
  const [proposal, setProposal] = useState<McpProposal>();
  useEffect(() => window.nextbrowser?.on('stock-mcp:proposal', payload => {
    const draft = payload as McpProposal;
    if (owner && draft.owner === owner && draft.workspaceId === workspaceId) { setProposal(draft); setTab('mcp'); }
  }), [owner, workspaceId, setTab]);
  useEffect(() => { if (modal !== 'mcp') setProposal(undefined); }, [modal]);
  if (!modal) return null;
  return <Dialog key={modal} title={modal === "connectors" ? translate("Connectors") : modal === "mcp" ? "MCP" : translate("Schedule")} onClose={close} className="utility-dialog">
    {modal === "connectors" ? <ConnectorsView embedded /> : modal === "mcp" ? <McpView key={owner} proposal={owner === proposal?.owner ? proposal : undefined} /> : <ScheduledRunsPanel asPage embedded />}
  </Dialog>;
}
