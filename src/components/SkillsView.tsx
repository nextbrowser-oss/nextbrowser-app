import { translate } from "../shared/lib/i18n";
import { Tooltip } from "../shared/ui";
import { useEffect, useState } from "react";
import { useStore } from "../store";
import {
  type SkillEntry,
  selectorTargetHost,
} from "../skillsCatalog";
import type { BrowserWorkflowSkill, CustomScript } from "../types";
import { uid } from "../lib/ids";
import { internalError } from "../lib/userFacingError";
import { cloudPhoneFromSelection, cloudPhoneRunsIn } from "../lib/cloudPhoneSkill";
import { multiloginSelectionForWorkspace } from "../lib/multiloginSelection";
import { Icon } from "./Icon";
import { SkillLogo } from "./SkillLogo";
import { SkillsNavigation } from "./SkillsNavigation";
import { UserFacingError } from "./UserFacingError";
import { WatchedProfilesPanel } from "./WatchedProfilesPanel";
import { RunSkillSheet } from "./RunSkillSheet";

export function SkillsView({ onOpenAgentSettings }: { onOpenAgentSettings: () => void }) {
  const s = useStore();
  const categories = s.skillCategories;
  const [category, setCategory] = useState("__skills__");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [scriptEditor, setScriptEditor] = useState<CustomScript | "new" | null>(null);
  const [skillRun, setSkillRun] = useState<BrowserWorkflowSkill | null>(null);
  const [catalogRun, setCatalogRun] = useState<SkillEntry | null>(null);
  const [skillDetails, setSkillDetails] = useState<BrowserWorkflowSkill | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<{ title: string; run: () => Promise<void> }>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const [watchlistSkill, setWatchlistSkill] = useState<SkillEntry | null>(null);
  // A run that stops on a signed-out profile opens its manager, which is where
  // the sign-in prompt lives; otherwise pressing Run looks like nothing at all.
  const signInNeeded = s.xReplySignInNeeded;
  useEffect(() => {
    if (!signInNeeded || watchlistSkill) return;
    const entry = categories.flatMap((category) => category.entries).find((candidate) => candidate.watchlist?.engine);
    if (entry) setWatchlistSkill(entry);
  }, [signInNeeded, watchlistSkill, categories]);

  const cat = categories.find((c) => c.id === category);
  const isSkillsOverview = category === "__skills__";
  const isMySkills = category === "my-skills";
  const isScripts = category === "my-scripts";
  const skillCount = categories.reduce((total, current) => total + current.entries.length, 0);
  const publishedScripts = s.appliedScripts.filter((entry) =>
    entry.selector.kind === "script" &&
    !s.customScripts.some((script) => script.serverSlug && (entry.id === script.serverSlug || entry.id === `catalog:${script.serverSlug}`)),
  );
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
      setStatus((p) => ({ ...p, [e.id]: internalError("We couldn't apply this skill.", "SKILL_APPLY_FAILED") }));
    }
  };

  const cloudPhone = cloudPhoneFromSelection(multiloginSelectionForWorkspace(s.activeWorkspaceId));
  const targetText = (e: SkillEntry) => {
    // A watchlist skill that offers both devices runs on whichever the user
    // picked in its panel, so the card has to read that rather than the entry's
    // own runtime, which only describes its default.
    const runtime = e.watchlist ? s.watchlistTransportFor(e).runtime : e.runtime;
    if (runtime === "cloud-phone") return cloudPhoneRunsIn(cloudPhone);
    const host = selectorTargetHost(e.selector);
    if (host) return `Runs in ${sessionName} → ${host}`;
    if (e.selector.kind === "captcha" || e.selector.kind === "current_tab") return `Runs in ${sessionName} · current tab`;
    return `Runs in ${sessionName}`;
  };

  /** The target as one short chip; the full sentence is its tooltip. */
  const targetChip = (e: SkillEntry) => {
    const runtime = e.watchlist ? s.watchlistTransportFor(e).runtime : e.runtime;
    if (runtime === "cloud-phone") return "Cloud phone";
    const host = selectorTargetHost(e.selector);
    if (host) return host;
    return e.selector.kind === "captcha" || e.selector.kind === "current_tab" ? "Current tab" : sessionName;
  };

  const applyState = (id: string) => s.skillApplyState(id);

  return (
    <div className="skills-root">
      <SkillsNavigation selected={category} onSelect={setCategory} items={[
        { id: "__skills__", get label() { return translate("All skills"); }, count: skillCount },
        { id: "my-skills", get label() { return translate("My skills"); }, count: s.localSkills.length + s.privateCloudSkills.filter((cloud) => !s.localSkills.some((local) => local.serverSlug === cloud.id)).length },
        ...categories.map((item) => ({ id: item.id, label: item.title, count: item.entries.length })),
        { id: "my-scripts", get label() { return translate("Scripts"); }, count: publishedScripts.length + s.customScripts.length },
      ]} />
      <div className="skills-main" id="skills-panel" role="tabpanel" aria-labelledby={`skills-tab-${category}`} tabIndex={0}>
        <div className="skills-main-head">
          <h2 className="skills-category-title">
            <Icon name={isScripts ? "scroll.fill" : isMySkills ? "person.crop.circle" : cat?.icon ?? "sparkles"} size={22} className="accent-icon" />
            {isScripts ? translate("Scripts") : isMySkills ? translate("My skills") : cat?.title ?? translate("Skills")}
          </h2>
          <p className="muted">
            {isScripts
              ? translate("Quick reusable commands for common browser tasks.")
              : isMySkills
                ? translate("Browser workflows saved locally on this device.")
              : cat?.blurb ?? translate("Extend your agents with reusable browser capabilities.")}
          </p>
          {!isScripts && !isMySkills && (
            <p className="skills-apply-hint muted small">
              <Icon name="arrow.down.circle" size={14} />{translate("Applied skills work with any connected agent.")}</p>
          )}
        </div>

        {!isScripts && !isMySkills && !s.nextctlSupportsSkill && (
          <div className="warning-banner skills-warning">
            <Icon name="exclamationmark.triangle.fill" size={16} />
            <div>
              <strong>{translate("Skills need an updated Nextbrowser component.")}</strong>
              <div className="muted small">{translate("Update Nextbrowser and try again.")}</div>
            </div>
          </div>
        )}
        {!isScripts && !isMySkills && s.nextctlSupportsSkill && !ready && (
          <div className="skills-connect-hint">
            <Icon name="bolt.fill" size={16} />
            <div>
              <strong>{translate("Connect an agent to install and run skills.")}</strong>
              <div className="muted small">{translate("Skills work with any connected agent.")}</div>
            </div>
            <button className="btn-bordered-prominent" onClick={onOpenAgentSettings}>{translate("Connect agent")}</button>
          </div>
        )}

        {!isScripts && !isMySkills && visibleEntries.length === 0 && (
          <div className="skills-empty-state">
            <span className="skills-empty-icon"><Icon name="sparkles" size={22} /></span>
            <strong>{translate("No skills available yet")}</strong>
            <span className="muted small">{translate("Published skills will appear here and work with any connected agent.")}</span>
          </div>
        )}

        {!isScripts && !isMySkills && <div className="skills-grid">
          {visibleEntries.map((e) => {
            const st = applyState(e.id);
            const applyError = s.skillApplyError(e.id);
            const publishedScript = e.selector.kind === "script" && !e.js;
            const repositorySkill = e.source === "repository";
            const monitorSchedule = e.watchlist?.monitor ? s.monitorScheduleFor(e.id) : undefined;
            const running = e.watchlist && s.watchlistRunFor(e.id)?.enabled
              ? s.watchlistRunFor(e.id)?.intervalMinutes
              : monitorSchedule?.enabled ? monitorSchedule.intervalMinutes : undefined;
            return (
              <div key={e.id} className={"skill-card claw-card" + (e.logo ? ` skill-card-${e.logo}` : "")}>
                <div className="skill-card-head">
                  <SkillLogo entry={e} />
                  <div className="skill-card-titles">
                    <div className="skill-title">{e.title}</div>
                    {repositorySkill && e.author && <div className="small muted skill-author">{translate("by")} {authorLabel(e.author)}</div>}
                  </div>
                  {!repositorySkill && (
                    <span className={"mode-badge" + (e.js ? " instant" : " agent")}>
                      <Icon name={e.js ? "bolt.fill" : publishedScript ? "scroll.fill" : "sparkles"} size={10} />
                      {e.js ? translate("Instant") : publishedScript ? translate("Script") : translate("Agent")}
                    </span>
                  )}
                  {running && (
                    <Tooltip content={translate("Checking every %1 min", running)}><span className="skill-running small">
                      <span className="status-dot ok-dot" /> {translate("Running")}</span></Tooltip>
                  )}
                </div>
                <div className="skill-desc small">{e.subtitle}</div>
                {/* A shipped skill says what it offers; where it runs and what it
                    is allowed to do live inside it, not on the card. */}
                {repositorySkill ? (
                  e.features?.length ? (
                    <div className="skill-features small">
                      {e.features.map((feature) => <span key={feature} className="skill-feature">{feature}</span>)}
                    </div>
                  ) : null
                ) : (
                  <div className="skill-meta small">
                    <Tooltip content={targetText(e)}><span className="skill-meta-chip">
                      <Icon
                        name={selectorTargetHost(e.selector) ? "arrow.right.circle" : "play.circle"}
                        size={11}
                      />
                      {targetChip(e)}
                    </span></Tooltip>
                  </div>
                )}
                {publishedScript && st === "idle" && <div className="small muted skill-status">{translate("Not added")}</div>}
                {publishedScript && status[e.id] === "adding to script menu…" && (
                  <div className="small muted skill-status">{translate("Adding to script menu…")}</div>
                )}
                {publishedScript && st === "installed" && (
                  <div className="small ok skill-status">
                    <Icon name="checkmark.seal.fill" size={12} />{translate("Added to script menu")}</div>
                )}
                {!publishedScript && !repositorySkill && (
                  <>
                    {st === "idle" && <div className="small muted skill-status">{translate("Not installed")}</div>}
                    {st === "applying" && <div className="small muted skill-status">{translate("Pulling from API…")}</div>}
                    {st === "installed" && (
                      <div className="small ok skill-status">
                        <Icon name="checkmark.seal.fill" size={12} />{translate("Installed")}</div>
                    )}
                    {st === "failed" && (
                      <div className="small error skill-status">{translate("Apply failed")}{applyError && (
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
                    // A watchlist skill is driven from its own manager: start,
                    // stop and the accounts all live there, so the card opens it
                    // instead of offering a second way to run.
                    e.watchlist ? (
                      <Tooltip content={e.watchlist.title}><button className="btn-bordered-prominent full" onClick={() => setWatchlistSkill(e)}>
                        <Icon name="person.crop.circle" size={13} /> {translate("Open")}</button></Tooltip>
                    ) : (
                      <Tooltip content={translate("Run %1 in chat", e.title)}><button className="btn-bordered-prominent full" disabled={!ready} onClick={() => setCatalogRun(e)}>
                        <Icon name="play.fill" size={13} /> {translate("Run")}</button></Tooltip>
                    )
                  ) : e.js ? (
                    <Tooltip content={translate("Run %1", e.title)}><button className="btn-bordered-prominent full" onClick={() => s.runScript(e)}>
                      <Icon name="bolt.fill" size={14} />{translate("Run")}</button></Tooltip>
                  ) : (
                    <>
                      <Tooltip content={`${st === "installed" ? "Re-apply" : "Apply"} ${e.title}`}><button className="btn-bordered-prominent full" disabled={st === "applying"} onClick={() => apply(e)}>
                        {st === "applying" ? translate("Applying…") : publishedScript && st === "installed" ? translate("Applied") : st === "installed" ? translate("Re-apply") : translate("Apply")}
                      </button></Tooltip>
                      {!publishedScript && (st === "installed" || status[e.id]?.startsWith("installed")) && (
                        <Tooltip content={translate("Run %1 in chat", e.title)}><button
                          className="btn-bordered full"
                          disabled={!ready}
                          onClick={() => setCatalogRun(e)}
                        >{translate("Run")}</button></Tooltip>
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
              <strong>{translate("No local skills yet")}</strong>
              <span className="muted small">{translate("After a successful browser task, use “Save as skill” below the answer.")}</span>
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
                  onDetails={() => setSkillDetails(skill)}
                  onSync={() => void s.saveLocalSkill(skill)}
                  onDelete={() => { setDeleteError(undefined); setDeleteRequest({ title: skill.title, run: () => s.deleteLocalSkill(skill.id) }); }}
                />
              ))}
              {s.privateCloudSkills
                .filter((cloud) => !s.localSkills.some((local) => local.serverSlug === cloud.id))
                .map((skill) => (
                  <div className="skill-card claw-card" key={skill.id}>
                    <div className="skill-card-head">
                      <Icon name="sparkles" size={16} className="accent-icon" />
                      <div className="skill-title">{skill.title}</div>
                      <span className="mode-badge agent">{translate("Private cloud")}</span>
                    </div>
                    <div className="muted small">{skill.description || translate("Private skill from your account")}</div>
                    <div className="skill-actions">
                      <button className="btn-bordered-prominent full" disabled={!ready} onClick={() => void s.runScript(skill)}>{translate("Run")}</button>
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
                    <h3 className="custom-scripts-title"><Icon name="checkmark.seal.fill" size={18} /> {translate("Published scripts")}</h3>
                    <p className="muted small">{translate("Ready-to-run scripts from your account.")}</p>
                  </div>
                </div>
                <div className="skills-grid">
                  {publishedScripts.map((script) => (
                    <div className="skill-card claw-card" key={script.id}>
                      <div className="skill-card-head">
                        <Icon name="scroll.fill" size={16} className="accent-icon" />
                        <div className="skill-title">{script.title}</div>
                        <span className="mode-badge agent">{translate("Script")}</span>
                      </div>
                      <div className="muted small">{script.description || script.subtitle}</div>
                      <div className="skill-actions">
                        <button className="btn-bordered-prominent full" disabled={!ready} onClick={() => void s.runScript(script)}>{translate("Run")}</button>
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
                  <Icon name="lock.fill" size={18} />{translate("My scripts")}</h3>
                <p className="muted small">{translate("Backed up privately to your account and never shared with other users.")}</p>
              </div>
              <Tooltip content={translate("Create a new private custom script")}><button className="btn-bordered-prominent" onClick={() => setScriptEditor("new")}>
                <Icon name="plus" size={14} />{translate("New script")}</button></Tooltip>
            </div>
            {s.customScripts.length === 0 ? (
              <div className="empty-scripts">
                <Icon name="scroll" size={18} className="muted" />
                <span className="muted">{translate("No custom scripts yet. Create one bound to a domain and run it from chat.")}</span>
              </div>
            ) : (
              <div className="skills-grid">
                {s.customScripts.map((cs) => (
                  <CustomScriptCard
                    key={cs.id}
                    script={cs}
                    ready={ready}
                    sync={s.scriptSync[cs.id] ?? (cs.submittedAt ? "synced" : "idle")}
                    sessionName={sessionName}
                    onEdit={() => setScriptEditor(cs)}
                    onDelete={() => { setDeleteError(undefined); setDeleteRequest({ title: cs.title, run: () => s.deleteCustomScript(cs.id) }); }}
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
      {catalogRun && (
        <RunSkillSheet
          entry={catalogRun}
          onClose={() => setCatalogRun(null)}
          onRun={(task) => {
            const entry = catalogRun;
            setCatalogRun(null);
            void s.useSkillInChat(entry, task);
          }}
        />
      )}
      {skillDetails && (
        <LocalSkillDetails skill={skillDetails} onClose={() => setSkillDetails(null)} />
      )}
      {deleteRequest && (
        <div className="modal-overlay" onMouseDown={() => { if (!deleting) setDeleteRequest(undefined); }}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-skill-title" onMouseDown={(event) => event.stopPropagation()}>
            <strong id="delete-skill-title">{translate("Delete “")}{deleteRequest.title}”?</strong>
            <p>{translate("This removes your saved instructions. This action cannot be undone.")}</p>
            {deleteError && <div role="alert"><UserFacingError message={deleteError} surface="skill_delete" /></div>}
            <div className="modal-actions">
              <button className="secondary" disabled={deleting} onClick={() => setDeleteRequest(undefined)}>{translate("Cancel")}</button>
              <button className="primary" disabled={deleting} onClick={async () => {
                if (deleting) return;
                setDeleting(true); setDeleteError(undefined);
                try { await deleteRequest.run(); setDeleteRequest(undefined); }
                catch { setDeleteError(translate("Could not finish deleting these instructions. Try again.")); }
                finally { setDeleting(false); }
              }}>{deleting ? translate("Deleting…") : translate("Delete")}</button>
            </div>
          </section>
        </div>
      )}
      {watchlistSkill && (
        <WatchedProfilesPanel entry={watchlistSkill} onClose={() => { s.dismissXReplySignIn(); setWatchlistSkill(null); }} />
      )}
    </div>
  );
}

/// A contributor is credited by GitHub handle; a name with a space in it, such
/// as "Nextbrowser Team", is a team and is written out as it is.
function authorLabel(author: string): string {
  return /\s/.test(author) ? author.replace(/NextBrowser/g, "Nextbrowser") : `@${author}`;
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
        <strong>{translate("Run")} {skill.title}</strong>
        <p className="muted small">{translate("The app will verify")} <strong>{sessionName}</strong>{skill.domain ? translate(" and open %1", skill.domain) : ""} {translate("before the agent starts.")}</p>
        <label className="field-label">{translate("Task for this run")}</label>
        <textarea rows={5} autoFocus value={task} onChange={(event) => setTask(event.target.value)} />
        <p className="muted small">{translate("Change the search, filters, content, or other values while keeping the saved workflow.")}</p>
        <div className="row" style={{ gap: 8 }}>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>{translate("Cancel")}</button>
          <button className="primary" disabled={!task.trim()} onClick={() => onRun(task.trim())}>{translate("Run skill")}</button>
        </div>
      </div>
    </div>
  );
}

function LocalSkillCard({ skill, ready, sync, onRun, onDetails, onSync, onDelete }: {
  skill: BrowserWorkflowSkill;
  ready: boolean;
  sync: string;
  onRun: () => void;
  onDetails: () => void;
  onSync: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="skill-card claw-card">
      <div className="skill-card-head">
        <Icon name="sparkles" size={16} className="accent-icon" />
        <div className="skill-title">{skill.title}</div>
        <span className="mode-badge agent">{translate("Local")}</span>
      </div>
      <div className="muted small">{skill.domain || translate("Any website")}</div>
      <p className="small instructions-preview">{skill.instructions.slice(0, 150)}{skill.instructions.length > 150 ? "…" : ""}</p>
      <div className="small muted">{translate("Recorded browser actions: %1", skill.actions.length)}</div>
      {sync === "idle" && <button className="link small sync-link" onClick={onSync}>{translate("Back up to private cloud")}</button>}
      {sync === "syncing" && <span className="muted small">{translate("Backing up…")}</span>}
      {sync === "synced" && <span className="ok small"><Icon name="lock.fill" size={11} /> {translate("Private cloud backup")}</span>}
      {sync === "failed" && <button className="link small" onClick={onSync}>{translate("Saved locally · Retry backup")}</button>}
      <div className="skill-actions">
        <button className="btn-bordered-prominent full" disabled={!ready} onClick={onRun}>{translate("Run")}</button>
        <button className="btn-bordered full" onClick={onDetails}>{translate("View details")}</button>
        <button className="mini danger-text" onClick={onDelete}>{translate("Delete")}</button>
      </div>
    </div>
  );
}

function LocalSkillDetails({ skill, onClose }: { skill: BrowserWorkflowSkill; onClose: () => void }) {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card local-skill-details" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="sparkles" size={17} className="accent-icon" />
          <div>
            <strong>{skill.title}</strong>
            <div className="muted small">{skill.domain || translate("Any website")}</div>
          </div>
          <span className="spacer" />
          <button className="plain-icon-btn" onClick={onClose} aria-label={translate("Close skill details")}><Icon name="xmark" size={15} /></button>
        </div>
        <section>
          <span className="field-label">{translate("Original task")}</span>
          <p className="skill-details-copy">{skill.task || translate("No original task recorded.")}</p>
        </section>
        <section>
          <span className="field-label">{translate("Reusable instructions")}</span>
          <pre className="skill-details-instructions">{skill.instructions}</pre>
        </section>
        <div className="muted small">{translate("Recorded browser actions: %1", skill.actions.length)}</div>
        <div className="modal-actions"><button className="secondary" onClick={onClose}>{translate("Close")}</button></div>
      </div>
    </div>
  );
}

function CustomScriptCard({
  script,
  ready,
  sync,
  sessionName,
  onEdit,
  onDelete,
  onUse,
  onSync,
}: {
  script: CustomScript;
  ready: boolean;
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
      <div className="muted small">{script.domain || translate("(any domain)")}</div>
      <div className="muted small">{translate("Runs in")} {sessionName}</div>
      <p className="small instructions-preview">{script.instructions.slice(0, 120)}…</p>
      {(!sync || sync === "idle") && <button className="link small sync-link" onClick={onSync}>{translate("Back up privately")}</button>}
      {sync === "syncing" && <span className="muted small">{translate("Backing up…")}</span>}
      {sync === "synced" && <span className="ok small"><Icon name="lock.fill" size={11} /> {translate("Private cloud backup")}</span>}
      {sync === "failed" && <button className="link small" onClick={onSync}>{translate("Backup failed · Retry")}</button>}
      <div className="skill-actions">
        <Tooltip content={ready ? translate("Use %1 in chat", script.title) : translate("Connect an agent to use this script")}><button className="btn-bordered-prominent full" disabled={!ready} onClick={onUse}>{translate("Use")}</button></Tooltip>
        <Tooltip content={translate("Edit %1", script.title)}><button className="btn-bordered full" onClick={onEdit}>{translate("Edit")}</button></Tooltip>
        <Tooltip content={translate("Delete %1", script.title)}><button className="mini" onClick={onDelete}>{translate("Delete")}</button></Tooltip>
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
  const [validationError, setValidationError] = useState("");

  const save = () => {
    if (!title.trim() || !instructions.trim()) {
      setValidationError(translate("Enter a title and instructions before saving the script."));
      return;
    }
    setValidationError("");
    onSave({
      id: script?.id ?? uid(),
      title: title.trim(),
      domain: domain.trim(),
      instructions: instructions.trim(),
      createdAt: script?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
      serverSlug: script?.serverSlug,
      submittedAt: script?.submittedAt,
    });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card script-editor">
        <h3>{script ? translate("Edit script") : translate("New script")}</h3>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setValidationError(""); }} placeholder={translate("Title")} aria-label={translate("Script title")} aria-invalid={!!validationError && !title.trim()} />
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder={translate("Domain (optional)")}
        />
        <textarea
          value={instructions}
          onChange={(e) => { setInstructions(e.target.value); setValidationError(""); }}
          placeholder={translate("Instructions for the agent…")}
          rows={8}
          aria-label={translate("Script instructions")}
          aria-invalid={!!validationError && !instructions.trim()}
        />
        {validationError && <p className="error-text" role="alert">{validationError}</p>}
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button className="secondary" onClick={onClose}>{translate("Cancel")}</button>
          <button
            className="primary"
            onClick={save}
          >{translate("Save")}</button>
        </div>
      </div>
    </div>
  );
}
