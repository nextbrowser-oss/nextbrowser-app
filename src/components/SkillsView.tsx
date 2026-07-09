import { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  withLocalScripts,
  type SkillEntry,
  selectorIcon,
  selectorTargetHost,
} from "../skillsCatalog";
import type { CustomScript } from "../types";
import { uid } from "../lib/ids";
import { Icon } from "./Icon";

export function SkillsView() {
  const s = useStore();
  const categories = withLocalScripts(s.skillCategories);
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [scriptEditor, setScriptEditor] = useState<CustomScript | "new" | null>(null);

  const cat = categories.find((c) => c.id === category) ?? categories[0];
  useEffect(() => {
    if (cat && cat.id !== category) setCategory(cat.id);
  }, [cat, category]);
  useEffect(() => {
    if (localStorage.getItem("openMyScriptsEditor") !== "1") return;
    localStorage.removeItem("openMyScriptsEditor");
    setCategory("my-scripts");
    setScriptEditor("new");
  }, []);
  const sessionName = s.currentSessionDisplayName();
  const ready = s.agentReady();

  const apply = async (e: SkillEntry) => {
    setStatus((p) => ({ ...p, [e.id]: "applying…" }));
    try {
      const ref = await s.applySkill(e);
      setStatus((p) => ({
        ...p,
        [e.id]: ref?.found ? `installed: ${ref.slug ?? e.title}` : "no skill published yet",
      }));
    } catch (err) {
      setStatus((p) => ({ ...p, [e.id]: String(err) }));
    }
  };

  const targetText = (e: SkillEntry) => {
    const host = selectorTargetHost(e.selector);
    if (host) return `Runs in ${sessionName} → ${host}`;
    if (e.selector.kind === "captcha") return `Runs in ${sessionName} · current tab`;
    return `Runs in ${sessionName}`;
  };

  const applyState = (id: string) => s.skillApplyState(id);

  return (
    <div className="skills-root">
      <nav className="skills-nav thin-material">
        <div className="skills-nav-label">CATEGORIES</div>
        {categories.map((c) => (
          <button
            key={c.id}
            className={"skills-nav-item" + (c.id === cat?.id ? " active" : "")}
            onClick={() => setCategory(c.id)}
          >
            <Icon name={c.icon} size={18} className="skills-nav-icon" />
            <span className="skills-nav-title">{c.title}</span>
            <span className="muted small skills-nav-count">{c.entries.length}</span>
          </button>
        ))}
      </nav>
      <hr className="divider skills-divider" />
      <div className="skills-main">
        <div className="skills-main-head">
          <h2 className="skills-category-title">
            <Icon name={cat?.icon ?? "sparkles"} size={22} className="accent-icon" />
            {cat?.title ?? "Skills"}
          </h2>
          <p className="muted">{cat?.blurb ?? "No published skills are available for this account."}</p>
          <p className="skills-apply-hint muted small">
            <Icon name="arrow.down.circle" size={14} />
            Apply pulls from the deployed backend and installs into every agent (Claude Code + Codex).
          </p>
        </div>

        {!s.clawctlSupportsSkill && (
          <div className="warning-banner skills-warning">
            <Icon name="exclamationmark.triangle.fill" size={16} />
            <div>
              <strong>Resolved clawctl ({s.clawctlVersion}) has no `skill` command.</strong>
              <div className="muted small">
                Update clawctl or set CLAWCTL_BIN to a build that supports it.
              </div>
            </div>
          </div>
        )}
        {s.clawctlSupportsSkill && !ready && (
          <div className="skills-connect-hint">
            <Icon name="bolt.fill" size={16} />
            <div>
              <strong>Connect an agent to install and run skills.</strong>
              <div className="muted small">Skills are installed into the selected local agent runtime.</div>
            </div>
            <button className="btn-bordered-prominent" onClick={() => s.authorizeAgent()}>
              Connect agent
            </button>
          </div>
        )}

        <div className="skills-grid">
          {(cat?.entries ?? []).map((e) => {
            const st = applyState(e.id);
            const applyError = s.skillApplyError(e.id);
            return (
              <div key={e.id} className="skill-card claw-card">
                <div className="skill-card-head">
                  <Icon name={selectorIcon(e.selector)} size={16} className="accent-icon" />
                  <div className="skill-title">{e.title}</div>
                  <span className={"mode-badge" + (e.js ? " instant" : " agent")}>
                    <Icon name={e.js ? "bolt.fill" : "sparkles"} size={10} />
                    {e.js ? "Instant" : "Agent"}
                  </span>
                </div>
                <div className="muted small">{e.subtitle}</div>
                <div className="target-line small muted">
                  <Icon
                    name={selectorTargetHost(e.selector) ? "arrow.right.circle" : "play.circle"}
                    size={12}
                  />
                  {targetText(e)}
                </div>
                {st === "idle" && <div className="small muted skill-status">Not installed</div>}
                {st === "applying" && <div className="small muted skill-status">Pulling from API…</div>}
                {st === "installed" && (
                  <div className="small ok skill-status">
                    <Icon name="checkmark.seal.fill" size={12} />
                    Installed
                  </div>
                )}
                {st === "failed" && (
                  <div className="small error skill-status">
                    Apply failed
                    {applyError && <pre className="skill-error-detail">{applyError}</pre>}
                  </div>
                )}
                <div className="skill-actions">
                  {e.js ? (
                    <button className="btn-bordered-prominent full" title={`Run ${e.title}`} onClick={() => s.runScript(e)}>
                      <Icon name="bolt.fill" size={14} />
                      Run
                    </button>
                  ) : (
                    <>
                      <button className="btn-bordered-prominent full" title={`${st === "installed" ? "Re-apply" : "Apply"} ${e.title}`} onClick={() => apply(e)}>
                        {st === "installed" ? "Re-apply" : "Apply"}
                      </button>
                      {(st === "installed" || status[e.id]?.startsWith("installed")) && (
                        <button
                          className="btn-bordered full"
                          disabled={!ready}
                          title={`Run ${e.title} in chat`}
                          onClick={() => s.useSkillInChat(e)}
                        >
                          Run
                        </button>
                      )}
                    </>
                  )}
                </div>
                {status[e.id] && <div className="small muted">{status[e.id]}</div>}
              </div>
            );
          })}
        </div>

        {cat?.id === "my-scripts" && (
          <div className="custom-scripts">
            <hr className="divider" />
            <div className="row custom-scripts-head">
              <div>
                <h3 className="custom-scripts-title">
                  <Icon name="lock.fill" size={18} />
                  My scripts
                </h3>
                <p className="muted small">
                  Synced to your account on our server, but never shared back to other users.
                </p>
              </div>
              <button className="btn-bordered-prominent" title="Create a new private custom script" onClick={() => setScriptEditor("new")}>
                <Icon name="plus" size={14} />
                New script
              </button>
            </div>
            {s.customScripts.length === 0 ? (
              <div className="empty-scripts">
                <Icon name="scroll" size={18} className="muted" />
                <span className="muted">
                  No custom scripts yet. Create one bound to a domain and run it from chat.
                </span>
              </div>
            ) : (
              <div className="skills-grid">
                {s.customScripts.map((cs) => (
                  <CustomScriptCard
                    key={cs.id}
                    script={cs}
                    sync={s.scriptSync[cs.id]}
                    sessionName={sessionName}
                    onEdit={() => setScriptEditor(cs)}
                    onDelete={() => s.deleteCustomScript(cs.id)}
                    onUse={() => s.runCustomScript(cs)}
                    onSync={() => void s.saveCustomScript(cs)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {scriptEditor && (
        <CustomScriptSheet
          script={scriptEditor === "new" ? null : scriptEditor}
          onClose={() => setScriptEditor(null)}
          onSave={(sc) => {
            void s.saveCustomScript(sc);
            setScriptEditor(null);
          }}
        />
      )}
    </div>
  );
}

function CustomScriptCard({
  script,
  sync,
  sessionName,
  onEdit,
  onDelete,
  onUse,
  onSync,
}: {
  script: CustomScript;
  sync?: string;
  sessionName: string;
  onEdit: () => void;
  onDelete: () => void;
  onUse: () => void;
  onSync: () => void;
}) {
  return (
    <div className="skill-card claw-card custom-script-card">
      <div className="skill-title">{script.title}</div>
      <div className="muted small">{script.domain || "(any domain)"}</div>
      <div className="muted small">Runs in {sessionName}</div>
      <p className="small instructions-preview">{script.instructions.slice(0, 120)}…</p>
      {(!sync || sync === "idle") && (
        <button className="link small sync-link" title="Sync this script to your account" onClick={onSync}>
          Sync to server
        </button>
      )}
      {sync === "syncing" && <span className="muted small">Syncing…</span>}
      {sync === "synced" && <span className="ok small">Synced to your account</span>}
      {sync === "failed" && (
        <span className="error small sync-failed-row">
          Not synced
          <button className="link small" title="Retry script sync" onClick={onSync}>
            Retry
          </button>
        </span>
      )}
      <div className="skill-actions">
        <button className="btn-bordered-prominent full" title={`Use ${script.title} in chat`} onClick={onUse}>
          Use
        </button>
        <button className="btn-bordered full" title={`Edit ${script.title}`} onClick={onEdit}>
          Edit
        </button>
        <button className="mini" title={`Delete ${script.title}`} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

function CustomScriptSheet({
  script,
  onClose,
  onSave,
}: {
  script: CustomScript | null;
  onClose: () => void;
  onSave: (s: CustomScript) => void;
}) {
  const [title, setTitle] = useState(script?.title ?? "");
  const [domain, setDomain] = useState(script?.domain ?? "");
  const [instructions, setInstructions] = useState(script?.instructions ?? "");

  return (
    <div className="modal-overlay">
      <div className="modal-card script-editor">
        <h3>{script ? "Edit script" : "New script"}</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Domain (optional)"
        />
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="Instructions for the agent…"
          rows={8}
        />
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() =>
              onSave({
                id: script?.id ?? uid(),
                title: title.trim() || "Untitled",
                domain: domain.trim(),
                instructions: instructions.trim(),
                createdAt: script?.createdAt ?? Date.now(),
                updatedAt: Date.now(),
                serverSlug: script?.serverSlug,
                submittedAt: script?.submittedAt,
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
