import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import type { BrowserRuntime, ProfileBrowserConfig } from "../types";
import { countryFlag } from "../lib/countryFlag";
import { AgentPicker } from "./AgentPicker";
import { Icon, Spinner } from "./Icon";

const RUNTIMES: Array<{ value: BrowserRuntime; label: string; description: string }> = [
  { value: "clawbrowser", label: "Clawbrowser", description: "Recommended · managed automatically" },
  { value: "chromium", label: "Chrome / Chromium", description: "Use a local browser executable" },
  { value: "cdp", label: "Existing browser via CDP", description: "Attach to an existing endpoint" },
];

export function WorkflowBar() {
  const s = useStore();
  const chatButtonRef = useRef<HTMLButtonElement | null>(null);
  const profileButtonRef = useRef<HTMLButtonElement | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const conversations = s.conversationsForAgent(s.agentId);
  const activeConversation = s.activeConversation();
  const profileKey = s.selectedProfile || "__default";
  const profile = s.selectedProfile ? s.profiles.find((item) => item.name === s.selectedProfile) : undefined;
  const identity = s.profileIdentities[profileKey];
  const config = s.profileBrowserConfigs[profileKey] ?? { runtime: "clawbrowser" as const };
  const status = s.selectedProfile ? s.statuses[s.selectedProfile] ?? "stopped" : s.defaultSession?.status ?? "stopped";
  const busy = ["starting", "stopping", "rotating"].includes(status);
  const running = status === "running";
  const country = (profile?.country ?? identity?.country)?.toUpperCase();
  const runtimeLabel = RUNTIMES.find((item) => item.value === config.runtime)?.label ?? "Clawbrowser";

  const updateConfig = (patch: Partial<ProfileBrowserConfig>) => {
    s.setProfileBrowserConfig(profileKey, { ...config, ...patch });
  };

  const profileMenuStyle = (() => {
    const rect = profileButtonRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      top: rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - 390),
      width: 374,
      maxHeight: Math.max(320, window.innerHeight - rect.bottom - 24),
    };
  })();
  const chatMenuStyle = (() => {
    const rect = chatButtonRef.current?.getBoundingClientRect();
    if (!rect) return undefined;
    return {
      top: rect.bottom + 8,
      left: Math.min(rect.left, window.innerWidth - 310),
      width: 294,
      maxHeight: Math.max(220, window.innerHeight - rect.bottom - 24),
    };
  })();

  return (
    <div className="workflow-bar" aria-label="Current browser workflow">
      <div className="workflow-step workflow-agent-step">
        <span className="workflow-step-number">1</span>
        <AgentPicker label="Agent" workflow />
        <span className={"workflow-health" + (s.agentReady() ? " is-ready" : "")} title={s.agentReady() ? "Agent ready" : "Agent offline"} />
      </div>
      <Icon name="chevron.right" size={12} className="workflow-chevron" />

      <button ref={chatButtonRef} className={"workflow-step workflow-chat-step" + (chatOpen ? " is-open" : "")} onClick={() => setChatOpen((value) => !value)}>
        <span className="workflow-step-number">2</span>
        <span className="workflow-step-copy">
          <span>Chat</span>
          <strong>{activeConversation?.title || "New chat"}</strong>
        </span>
        <Icon name="chevron.down" size={11} className="muted" />
      </button>
      <Icon name="chevron.right" size={12} className="workflow-chevron" />

      <button ref={profileButtonRef} className={"workflow-step workflow-profile-step" + (profileOpen ? " is-open" : "")} onClick={() => setProfileOpen((value) => !value)}>
        <span className="workflow-step-number">3</span>
        <span className="workflow-step-copy">
          <span>Profile</span>
          <strong>{s.selectedProfile || "default"}</strong>
        </span>
        <span className="workflow-profile-meta">{runtimeLabel}{country ? ` · ${countryFlag(country)} ${country}` : ""}</span>
        <span className={"workflow-session-dot" + (running ? " is-running" : "")} />
        <Icon name="chevron.down" size={11} />
      </button>
      <Icon name="chevron.right" size={12} className="workflow-chevron" />

      <button className={"workflow-step workflow-live-step" + (s.tab === "live" ? " is-active" : "")} onClick={() => s.setTab("live")}>
        <span className="workflow-step-number">4</span>
        <Icon name="video.fill" size={14} />
        <span className="workflow-step-copy"><span>Live</span><strong>{running ? "Open stream" : "Start session"}</strong></span>
        {running && <span className="workflow-live-dot" />}
      </button>

      {chatOpen && createPortal(
        <>
          <button className="menu-dismiss-layer" onClick={() => setChatOpen(false)} aria-label="Close chat picker" />
          <div className="workflow-chat-popover" style={chatMenuStyle}>
            <div className="workflow-chat-menu-head">
              <strong>Chats</strong>
              <button className="secondary" onClick={() => { s.newChat(); s.setTab("chat"); setChatOpen(false); }}><Icon name="plus" size={12} /> New chat</button>
            </div>
            <div className="workflow-chat-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={conversation.id === activeConversation?.id ? "is-active" : ""}
                  onClick={() => { s.selectConversation(conversation.id); s.setTab("chat"); setChatOpen(false); }}
                >
                  <span>{conversation.title}</span>
                  {conversation.id === activeConversation?.id && <Icon name="checkmark" size={12} />}
                </button>
              ))}
              {conversations.length === 0 && <span className="workflow-chat-empty">No chats yet</span>}
            </div>
          </div>
        </>, document.body,
      )}

      {profileOpen && createPortal(
        <>
          <button className="menu-dismiss-layer" onClick={() => setProfileOpen(false)} aria-label="Close profile configuration" />
          <div className="workflow-profile-popover" style={profileMenuStyle}>
            <div className="workflow-popover-head">
              <div><strong>Browser profile</strong><span>Browser and proxy configuration</span></div>
              <button className="plain-icon-btn plain-icon-btn-compact" disabled={s.isRefreshing} onClick={() => void s.refreshSessions()} title="Refresh profiles">
                {s.isRefreshing ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={13} />}
              </button>
            </div>

            <label className="workflow-field">
              <span>Profile</span>
              <select value={profileKey} onChange={(event) => s.selectProfile(event.target.value === "__default" ? undefined : event.target.value)}>
                <option value="__default">default</option>
                {s.profiles.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
              </select>
            </label>

            <label className="workflow-field">
              <span>Browser</span>
              <select value={config.runtime} onChange={(event) => updateConfig({ runtime: event.target.value as BrowserRuntime })}>
                {RUNTIMES.map((runtime) => <option key={runtime.value} value={runtime.value}>{runtime.label}</option>)}
              </select>
              <small>{RUNTIMES.find((runtime) => runtime.value === config.runtime)?.description}</small>
            </label>
            {config.runtime === "chromium" && (
              <label className="workflow-field"><span>Browser executable</span><input value={config.runtimeBin ?? ""} placeholder="/Applications/Google Chrome.app" onChange={(event) => updateConfig({ runtimeBin: event.target.value })} /></label>
            )}
            {config.runtime === "cdp" && (
              <label className="workflow-field"><span>CDP endpoint</span><input value={config.cdpEndpoint ?? ""} placeholder="http://127.0.0.1:9222" onChange={(event) => updateConfig({ cdpEndpoint: event.target.value })} /></label>
            )}

            <div className="workflow-network-summary">
              <span><Icon name="network" size={13} /> Proxy</span>
              <strong>{profile?.proxy_mode === "manual" ? "Manual proxy" : country ? `${countryFlag(country)} ${country}` : "Managed automatically"}</strong>
              {identity?.ip && <small>{identity.ip}</small>}
            </div>

            <div className="workflow-profile-actions">
              <button className="secondary" onClick={() => window.dispatchEvent(new CustomEvent("nextbrowser:open-profile-creator"))}><Icon name="plus" size={13} /> New profile</button>
              <span className="spacer" />
              <button
                className={running ? "secondary" : "primary"}
                disabled={busy}
                onClick={() => {
                  if (s.selectedProfile) void (running ? s.stopProfile(s.selectedProfile) : s.startProfile(s.selectedProfile));
                  else void (running ? s.stopDefaultSession() : s.startDefaultSession());
                }}
              >
                {busy ? <Spinner size={13} /> : <Icon name={running ? "stop.fill" : "play.fill"} size={13} />}
                {busy ? status : running ? "Stop" : "Start profile"}
              </button>
            </div>
          </div>
        </>, document.body,
      )}
    </div>
  );
}
