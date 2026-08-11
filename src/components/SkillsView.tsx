import { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  type SkillEntry,
  selectorIcon,
  selectorTargetHost,
} from "../skillsCatalog";
import type { BrowserWorkflowSkill, CustomScript } from "../types";
import { uid } from "../lib/ids";
import { internalError } from "../lib/userFacingError";
import { Icon } from "./Icon";
import { UserFacingError } from "./UserFacingError";

export function SkillsView({ onOpenAgentSettings }: { onOpenAgentSettings: () => void }) {
  const s = useStore();
  const categories = s.skillCategories;
  const [category, setCategory] = useState("__skills__");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [scriptEditor, setScriptEditor] = useState<CustomScript | "new" | null>(null);
  const [skillRun, setSkillRun] = useState<BrowserWorkflowSkill | null>(null);

  const cat = categories.find((c) => c.id === category);
  const isSkillsOverview = category === "__skills__";
  const isMySkills = category === "my-skills";
  const isScripts = category === "my-scripts";
  const skillCount = categories.reduce((total, current) => total + current.entries.length, 0);
  const publishedScripts = s.appliedScripts.filter((entry) => entry.selector.kind === "script");
  const visibleEntries = isSkillsOverview ? categories.flatMap((current) => current.entries) : (cat?.entries ?? []);
  useEffect(() => {
    const pendingCategory = localStorage.getItem("openSkillsCategory");
    if (pendingCategory) {
      localStorage.removeItem("openSkillsCategory");
      setCategory(pendingCategory);
    }
    if (localStorage.getItem("openMyScriptsEditor") === "1") {
      localStorage.removeItem("openMyScriptsEditor");
      setCategory("my-scripts");
      setScriptEditor("new");
    }
    const openCategory = (event: Event) => {
      const nextCategory = event instanceof CustomEvent ? String(event.detail ?? "") : "";
      if (nextCategory) setCategory(nextCategory);
    };
    window.addEventListener("nextbrowser:open-skills-category", openCategory);
    return () => window.removeEventListener("nextbrowser:open-skills-category", openCategory);
  }, []);
  const sessionName = s.currentSessionDisplayName();
  const ready = s.agentReady();

  const apply = async (e: SkillEntry) => {
    const publishedScript = e.selector.kind === "script" && !e.js;
    setStatus((p) => ({ ...p, [e.id]: publishedScript ? "adding to script menu…" : "applying…" }));
    try {
      const ref = await s.applySkill(e);
      setStatus((p) => ({
        ...p,
        [e.id]: publishedScript
          ? "added to script menu"
          : ref?.found
            ? `installed: ${ref.slug ?? e.title}`
            : "no skill published yet",
      }));
    } catch {
      setStatus((p) => ({ ...p, [e.id]: internalError("We couldn't apply this skill.") }));
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
        <div className="skills-nav-label">SKILLS</div>
        <button
          className={"skills-nav-item" + (isSkillsOverview ? " active" : "")}
          onClick={() => setCategory("__skills__")}
        >
          <Icon name="sparkles" size={18} className="skills-nav-icon" />
          <span className="skills-nav-title">Skills</span>
          <span className="muted small skills-nav-count">{skillCount}</span>
        </button>
        <button
          className={"skills-nav-item" + (isMySkills ? " active" : "")}
          onClick={() => setCategory("my-skills")}
        >
          <Icon name="person.crop.circle" size={18} className="skills-nav-icon" />
          <span className="skills-nav-title">My skills</span>
          <span className="muted small skills-nav-count">{s.localSkills.length + s.privateCloudSkills.filter((cloud) => !s.localSkills.some((local) => local.serverSlug === cloud.id)).length}</span>
        </button>
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
        <div className="skills-nav-label skills-nav-secondary-label">TOOLS</div>
        <button
          className={"skills-nav-item" + (isScripts ? " active" : "")}
          onClick={() => setCategory("my-scripts")}
        >
          <Icon name="scroll.fill" size={18} className="skills-nav-icon" />
          <span className="skills-nav-title">Scripts</span>
          <span className="muted small skills-nav-count">{publishedScripts.length + s.customScripts.length}</span>
        </button>
      </nav>
      <hr className="divider skills-divider" />
      <div className="skills-main">
        <div className="skills-main-head">
          <h2 className="skills-category-title">
            <Icon name={isScripts ? "scroll.fill" : isMySkills ? "person.crop.circle" : cat?.icon ?? "sparkles"} size={22} className="accent-icon" />
            {isScripts ? "Scripts" : isMySkills ? "My skills" : cat?.title ?? "Skills"}
          </h2>
          <p className="muted">
            {isScripts
              ? "Quick reusable commands for common browser tasks."
              : isMySkills
                ? "Browser workflows saved locally on this device."
              : cat?.blurb ?? "Extend your agents with reusable browser capabilities."}
          </p>
          {!isScripts && !isMySkills && (
            <p className="skills-apply-hint muted small">
              <Icon name="arrow.down.circle" size={14} />
              Applied skills work with any connected agent.
            </p>
          )}
        </div>

        {!isScripts && !isMySkills && !s.nextctlSupportsSkill && (
          <div className="warning-banner skills-warning">
            <Icon name="exclamationmark.triangle.fill" size={16} />
            <div>
              <strong>Skills need an updated NextBrowser component.</strong>
              <div className="muted small">
                Update NextBrowser and try again.
              </div>
            </div>
          </div>
        )}
        {!isScripts && !isMySkills && s.nextctlSupportsSkill && !ready && (
          <div className="skills-connect-hint">
            <Icon name="bolt.fill" size={16} />
            <div>
              <strong>Connect an agent to install and run skills.</strong>
              <div className="muted small">Skills work with any connected agent.</div>
            </div>
            <button className="btn-bordered-prominent" onClick={onOpenAgentSettings}>
              Connect agent
            </button>
          </div>
        )}

        {!isScripts && !isMySkills && visibleEntries.length === 0 && (
          <div className="skills-empty-state">
            <span className="skills-empty-icon"><Icon name="sparkles" size={22} /></span>
            <strong>No skills available yet</strong>
            <span className="muted small">Published skills will appear here and work with any connected agent.</span>
          </div>
        )}

        {!isScripts && !isMySkills && <div className="skills-grid">
          {visibleEntries.map((e) => {
            const st = applyState(e.id);
            const applyError = s.skillApplyError(e.id);
            const publishedScript = e.selector.kind === "script" && !e.js;
            const repositorySkill = e.source === "repository";
            return (
              <div key={e.id} className="skill-card claw-card">
                <div className="skill-card-head">
                  <Icon name={selectorIcon(e.selector)} size={16} className="accent-icon" />
                  <div className="skill-title">{e.title}</div>
                  <span className={"mode-badge" + (e.js ? " instant" : " agent")}>
                    <Icon name={e.js ? "bolt.fill" : publishedScript ? "scroll.fill" : "sparkles"} size={10} />
                    {e.js ? "Instant" : publishedScript ? "Script" : repositorySkill ? "Repository" : "Agent"}
                  </span>
                </div>
                <div className="muted small">{e.subtitle}</div>
                {repositorySkill && e.author && <div className="small muted skill-author">by @{e.author}</div>}
                <div className="target-line small muted">
                  <Icon
                    name={selectorTargetHost(e.selector) ? "arrow.right.circle" : "play.circle"}
                    size={12}
                  />
                  {targetText(e)}
                </div>
                {publishedScript && st === "idle" && <div className="small muted skill-status">Not added</div>}
                {publishedScript && status[e.id] === "adding to script menu…" && (
                  <div className="small muted skill-status">Adding to script menu…</div>
                )}
                {publishedScript && st === "installed" && (
                  <div className="small ok skill-status">
                    <Icon name="checkmark.seal.fill" size={12} />
                    Added to script menu
                  </div>
                )}
                {repositorySkill && <div className="small ok skill-status"><Icon name="checkmark.seal.fill" size={12} /> Included with NextBrowser</div>}
                {!publishedScript && !repositorySkill && (
                  <>
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
                        {applyError && (
                          <div className="skill-error-detail">
                            <UserFacingError message={applyError} surface="skill_apply" />
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
                <div className="skill-actions">
                  {repositorySkill ? (
                    <button className="btn-bordered-prominent full" disabled={!ready} title={`Run ${e.title} in chat`} onClick={() => void s.useSkillInChat(e)}>
                      <Icon name="play.fill" size={13} /> Run
                    </button>
                  ) : e.js ? (
                    <button className="btn-bordered-prominent full" title={`Run ${e.title}`} onClick={() => s.runScript(e)}>
                      <Icon name="bolt.fill" size={14} />
                      Run
                    </button>
                  ) : (
                    <>
                      <button className="btn-bordered-prominent full" title={`${st === "installed" ? "Re-apply" : "Apply"} ${e.title}`} onClick={() => apply(e)}>
                        {publishedScript && st === "installed" ? "Applied" : st === "installed" ? "Re-apply" : "Apply"}
                      </button>
                      {!publishedScript && (st === "installed" || status[e.id]?.startsWith("installed")) && (
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
                {status[e.id] && st !== "failed" && (
                  <div className="small muted">
                    <UserFacingError message={status[e.id]} surface="skill_apply" />
                  </div>
                )}
              </div>
            );
          })}
        </div>}

        {isMySkills && (
          s.localSkills.length === 0 && s.privateCloudSkills.length === 0 ? (
            <div className="skills-empty-state">
              <span className="skills-empty-icon"><Icon name="sparkles" size={22} /></span>
              <strong>No local skills yet</strong>
              <span className="muted small">After a successful browser task, use “Save as skill” below the answer.</span>
            </div>
          ) : (
            <div className="skills-grid">
              {s.localSkills.map((skill) => (
                <LocalSkillCard
                  key={skill.id}
                  skill={skill}
                  ready={ready}
                  sync={s.localSkillSync[skill.id] ?? (skill.submittedAt ? "synced" : "idle")}
                  onRun={() => setSkillRun(skill)}
                  onSync={() => void s.saveLocalSkill(skill)}
                  onDelete={() => s.deleteLocalSkill(skill.id)}
                />
              ))}
              {s.privateCloudSkills
                .filter((cloud) => !s.localSkills.some((local) => local.serverSlug === cloud.id))
                .map((skill) => (
                  <div className="skill-card claw-card" key={skill.id}>
                    <div className="skill-card-head">
                      <Icon name="sparkles" size={16} className="accent-icon" />
                      <div className="skill-title">{skill.title}</div>
                      <span className="mode-badge agent">Private cloud</span>
                    </div>
                    <div className="muted small">{skill.description || "Private skill from your account"}</div>
                    <div className="skill-actions">
                      <button className="btn-bordered-prominent full" disabled={!ready} onClick={() => void s.runScript(skill)}>Run</button>
                    </div>
                  </div>
                ))}
            </div>
          )
        )}

        {isScripts && (
          <div className="custom-scripts">
            {publishedScripts.length > 0 && (
              <>
                <div className="row custom-scripts-head">
                  <div>
                    <h3 className="custom-scripts-title"><Icon name="checkmark.seal.fill" size={18} /> Published scripts</h3>
                    <p className="muted small">Ready-to-run scripts from your account.</p>
                  </div>
                </div>
                <div className="skills-grid">
                  {publishedScripts.map((script) => (
                    <div className="skill-card claw-card" key={script.id}>
                      <div className="skill-card-head">
                        <Icon name="scroll.fill" size={16} className="accent-icon" />
                        <div className="skill-title">{script.title}</div>
                        <span className="mode-badge agent">Script</span>
                      </div>
                      <div className="muted small">{script.description || script.subtitle}</div>
                      <div className="skill-actions">
                        <button className="btn-bordered-prominent full" disabled={!ready} onClick={() => void s.runScript(script)}>Run</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <hr className="divider" />
            <div className="row custom-scripts-head">
              <div>
                <h3 className="custom-scripts-title">
                  <Icon name="lock.fill" size={18} />
                  My scripts
                </h3>
                <p className="muted small">
                  Backed up privately to your account and never shared with other users.
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
      {skillRun && (
        <RunLocalSkillSheet
          skill={skillRun}
          sessionName={sessionName}
          onClose={() => setSkillRun(null)}
          onRun={(task) => {
            const skill = skillRun;
            setSkillRun(null);
            void s.runLocalSkill(skill, task);
          }}
        />
      )}
    </div>
  );
}

function RunLocalSkillSheet({ skill, sessionName, onClose, onRun }: {
  skill: BrowserWorkflowSkill;
  sessionName: string;
  onClose: () => void;
  onRun: (task: string) => void;
}) {
  const [task, setTask] = useState(skill.task);
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card skill-run-modal" onMouseDown={(event) => event.stopPropagation()}>
        <strong>Run {skill.title}</strong>
        <p className="muted small">
          The app will verify <strong>{sessionName}</strong>{skill.domain ? ` and open ${skill.domain}` : ""} before the agent starts.
        </p>
        <label className="field-label">Task for this run</label>
        <textarea rows={5} autoFocus value={task} onChange={(event) => setTask(event.target.value)} />
        <p className="muted small">Change the search, filters, content, or other values while keeping the saved workflow.</p>
        <div className="row" style={{ gap: 8 }}>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!task.trim()} onClick={() => onRun(task.trim())}>Run skill</button>
        </div>
      </div>
    </div>
  );
}

function LocalSkillCard({ skill, ready, sync, onRun, onSync, onDelete }: {
  skill: BrowserWorkflowSkill;
  ready: boolean;
  sync: string;
  onRun: () => void;
  onSync: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="skill-card claw-card">
      <div className="skill-card-head">
        <Icon name="sparkles" size={16} className="accent-icon" />
        <div className="skill-title">{skill.title}</div>
        <span className="mode-badge agent">Local</span>
      </div>
      <div className="muted small">{skill.domain || "Any website"}</div>
      <p className="small instructions-preview">{skill.instructions.slice(0, 150)}{skill.instructions.length > 150 ? "…" : ""}</p>
      <div className="small muted">{skill.actions.length} recorded browser action{skill.actions.length === 1 ? "" : "s"}</div>
      {sync === "idle" && <button className="link small sync-link" onClick={onSync}>Back up privately</button>}
      {sync === "syncing" && <span className="muted small">Backing up…</span>}
      {sync === "synced" && <span className="ok small"><Icon name="lock.fill" size={11} /> Private cloud backup</span>}
      {sync === "failed" && <button className="link small" onClick={onSync}>Saved locally · Retry backup</button>}
      <div className="skill-actions">
        <button className="btn-bordered-prominent full" disabled={!ready} onClick={onRun}>Run</button>
        <button className="plain-icon-btn" title="Delete local skill" onClick={onDelete}>
          <Icon name="trash" size={14} className="error" />
        </button>
      </div>
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
      {(!sync || sync === "idle") && <button className="link small sync-link" onClick={onSync}>Back up privately</button>}
      {sync === "syncing" && <span className="muted small">Backing up…</span>}
      {sync === "synced" && <span className="ok small"><Icon name="lock.fill" size={11} /> Private cloud backup</span>}
      {sync === "failed" && <button className="link small" onClick={onSync}>Backup failed · Retry</button>}
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
