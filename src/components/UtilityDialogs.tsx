import { Dialog } from "../shared/ui";
import { useStore } from "../store";
import { ConnectorsView } from "./ConnectorsView";
import { ScheduledRunsPanel } from "./ScheduledRunsPanel";
import { McpView } from "./McpView";
import "./utilityDialogs.css";

export function UtilityDialogs() {
  const modal = useStore(state => state.utilityDialog);
  const close = useStore(state => state.closeUtilityDialog);
  if (!modal) return null;
  return <Dialog key={modal} title={modal === "connectors" ? "Connectors" : modal === "mcp" ? "MCP" : "Schedule"} onClose={close} className="utility-dialog">
    {modal === "connectors" ? <ConnectorsView embedded /> : modal === "mcp" ? <McpView /> : <ScheduledRunsPanel asPage embedded />}
  </Dialog>;
}
