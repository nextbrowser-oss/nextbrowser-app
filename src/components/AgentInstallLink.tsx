import {
  agentInstallName,
  isMissingAgentInstallError,
  type AgentSpec,
} from "../agents";
import { trackEvent } from "../lib/analytics";
import { Icon } from "./Icon";

export function AgentInstallLink({
  agent,
  error,
  surface,
}: {
  agent: AgentSpec;
  error: string;
  surface: string;
}) {
  if (!agent.installUrl || !isMissingAgentInstallError(error)) return null;

  return (
    <a
      className="agent-install-link"
      href={agent.installUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent("agent_install_opened", { agent: agent.id, surface })}
    >
      Install {agentInstallName(agent)}
      <Icon name="arrow.up.forward.app" size={12} />
    </a>
  );
}
