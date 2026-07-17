import { useMemo, useState } from "react";
import { AGENTS, agentById } from "../agents";
import { useStore } from "../store";
import { Icon } from "./Icon";

interface AgentPickerProps {
  compact?: boolean;
  createChatOnSwitch?: boolean;
  label?: string;
  tabLike?: boolean;
}

export function AgentPicker({ compact = false, createChatOnSwitch = false, label = "Agent", tabLike = false }: AgentPickerProps) {
  const agentId = useStore((s) => s.agentId);
  const switchAgent = useStore((s) => s.switchAgent);
  const newChat = useStore((s) => s.newChat);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = agentById(agentId);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AGENTS;
    return AGENTS.filter((agent) =>
      agent.name.toLowerCase().includes(q) ||
      agent.binary.toLowerCase().includes(q),
    );
  }, [query]);

  const choose = (nextAgentId: string) => {
    setOpen(false);
    setQuery("");
    if (!nextAgentId || nextAgentId === agentId) return;
    switchAgent(nextAgentId);
    if (createChatOnSwitch) newChat();
  };

  const title = createChatOnSwitch ? "Choose agent and create a new chat" : "Choose active agent";

  return (
    <div className={"agent-picker" + (compact ? " agent-picker-compact" : "") + (tabLike ? " agent-picker-tab" : "")}>
      <button
        className={tabLike ? "tab-hit agent-tab-hit" : "agent-picker-button"}
        onClick={() => setOpen((value) => !value)}
        title={title}
        aria-label={title}
      >
        {tabLike ? (
          <span className={"tab-pill" + (open ? " tab-pill-active" : "")}>
            <Icon name="cpu.fill" size={16} strokeWidth={2.25} />
            {label}
          </span>
        ) : (
          <>
            <Icon name="cpu.fill" size={14} />
            {!compact && <span className="muted small">{label}</span>}
            {!compact && <strong>{current.name}</strong>}
            {!compact && <Icon name="chevron.down" size={12} className="muted" />}
          </>
        )}
      </button>
      {open && (
        <>
          <button className="menu-dismiss-layer" onClick={() => setOpen(false)} aria-label="Close agent picker" />
          <div className="agent-picker-menu">
            <div className="agent-picker-warning">
              <Icon name="info.circle" size={13} />
              {createChatOnSwitch ? "Switching agent creates a new chat." : "New chats will use the selected agent."}
            </div>
            <div className="agent-search-box agent-picker-search">
              <Icon name="magnifyingglass" size={12} className="muted" />
              <input
                className="agent-search-input"
                autoFocus
                placeholder="Search agents..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="agent-picker-list">
              {matches.map((agent) => (
                <button
                  key={agent.id}
                  className={"agent-row" + (agent.id === agentId ? " agent-row-active" : "")}
                  title={agent.id === agentId ? `${agent.name} is active` : `Switch to ${agent.name}`}
                  onClick={() => choose(agent.id)}
                >
                  <span>{agent.name}</span>
                  <span className="muted small">{agent.binary}</span>
                  {agent.id === agentId && <Icon name="checkmark" size={12} className="accent-icon" />}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
