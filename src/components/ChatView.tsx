import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { SCRIPTS } from "../skillsCatalog";
import { MarkdownText } from "./MarkdownText";
import { Icon } from "./Icon";
import { BrandLogo } from "./BrandLogo";
import type { ChatAttachment, ChatMessage } from "../types";
import { invoke } from "../electronBridge";
import { conversationPreview } from "../types";
import { agentById } from "../agents";

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(m: ChatMessage): string {
  switch (m.status) {
    case "queued":
      return "Queued";
    case "streaming":
      return m.activityLabel ?? "Streaming…";
    case "done":
      return "agent";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Stopped";
    case "timedOut":
      return "Timed out";
    default:
      return "";
  }
}

// Condense a long agent error into a one-line summary for the collapsed view.
function errorSummary(text: string): string {
  const firstMeaningful =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && l !== "…[earlier output truncated]") ?? text.trim();
  const cleaned = firstMeaningful.replace(/^\[[^\]]*error\]\s*/i, "").replace(/^\[error\]\s*/i, "");
  return cleaned.length > 140 ? cleaned.slice(0, 140) + "…" : cleaned;
}

export function ChatView() {
  const s = useStore();
  const agentId = s.agentId;
  const convs = s.conversationsForAgent(agentId);
  const conv = s.activeConversation();
  const messages = conv?.messages ?? [];
  const ready = s.agentReady();
  const running = s.hasRunning();
  const queued = s.queuedCount();
  const collapsed = s.chatListCollapsed;

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState("");
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [convMenu, setConvMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [promptDetail, setPromptDetail] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, messages[messages.length - 1]?.text]);

  const send = () => {
    const t = draft.trim();
    if (!t && attachments.length === 0) return;
    setDraft("");
    s.enqueue(t || "Please inspect the attached file(s).", undefined, undefined, attachments);
    setAttachments([]);
  };

  const attachFiles = async () => {
    const selected = await invoke<ChatAttachment[]>("select_chat_files");
    setAttachments((current) => {
      const byPath = new Map(current.map((file) => [file.path, file]));
      for (const file of selected) byPath.set(file.path, file);
      return [...byPath.values()];
    });
  };

  const looksLikeDomain = (text: string) =>
    text.length > 0 && text.length <= 100 && !text.includes(" ") && text.includes(".");

  const customScripts = s.customScripts;
  const queuedReplyForMessage = (message: ChatMessage): ChatMessage | undefined => {
    if (message.role === "assistant") return message.status === "queued" ? message : undefined;
    if (message.role !== "user") return undefined;
    const index = messages.findIndex((candidate) => candidate.id === message.id);
    const next = messages[index + 1];
    return next?.role === "assistant" && next.status === "queued" ? next : undefined;
  };

  const agentName = agentById(agentId).name;
  const showDefaultSession =
    !s.selectedProfile && s.defaultSession?.status === "running";

  return (
    <div className="chat-layout">
      {!collapsed && (
        <aside className="conv-sidebar thin-material">
          <div className="conv-sidebar-head">
            <span className="conv-sidebar-label">{agentName} chats</span>
            <button className="plain-icon-btn" onClick={() => s.newChat()} title="New chat">
              <Icon name="square.and.pencil" size={16} />
            </button>
          </div>
          <hr className="divider" />
          <div className="conv-sidebar-list">
            {convs.length === 0 ? (
              <div className="conv-empty">
                <Icon name="bubble.left.and.bubble.right.fill" size={28} className="muted" />
                <p className="muted">No chats yet</p>
                <button className="btn-bordered-prominent" onClick={() => s.newChat()}>
                  New chat
                </button>
              </div>
            ) : (
              convs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={"conv-row" + (c.id === conv?.id ? " active" : "")}
                  onClick={() => s.selectConversation(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setConvMenu({ id: c.id, x: e.clientX, y: e.clientY });
                  }}
                >
                  <div className="conv-row-top">
                    <span className="conv-row-title">{c.title}</span>
                    <span className="muted small">{formatTime(c.updatedAt)}</span>
                  </div>
                  <div className="muted small conv-preview">{conversationPreview(c)}</div>
                </button>
              ))
            )}
          </div>
        </aside>
      )}
      {collapsed ? null : <hr className="divider conv-divider" />}

      <div className="chat">
        <div className="chat-header">
          <button
            className="plain-icon-btn"
            onClick={() => s.setChatListCollapsed(!collapsed)}
            title={collapsed ? "Show chat list" : "Hide chat list"}
          >
            <Icon name={collapsed ? "sidebar.left" : "sidebar.leading"} size={16} />
          </button>
          {collapsed && (
            <button className="plain-icon-btn" onClick={() => s.newChat()} title="New chat">
              <Icon name="square.and.pencil" size={16} />
            </button>
          )}
          <strong className="chat-title">{conv?.title ?? agentName}</strong>
          <span className={ready ? "ok small chat-ready" : "muted small"}>
            {ready ? "ready" : "not connected"}
          </span>
          {queued > 0 && (
            <span className="queue-badge">
              <Icon name="tray.full.fill" size={12} />
              {queued} queued
            </span>
          )}
          <span className="spacer" />
          {s.selectedProfile && (
            <span className="profile-pill">
              <Icon name="person.crop.circle" size={12} />
              {s.selectedProfile}
            </span>
          )}
          {showDefaultSession && (
            <span className="default-session-pill">
              <Icon name="globe" size={12} />
              default
            </span>
          )}
          <button
            className="plain-icon-btn"
            disabled={running || messages.length === 0}
            onClick={() => s.clearChat()}
            title="Clear this chat"
          >
            <Icon name="eraser" size={16} />
          </button>
          <button
            className="plain-icon-btn"
            disabled={messages.length === 0}
            onClick={() => s.forkConversation()}
            title="Fork chat"
          >
            <Icon name="arrow.triangle.branch" size={16} />
          </button>
        </div>
        <hr className="divider" />

        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">
              <BrandLogo size={44} />
              <strong>Start a conversation</strong>
              <p className="muted">
                Connect an agent, pick a profile, then automate NextBrowser from chat.
              </p>
              <div className="empty-actions">
                {!ready && (
                  <button className="btn-bordered-prominent" onClick={() => s.authorizeAgent()}>
                    Connect agent
                  </button>
                )}
                <button className="btn-bordered" onClick={() => s.setTab("skills")}>
                  Open Skills
                </button>
                <button className="btn-bordered" onClick={() => s.startDefaultSession()}>
                  Start session
                </button>
              </div>
              <button
                className="link empty-link"
                onClick={() =>
                  s.tryGuidePrompt(
                    "Using the clawctl CLI, rotate the active browser profile to Spain (ES) with --verify, then start the session and confirm the proxy country.",
                  )
                }
              >
                Try: Spanish proxy (ES)
              </button>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              canQueue={!!queuedReplyForMessage(m) && s.canManageQueuedReply(queuedReplyForMessage(m)!.id)}
              onCancel={() => {
                const reply = queuedReplyForMessage(m);
                if (reply) s.cancelQueuedReply(reply.id);
              }}
              onEdit={() => {
                const reply = queuedReplyForMessage(m);
                const replyIndex = reply ? messages.findIndex((x) => x.id === reply.id) : -1;
                const user = m.role === "user" ? m : replyIndex > 0 ? messages[replyIndex - 1] : null;
                if (reply && user) {
                  setEditingReply(reply.id);
                  setEditText(user.text);
                }
              }}
              onStop={() => s.stopRunning()}
              running={running && m.status === "streaming"}
              queuedReplyId={m.role === "user" ? queuedReplyForMessage(m)?.id : undefined}
              onShowPrompt={() => setPromptDetail(m.text)}
            />
          ))}
          <div ref={bottomRef} />
        </div>

        <hr className="divider" />
        {attachments.length > 0 && (
          <div className="pending-attachments">
            {attachments.map((file) => (
              <span className="attachment-chip" key={file.path} title={file.path}>
                <Icon name="paperclip" size={12} />
                <span>{file.name}</span>
                <button
                  className="attachment-remove"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => setAttachments((items) => items.filter((item) => item.path !== file.path))}
                >×</button>
              </span>
            ))}
          </div>
        )}
        <div className="composer">
          <textarea
            value={draft}
            placeholder={
              ready
                ? `Message ${agentName} — Enter to queue`
                : "Connect an agent first"
            }
            disabled={!ready}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-actions">
            <button
              className="plain-icon-btn"
              title="Attach files"
              disabled={!ready}
              onClick={() => void attachFiles()}
            >
              <Icon name="paperclip" size={19} />
            </button>
            <div className="script-wrap">
              <button
                className="plain-icon-btn"
                title="Run a script"
                onClick={() => setScriptOpen((o) => !o)}
              >
                <Icon name="scroll" size={20} />
              </button>
              {scriptOpen && (
                <div className="script-menu">
                  <div className="section">OFFICIAL SCRIPTS</div>
                  {SCRIPTS.map((sc) => (
                    <button
                      key={sc.id}
                      onClick={() => {
                        setScriptOpen(false);
                        const domain = looksLikeDomain(draft.trim()) ? draft.trim() : "";
                        if (domain) setDraft("");
                        s.runScript(sc, domain);
                      }}
                    >
                      {sc.title}
                    </button>
                  ))}
                  {customScripts.length > 0 && (
                    <>
                      <div className="section">MY SCRIPTS</div>
                      {customScripts.map((cs) => (
                        <button
                          key={cs.id}
                          onClick={() => {
                            setScriptOpen(false);
                            const domain = looksLikeDomain(draft.trim()) ? draft.trim() : "";
                            if (domain) setDraft("");
                            s.runCustomScript({ ...cs, domain: domain || cs.domain });
                          }}
                        >
                          {cs.title}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
            {running ? (
              <button className="plain-icon-btn stop-btn" onClick={() => s.stopRunning()} title="Stop">
                <Icon name="stop.circle.fill" size={22} className="error" />
              </button>
            ) : (
              <button
                className="plain-icon-btn send-btn"
                disabled={!ready || (!draft.trim() && attachments.length === 0)}
                onClick={send}
                title="Send"
              >
                <Icon name="arrow.up.circle.fill" size={22} />
              </button>
            )}
          </div>
        </div>
        {ready && (
          <div className="queue-hint muted small">
            Send freely — replies are processed in order. {queued} waiting.
          </div>
        )}
      </div>

      {convMenu && (
        <>
          <button
            className="menu-dismiss-layer"
            aria-label="Close menu"
            onClick={() => setConvMenu(null)}
          />
          <div
            className="schedule-action-menu conv-context-menu"
            style={{ position: "fixed", top: convMenu.y, left: convMenu.x, right: "auto", zIndex: 1000 }}
          >
            <button
              onClick={() => {
                const c = convs.find((x) => x.id === convMenu.id);
                setRenameText(c?.title ?? "");
                setRenameId(convMenu.id);
                setConvMenu(null);
              }}
            >
              <Icon name="pencil" size={13} /> Rename
            </button>
            <button
              onClick={() => {
                s.selectConversation(convMenu.id);
                s.forkConversation();
                setConvMenu(null);
              }}
            >
              <Icon name="arrow.triangle.branch" size={13} /> Fork chat
            </button>
            <hr className="divider" />
            <button
              className="danger-text"
              onClick={() => {
                s.deleteConversation(convMenu.id);
                setConvMenu(null);
              }}
            >
              <Icon name="trash" size={13} /> Delete
            </button>
          </div>
        </>
      )}

      {renameId && (
        <div className="modal-overlay">
          <div className="modal-card">
            <input
              value={renameText}
              autoFocus
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  s.renameConversation(renameId, renameText);
                  setRenameId(null);
                }
              }}
            />
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <button className="secondary" onClick={() => setRenameId(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  s.renameConversation(renameId, renameText);
                  setRenameId(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {editingReply && (
        <div className="modal-overlay">
          <div className="modal-card">
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} />
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <button className="secondary" onClick={() => setEditingReply(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  s.editQueuedReply(editingReply, editText);
                  setEditingReply(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {promptDetail !== null && (
        <div className="modal-overlay" onMouseDown={() => setPromptDetail(null)}>
          <div className="modal-card prompt-detail-card" onMouseDown={(e) => e.stopPropagation()}>
            <strong>Prompt sent to agent</strong>
            <pre className="prompt-detail-text">{promptDetail}</pre>
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <span className="spacer" />
              <button className="secondary" onClick={() => setPromptDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  message: m,
  canQueue,
  onCancel,
  onEdit,
  onStop,
  running,
  queuedReplyId,
  onShowPrompt,
}: {
  message: ChatMessage;
  canQueue: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onStop: () => void;
  running: boolean;
  queuedReplyId?: string;
  onShowPrompt: () => void;
}) {
  const [clock, setClock] = useState(Date.now());
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  useEffect(() => {
    if (m.status !== "streaming") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [m.status]);

  const elapsed = (start?: number) => {
    const seconds = Math.max(0, Math.floor((clock - (start ?? m.createdAt)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  };

  if (m.role === "system") {
    return (
      <div className="msg msg-system">
        <div className="msg-body">{m.text}</div>
      </div>
    );
  }

  if (m.role === "user") {
    return (
      <div className="msg-user-wrap">
        <div className="msg-user-inner">
          {m.commandChip ? (
            <button className="user-command-chip" onClick={onShowPrompt} title="Show full prompt sent to the agent">
              <span className="user-command-icon">
                <Icon
                  name={m.commandChip.kind === "skill" ? "sparkles" : "scroll.fill"}
                  size={14}
                />
              </span>
              <div>
                <div className="chip-kind">
                  {m.commandChip.kind === "skill" ? "Use skill" : "Run script"}
                </div>
                <strong>{m.commandChip.title}</strong>
                {m.commandChip.detail && (
                  <div className="muted small">{m.commandChip.detail}</div>
                )}
              </div>
              <Icon name="info.circle" size={12} className="muted" />
            </button>
          ) : (
            <div className="msg-user-bubble">{m.text}</div>
          )}
          {m.attachments && m.attachments.length > 0 && (
            <div className="message-attachments">
              {m.attachments.map((file) => (
                <button
                  className="message-attachment"
                  key={file.path}
                  title={file.path}
                  onClick={() => void invoke("open_path", { path: file.path })}
                >
                  <Icon name="doc" size={14} />
                  <span>{file.name}</span>
                </button>
              ))}
            </div>
          )}
          <div className="msg-user-meta muted small">
            {queuedReplyId && (
              <>
                <span className="queue-badge">Waiting</span>
                <button className="plain-icon-btn plain-icon-btn-compact" onClick={onEdit} title="Edit queued message">
                  <Icon name="pencil" size={12} />
                </button>
                <button className="plain-icon-btn plain-icon-btn-compact" onClick={onCancel} title="Remove queued message">
                  <Icon name="trash" size={12} className="error" />
                </button>
              </>
            )}
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Copy message"
              onClick={() => void navigator.clipboard.writeText(m.text)}
            >
              <Icon name="doc.on.doc" size={12} />
            </button>
            <span>{formatTime(m.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  const bubbleClass =
    "assistant-bubble" +
    (m.status === "failed" ? " bubble-failed" : "") +
    (m.status === "timedOut" ? " bubble-warn" : "") +
    (m.status === "streaming" && m.stalled ? " bubble-stalled" : "");

  return (
    <div className="msg-assistant-wrap">
      <div className={bubbleClass}>
        <div className="msg-meta">
          <span className={"status-badge status-" + m.status}>
            {m.status === "streaming"
              ? m.stalled
                ? `No activity · ${elapsed(m.lastActivityAt ?? m.runStartedAt)}`
                : `${m.activityLabel ?? "Thinking"} · ${elapsed(m.runStartedAt)}`
              : statusLabel(m)}
          </span>
          {running && m.status === "streaming" && (
            <button className="plain-icon-btn plain-icon-btn-compact stop-inline" onClick={onStop}>
              <Icon name="stop.fill" size={12} className="error" />
            </button>
          )}
          {canQueue && (
            <>
              <button className="plain-icon-btn plain-icon-btn-compact" onClick={onEdit} title="Edit">
                <Icon name="pencil" size={12} />
              </button>
              <button className="plain-icon-btn plain-icon-btn-compact" onClick={onCancel} title="Remove">
                <Icon name="trash" size={12} className="error" />
              </button>
            </>
          )}
          {m.text && (
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Copy message"
              onClick={() => void navigator.clipboard.writeText(m.text)}
            >
              <Icon name="doc.on.doc" size={12} />
            </button>
          )}
        </div>
        {m.toolEvents && m.toolEvents.length > 0 && (
          <div className="tool-strip">
            {m.toolEvents.slice(-4).map((t) => (
              <span key={t.id} className="tool-chip" title={t.detail}>
                <Icon name={t.name === "clawctl" ? "terminal" : "wrench"} size={10} />
                {t.detail ?? t.name}
              </span>
            ))}
          </div>
        )}
        <div className="msg-body">
          {(m.status === "failed" || m.status === "timedOut") && m.text.length > 180 ? (
            <div className="error-collapse">
              <div className="error-summary">
                <Icon name="exclamationmark.triangle.fill" size={13} className="error" />
                <span>{errorSummary(m.text)}</span>
              </div>
              <button className="error-toggle" onClick={() => setShowErrorDetails((v) => !v)}>
                {showErrorDetails ? "Hide details" : "Show details"}
              </button>
              {showErrorDetails && <pre className="error-details">{m.text}</pre>}
            </div>
          ) : (
            <MarkdownText text={m.text || (m.status === "streaming" ? "…" : "")} />
          )}
        </div>
        {m.stalled && (
          <div className="stall-hint muted small">
            <Icon name="exclamationmark.triangle.fill" size={12} className="warn" />
            No activity for {elapsed(m.lastActivityAt ?? m.runStartedAt)} — possibly stuck.
            <button className="mini danger-mini" onClick={onStop}>
              Stop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
