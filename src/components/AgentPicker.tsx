import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const buttonRef = useRef<HTMLButtonElement | null>(null);
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
  const menuStyle = (() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    // A picker inside Settings is rendered in a portal so it is not clipped by
    // the card's scroll area. Keep its fixed coordinates inside that card,
    // though: the old below-only placement could spill out of the modal.
    const owner = buttonRef.current?.closest(".modal-card")?.getBoundingClientRect();
    const bounds = owner ?? { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    const inset = 12;
    const gap = 8;
    const maxWidth = Math.max(160, Math.min(300, bounds.right - bounds.left - inset * 2, window.innerWidth - inset * 2));
    const left = Math.min(
      Math.max(bounds.left + inset, rect.right - maxWidth),
      Math.min(bounds.right - inset - maxWidth, window.innerWidth - inset - maxWidth),
    );
    const below = bounds.bottom - rect.bottom - gap;
    const above = rect.top - bounds.top - gap;
    const openAbove = below < 220 && above > below;
    const maxHeight = Math.max(120, Math.min(420, openAbove ? above : below));
    const placement = {
      left,
      width: maxWidth,
      maxHeight: Math.min(420, maxHeight),
    };
    return openAbove
      ? { ...placement, top: "auto", bottom: window.innerHeight - rect.top + gap }
      : { ...placement, top: rect.bottom + gap, bottom: "auto" };
  })();

  return (
    <div className={"agent-picker" + (compact ? " agent-picker-compact" : "") + (tabLike ? " agent-picker-tab" : "")}>
      <button
        ref={buttonRef}
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
      {open && createPortal(
        <>
          <button className="menu-dismiss-layer" onClick={() => setOpen(false)} aria-label="Close agent picker" />
          <div className="agent-picker-menu agent-picker-menu-floating" style={menuStyle}>
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
                  {agent.id === agentId && <Icon name="checkmark" size={12} className="accent-icon" />}
                </button>
              ))}
            </div>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
