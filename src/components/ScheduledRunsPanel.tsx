import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { WEEKDAY_ORDER, weekdayShortName, weekdaysSummary } from "../types";
import type { ScheduledRun } from "../types";

import { Icon } from "./Icon";
import { agentById } from "../agents";

// Sentinel for the "create a dedicated chat" option in the session selector.
const NEW_DEDICATED_CHAT = "__new_dedicated_chat__";

export function ScheduledRunsPanel({ asPage = false }: { asPage?: boolean }) {
  const runs = useStore((s) => s.scheduledRuns);
  const chatTitle = useStore((s) => s.scheduledRunChatTitle);
  const setEnabled = useStore((s) => s.setScheduledRunEnabled);
  const deleteRun = useStore((s) => s.deleteScheduledRun);
  const addRun = useStore((s) => s.addScheduledRun);
  const updateRun = useStore((s) => s.updateScheduledRun);
  const createNamedChat = useStore((s) => s.createNamedChat);
  const conversations = useStore((s) => s.conversations);
  const currentAgent = useStore((s) => s.agentId);

  const [editor, setEditor] = useState<ScheduledRun | "new" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ScheduledRun | null>(null);
  const [menuRunId, setMenuRunId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(asPage);

  // Auto-scroll the open action menu into view so it's never clipped by the
  // scrollable sidebar when it pops up near the bottom.
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (menuRunId) menuRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [menuRunId]);

  const editorAgent = editor && editor !== "new" ? editor.agent : currentAgent;
  const editorConversations = conversations
    .filter((conversation) => conversation.agent === editorAgent)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className={(asPage ? "scheduled-page-card " : "") + "claw-card scheduled-panel"}>
      {asPage && (
        <div className="page-head scheduled-page-head">
          <div>
            <h2>Scheduled runs</h2>
            <p className="muted">Automate recurring tasks while NextBrowser is open.</p>
          </div>
        </div>
      )}
      <div className="row scheduled-panel-head">
        <button
          className="scheduled-panel-toggle"
          title={expanded ? "Hide scheduled runs" : "Show scheduled runs"}
          aria-expanded={expanded}
          onClick={() => !asPage && setExpanded((value) => !value)}
        >
          {!asPage && <Icon name={expanded ? "chevron.down" : "chevron.right"} size={13} />}
          <span className="section">Scheduled runs</span>
          {runs.length > 0 && <span className="profiles-count" title="Scheduled runs">{runs.length}</span>}
        </button>
        <button className="plain-icon-btn" title="New schedule" onClick={() => { setExpanded(true); setEditor("new"); }}>
          <Icon name="plus.circle" size={18} />
        </button>
      </div>
      {expanded && (runs.length === 0 ? (
          <div className="muted small scheduled-empty">No schedules yet. Automate daily parses or checks.</div>
        ) : (
          runs.map((run) => (
          <div key={run.id} className="schedule-row">
            <div className="schedule-info">
              <div className="schedule-title">{run.title}</div>
              <div className="muted small">
                {String(run.hour).padStart(2, "0")}:{String(run.minute).padStart(2, "0")} ·{" "}
                {weekdaysSummary(run.weekdays)}
              </div>
              <div className="muted small">
                {chatTitle(run) ?? "New chat each run"}
              </div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                aria-label={run.enabled ? "Disable scheduled run" : "Enable scheduled run"}
                checked={run.enabled}
                onChange={(e) => setEnabled(run.id, e.target.checked)}
              />
              <span className="toggle-track"><span className="toggle-knob" /></span>
            </label>
            <button
              className="plain-icon-btn schedule-menu-button"
              onClick={() => setMenuRunId(menuRunId === run.id ? null : run.id)}
              title="Edit or delete scheduled run"
            >
              <Icon name="ellipsis.circle" size={16} />
            </button>
            {menuRunId === run.id && (
              <>
                <button
                  className="menu-dismiss-layer"
                  aria-label="Close schedule menu"
                  onClick={() => setMenuRunId(null)}
                />
                <div className="schedule-action-menu" ref={menuRef}>
                  <button onClick={() => { setEditor(run); setMenuRunId(null); }}>
                    <Icon name="pencil" size={13} /> Edit
                  </button>
                  <hr className="divider" />
                  <button
                    className="danger-text"
                    onClick={() => { setPendingDelete(run); setMenuRunId(null); }}
                  >
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
          ))
        ))}

      {editor && (
        <ScheduleEditor
          run={editor === "new" ? null : editor}
          conversations={editorConversations}
          agentName={agentById(editorAgent).name}
          onSave={(data) => {
            let final = data;
            if (data.conversationId === NEW_DEDICATED_CHAT) {
              const chatId = createNamedChat(editorAgent, data.title || "Scheduled");
              final = { ...data, conversationId: chatId };
            }
            if (editor === "new") addRun(final);
            else updateRun(editor.id, final);
            setEditor(null);
          }}
          onClose={() => setEditor(null)}
        />
      )}

      {pendingDelete && (
        <div className="modal-overlay">
          <div className="modal-card">
            <p>Delete “{pendingDelete.title}”?</p>
            <p className="muted small">This schedule will stop running. Existing chats are kept.</p>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button
                className="primary danger"
                onClick={() => {
                  deleteRun(pendingDelete.id);
                  setPendingDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleEditor({
  run,
  conversations,
  agentName,
  onSave,
  onClose,
}: {
  run: ScheduledRun | null;
  conversations: { id: string; title: string }[];
  agentName: string;
  onSave: (data: Omit<ScheduledRun, "id" | "agent" | "enabled">) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(run?.title ?? "Daily parse");
  const [prompt, setPrompt] = useState(
    run?.prompt ?? "Parse latest Cian listings in the active profile.",
  );
  const [hour, setHour] = useState(run?.hour ?? 9);
  const [minute, setMinute] = useState(run?.minute ?? 0);
  const [weekdays, setWeekdays] = useState<number[]>(run?.weekdays ?? [2, 3, 4, 5, 6]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    run?.conversationId,
  );

  const toggleDay = (d: number) => {
    setWeekdays((w) => (w.includes(d) ? w.filter((x) => x !== d) : [...w, d]));
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card schedule-editor">
        <h3>{run ? "Edit scheduled run" : "New scheduled run"}</h3>
        <p className="muted small">Runs while NextBrowser is open, for {agentName}.</p>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Prompt"
          rows={3}
        />
        <div className="schedule-time-row">
          <label className="schedule-time-field">
            Hour
            <input
              type="number"
              min={0}
              max={23}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
            />
          </label>
          <span className="schedule-time-separator" aria-hidden>:</span>
          <label className="schedule-time-field">
            Min
            <input
              type="number"
              min={0}
              max={59}
              step={15}
              value={minute}
              onChange={(e) => setMinute(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="field-label">Days</div>
        <div className="weekday-row">
          {WEEKDAY_ORDER.map((d) => (
            <button
              key={d}
              type="button"
              className={"weekday-btn" + (weekdays.includes(d) ? " on" : "")}
              onClick={() => toggleDay(d)}
            >
              {weekdayShortName(d)}
            </button>
          ))}
        </div>
        <div className="preset-row">
          <button type="button" className="mini" onClick={() => setWeekdays([2, 3, 4, 5, 6])}>
            Weekdays
          </button>
          <button type="button" className="mini" onClick={() => setWeekdays([1, 2, 3, 4, 5, 6, 7])}>
            Daily
          </button>
          <button type="button" className="mini" onClick={() => setWeekdays([1, 7])}>
            Weekends
          </button>
        </div>
        <div className="field-label">Session (chat)</div>
        <select
          value={conversationId ?? ""}
          onChange={(e) => setConversationId(e.target.value || undefined)}
        >
          <option value="">New chat each run</option>
          <option value={NEW_DEDICATED_CHAT}>➕ Create a dedicated chat for this task</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        {conversationId === NEW_DEDICATED_CHAT && (
          <p className="muted small" style={{ marginTop: 4 }}>
            A new chat named “{title.trim() || "Scheduled"}” will be created and every run posts into it.
          </p>
        )}
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            disabled={!weekdays.length || !prompt.trim()}
            onClick={() =>
              onSave({ title, prompt, hour, minute, weekdays, conversationId })
            }
          >
            {run ? "Save" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
