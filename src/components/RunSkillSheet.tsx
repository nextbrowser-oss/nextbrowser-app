import { translate } from "../shared/lib/i18n";
import { useState } from "react";
import type { SkillEntry } from "../skillsCatalog";

/// The task is optional: a skill that needs no input runs as it did before,
/// and one that does (fill a form without submitting it, search for something)
/// gets the text as the "Task for this run" of the agent prompt.
export function skillRunTask(text: string): string | undefined {
  const task = text.trim();
  return task || undefined;
}

export function skillRunTarget(entry: SkillEntry): string {
  return entry.selector.kind === "current_tab" ? "the current tab" : entry.selector.value;
}

/// Run on a skill card asks what this run should do. Without it the agent only
/// got "use this skill on the current tab", so a skill with several cases (a
/// password manager filling a form with or without submitting) could run only
/// its default one.
export function RunSkillSheet({ entry, onClose, onRun }: {
  entry: SkillEntry;
  onClose: () => void;
  onRun: (task: string | undefined) => void;
}) {
  const [task, setTask] = useState("");
  const run = () => onRun(skillRunTask(task));
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal-card skill-run-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="run-skill-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <strong id="run-skill-title">{translate("Run")} {entry.title}</strong>
        <p className="muted small">{translate("The agent runs this skill in chat on")} {skillRunTarget(entry)}.</p>
        <label className="field-label" htmlFor="run-skill-task">{translate("Task for this run (optional)")}</label>
        <textarea
          id="run-skill-task"
          rows={4}
          autoFocus
          value={task}
          placeholder={translate("For example: fill in the login form, but don't submit it.")}
          onChange={(event) => setTask(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              run();
            }
          }}
        />
        <p className="muted small">{translate("Leave it empty to run the skill as written.")}</p>
        <div className="row" style={{ gap: 8 }}>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>{translate("Cancel")}</button>
          <button className="primary" onClick={run}>{translate("Run skill")}</button>
        </div>
      </div>
    </div>
  );
}
