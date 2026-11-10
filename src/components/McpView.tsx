import { agentById } from "../agents";
import { OPEN_AGENT_SETTINGS_EVENT } from "../lib/appNavigation";
import { Glyph } from "../shared/ui";
import { useStore } from "../store";

/** The managed server is injected per chat; CLI detection is not a live connection check. */
export function McpView() {
  const available = useStore(state => state.nextctlAvailable);
  const version = useStore(state => state.nextctlVersion);
  const error = useStore(state => state.nextctlCompatibilityError);
  const agentId = useStore(state => state.agentId);
  const close = useStore(state => state.closeUtilityDialog);
  return <section className="mcp-view" aria-label="Managed MCP server">
    <div className="mcp-server-head"><Glyph name="unplug" /><div><strong>Nextbrowser</strong><p className="muted small">Browser tools for your agent</p></div>
      <span className="muted small">{available ? "CLI available" : "CLI unavailable"}</span></div>
    <dl className="mcp-server-details">
      <div><dt>Transport</dt><dd>stdio</dd></div>
      <div><dt>CLI version</dt><dd>{version || "Not detected"}</dd></div>
      <div><dt>Active agent</dt><dd>{agentById(agentId).name}</dd></div>
    </dl>
    <p className="muted small">Nextbrowser manages this server for chat sessions. CLI availability does not indicate an active MCP connection.</p>
    {error && <p role="alert" className="error small">{error}</p>}
    <div className="mcp-server-actions"><button onClick={() => { close(); window.dispatchEvent(new CustomEvent(OPEN_AGENT_SETTINGS_EVENT)); }}>Agent settings</button></div>
  </section>;
}
