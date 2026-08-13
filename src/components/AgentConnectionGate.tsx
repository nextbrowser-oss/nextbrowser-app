import { PRIMARY_AGENTS, agentById } from "../agents";
import { useStore } from "../store";
import { AgentInstallLink } from "./AgentInstallLink";
import { BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

/** Required first-run gate. The product is unusable without an agent, so this
 * deliberately has no close, skip, backdrop-dismiss, or Escape action. */
export function AgentConnectionGate() {
  const s = useStore();
  const agent = agentById(s.agentId);
  const version = s.agentVersion();
  const loggedIn = s.agentLoggedIn();
  const error = s.agentError();
  const authorizing = s.runtime[s.agentId]?.authorizing ?? false;
  const needsLogin = !!version && loggedIn === false;

  return (
    <div className="agent-gate-overlay">
      <div className="agent-gate-card" role="dialog" aria-modal="true" aria-labelledby="agent-gate-title">
        <BrandLogo size={44} />
        <div className="agent-gate-copy">
          <h2 id="agent-gate-title">Connect an agent to continue</h2>
          <p className="muted">Every project keeps one agent context. Choose the agent that will run its chats, terminal sessions, and browser profiles.</p>
        </div>
        <div className="agent-gate-options">
          {PRIMARY_AGENTS.map((candidate) => (
            <button
              type="button"
              key={candidate.id}
              className={"agent-gate-option" + (candidate.id === s.agentId ? " is-selected" : "")}
              onClick={() => s.switchAgent(candidate.id)}
            >
              <Icon name="cpu.fill" size={17} />
              <strong>{candidate.name}</strong>
              {candidate.id === s.agentId && <Icon name="checkmark.circle.fill" size={16} className="ok" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary agent-gate-connect"
          disabled={authorizing}
          onClick={() => void (needsLogin ? s.loginAgent() : s.authorizeAgent())}
        >
          {authorizing && <Spinner size={14} />}
          {authorizing ? "Checking…" : needsLogin ? `Sign in to ${agent.name}` : `Connect ${agent.name}`}
        </button>
        {error && (
          <div className="error small agent-gate-error">
            <UserFacingError message={error} surface="agent_gate" />
            <AgentInstallLink agent={agent} error={error} surface="agent_gate" />
          </div>
        )}
      </div>
    </div>
  );
}
