import { useEffect, useState } from "react";
import { PRIMARY_AGENTS, agentById } from "../agents";
import { useStore } from "../store";
import { AgentInstallLink } from "./AgentInstallLink";
import { BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";

/**
 * First-run agent connection gate. A user may dismiss it and continue to look
 * around the app, but actions which require an agent remain clearly disabled
 * until one is connected.
 */
export function AgentConnectionGate({ onDismiss }: { onDismiss: () => void }) {
  const s = useStore();
  // Do not mutate the active agent until Connect is pressed. This lets a user
  // safely recover from selecting the wrong option and closing the dialog.
  const [selectedAgentId, setSelectedAgentId] = useState(s.agentId);
  const agent = agentById(selectedAgentId);
  const runtime = s.runtime[selectedAgentId];
  const version = runtime?.version;
  const loggedIn = runtime?.loggedIn;
  const error = runtime?.error;
  const authorizing = runtime?.authorizing ?? false;
  const needsLogin = !!version && loggedIn === false;

  useEffect(() => {
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [onDismiss]);

  const connect = () => {
    if (selectedAgentId !== s.agentId) s.switchAgent(selectedAgentId);
    void (needsLogin ? s.loginAgent() : s.authorizeAgent());
  };

  return (
    <div className="agent-gate-overlay">
      <div className="agent-gate-card" role="dialog" aria-modal="true" aria-labelledby="agent-gate-title">
        <button
          type="button"
          className="agent-gate-close"
          aria-label="Close agent setup"
          title="Close"
          onClick={onDismiss}
        >
          <Icon name="xmark" size={18} />
        </button>
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
              className={"agent-gate-option" + (candidate.id === selectedAgentId ? " is-selected" : "")}
              aria-pressed={candidate.id === selectedAgentId}
              onClick={() => setSelectedAgentId(candidate.id)}
            >
              <Icon name="cpu.fill" size={17} />
              <strong>{candidate.name}</strong>
              {candidate.id === selectedAgentId && <Icon name="checkmark.circle.fill" size={16} className="ok" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="primary agent-gate-connect"
          disabled={authorizing}
          onClick={connect}
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
