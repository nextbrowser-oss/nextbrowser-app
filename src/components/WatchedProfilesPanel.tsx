import { useEffect, useState } from "react";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { fillTemplate, type SkillEntry } from "../skillsCatalog";
import {
  DEFAULT_WATCHLIST_INTERVAL_MINUTES,
  WATCHLIST_INTERVAL_CHOICES,
  normalizeWatchHandle,
  type WatchedProfile,
  type WatchedProfileReport,
} from "../types";
import { replyBudget, type XReplyDraft } from "../lib/xreply/state";
import { Icon } from "./Icon";

const MINUTE = 60_000;

function since(timestamp?: number): string {
  if (!timestamp) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < 60 * MINUTE) return `${Math.round(elapsed / MINUTE)}m ago`;
  if (elapsed < 48 * 60 * MINUTE) return `${Math.round(elapsed / (60 * MINUTE))}h ago`;
  return `${Math.round(elapsed / (24 * 60 * MINUTE))}d ago`;
}

function until(timestamp?: number): string {
  if (!timestamp) return "any moment";
  const remaining = timestamp - Date.now();
  if (remaining <= MINUTE) return "any moment";
  if (remaining < 60 * MINUTE) return `in ${Math.round(remaining / MINUTE)}m`;
  return `in ${Math.round(remaining / (60 * MINUTE))}h`;
}

/** What the panel was about to do when it found the profile signed out. */
type PendingAction = { kind: "start"; minutes: number } | { kind: "add"; handle: string };

/// The panel shows three separate truths and never blurs them: the list is the
/// user's, the per-account chips are what the engine observed on the page, and
/// the drafts are what the model wrote and nobody has approved yet.
export function WatchedProfilesPanel({ entry, onClose }: { entry: SkillEntry; onClose: () => void }) {
  const watchlist = entry.watchlist;
  const profiles = useStore((s) => s.watchedProfiles).filter((item) => item.skillId === entry.id);
  const reports = useStore((s) => s.watchReports);
  const watchPublishers = useStore((s) => s.watchPublishers);
  const engineState = useStore((s) => s.xReplyState);
  const busy = useStore((s) => s.xReplyBusy);
  const signInNeeded = useStore((s) => s.xReplySignInNeeded);
  const browserProfiles = useStore((s) => s.profiles);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const dismissSignIn = useStore((s) => s.dismissXReplySignIn);
  const step = useStore((s) => s.xReplyStep);
  const ready = useStore((s) => s.agentReady());
  const addWatchedProfile = useStore((s) => s.addWatchedProfile);
  const removeWatchedProfile = useStore((s) => s.removeWatchedProfile);
  const setWatchedProfileEnabled = useStore((s) => s.setWatchedProfileEnabled);
  const subscribeWatchedProfile = useStore((s) => s.subscribeWatchedProfile);
  const runWatchlistPass = useStore((s) => s.runWatchlistPass);
  const loadWatchReports = useStore((s) => s.loadWatchReports);
  const openSkillSite = useStore((s) => s.openSkillSite);
  const checkSignIn = useStore((s) => s.checkXReplySignIn);
  const subscribeHandleNow = useStore((s) => s.subscribeXReplyHandle);
  const setAutoSend = useStore((s) => s.setXReplyAutoSend);
  const updateSettings = useStore((s) => s.updateXReplySettings);
  const reviewDraft = useStore((s) => s.reviewXReplyDraft);
  const sendDraft = useStore((s) => s.sendXReplyDraft);
  const run = useStore((s) => s.watchlistRuns).find((item) => item.skillId === entry.id);
  const startWatchlistRun = useStore((s) => s.startWatchlistRun);
  const stopWatchlistRun = useStore((s) => s.stopWatchlistRun);

  const engine = watchlist?.engine === "x-reply";
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [interval, setInterval] = useState(run?.intervalMinutes ?? DEFAULT_WATCHLIST_INTERVAL_MINUTES);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [signInTried, setSignInTried] = useState(false);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    if (!engine) void loadWatchReports(entry);
  }, [engine, entry, loadWatchReports]);

  useEffect(() => {
    if (!run?.enabled && !busy) return;
    const timer = window.setInterval(() => setNowTick((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, [busy, run?.enabled]);

  if (!watchlist) return null;
  const prefix = watchlist.prefix ?? "";
  const site = entry.selector.value;
  const activeCount = profiles.filter((item) => item.enabled).length;
  const publisher = engine ? engineState.publisher : watchPublishers[entry.id];
  const signedIn = publisher?.signedIn === true;
  const pendingDrafts = engine ? engineState.drafts.filter((item) => item.status === "pending") : [];
  const recentDrafts = engine
    ? engineState.drafts.filter((item) => item.status !== "pending" && item.status !== "rejected").slice(-3).reverse()
    : [];

  const reportFor = (profile: WatchedProfile): WatchedProfileReport | undefined => {
    if (engine) return engineState.handles[profile.handle.toLowerCase()];
    return reports[`${entry.id}\n${profile.handle.toLowerCase()}`];
  };

  const perform = (action: PendingAction) => {
    setPending(null);
    if (action.kind === "start") void startWatchlistRun(entry, action.minutes);
    else void subscribeHandleNow(entry, action.handle);
  };

  /** Anything that touches the site needs a signed-in profile. The panel asks
   *  for it at the moment it is needed and then resumes what the user pressed,
   *  instead of standing in front of the list from the start. */
  const withSignIn = async (action: PendingAction) => {
    if (!engine || signedIn) {
      perform(action);
      return;
    }
    if (await checkSignIn(entry)) {
      perform(action);
      return;
    }
    setSignInTried(false);
    setPending(action);
  };

  const confirmSignedIn = async () => {
    const ok = await checkSignIn(entry);
    setSignInTried(true);
    if (!ok) return;
    if (pending) perform(pending);
    else setPending(null);
  };

  const cancelSignIn = () => {
    setPending(null);
    dismissSignIn();
  };

  const add = () => {
    const handle = normalizeWatchHandle(draft);
    if (!handle) {
      setError(`Enter one ${watchlist.placeholder}.`);
      return;
    }
    const known = profiles.some((item) => item.handle.toLowerCase() === handle.toLowerCase());
    addWatchedProfile(entry.id, handle);
    setDraft("");
    setError(known ? `${prefix}${handle} is already on the list.` : "");
    // Confirming an account subscribes it there and then: the bell goes on and
    // the account's current position is recorded, so the first pass answers what
    // comes next rather than the whole visible timeline.
    if (!known && engine) void withSignIn({ kind: "add", handle });
  };

  const openProfile = (handle: string) => {
    if (!watchlist.profileUrl) return;
    const url = fillTemplate(watchlist.profileUrl, { handle });
    void invoke("open_external", { url }).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  };

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card watchlist-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="row watchlist-head">
          <span className="watchlist-head-icon"><Icon name={entry.categoryIcon} size={16} /></span>
          <div className="watchlist-title">
            <strong>{watchlist.title}</strong>
            <span className="muted small">
              {signedIn && publisher?.handle
                ? `${prefix}${publisher.handle} · ${activeCount} watched`
                : `${activeCount || "No"} watched`}
            </span>
          </div>
          <span className="spacer" />
          {!engine && (
            <button className="plain-icon-btn" title="Reload what the agent recorded" onClick={() => void loadWatchReports(entry)}>
              <Icon name="arrow.clockwise" size={15} />
            </button>
          )}
          <button className="plain-icon-btn" onClick={onClose} aria-label="Close watched profiles">
            <Icon name="xmark" size={15} />
          </button>
        </div>

        {engine && (
          <div className="row watchlist-profile">
            <label className="muted small">Profile</label>
            <select
              value={engineState.profileName ?? ""}
              onChange={(event) => {
                const name = event.target.value || undefined;
                // A different profile is a different browser with its own
                // cookies, so who was signed in no longer says anything.
                updateSettings({ profileName: name, publisher: undefined });
              }}
            >
              <option value="">{selectedProfile ? `Selected · ${selectedProfile}` : "Default session"}</option>
              {browserProfiles.map((profile) => (
                <option key={profile.name} value={profile.name}>
                  {profile.name}{profile.country ? ` · ${profile.country.toUpperCase()}` : ""}
                </option>
              ))}
            </select>
            <span className="spacer" />
            <button className="mini" disabled={busy} title={`Open ${site} in this profile to sign in or switch account`}
              onClick={() => void openSkillSite(entry)}>
              Open {site}
            </button>
          </div>
        )}

        <div className="row watchlist-add">
          <div className="watchlist-input">
            {prefix && <span className="watchlist-prefix">{prefix}</span>}
            <input
              value={draft}
              placeholder={watchlist.placeholder}
              spellCheck={false}
              autoCapitalize="none"
              onChange={(event) => { setDraft(event.target.value); setError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") add(); }}
            />
          </div>
          <button className="btn-bordered-prominent" disabled={!draft.trim() || busy} onClick={add}>
            <Icon name="plus" size={14} /> Add
          </button>
        </div>
        {error && <div className="small error watchlist-error">{error}</div>}

        {profiles.length === 0 ? (
          <div className="watchlist-empty">
            <span className="scheduled-empty-icon"><Icon name="person.crop.circle" size={22} /></span>
            <strong>Nothing watched yet</strong>
            <span className="muted small">
              {engine ? `Add an account — its ${site} post notifications get switched on.` : "Add an account to watch."}
            </span>
          </div>
        ) : (
          <div className="watchlist-rows">
            {profiles.map((profile) => {
              const report = reportFor(profile);
              const working = busy && !!step?.includes(`@${profile.handle}`);
              return (
                <div key={profile.id} className={"watchlist-row" + (profile.enabled ? "" : " is-paused")}>
                  <div className="watchlist-avatar" aria-hidden>{profile.handle.slice(0, 1).toUpperCase()}</div>
                  <div className="watchlist-info">
                    <button
                      className="watchlist-handle"
                      disabled={!watchlist.profileUrl}
                      title={watchlist.profileUrl ? "Open the profile" : undefined}
                      onClick={() => openProfile(profile.handle)}
                    >
                      {prefix}{profile.handle}
                      {watchlist.profileUrl && <Icon name="arrow.up.right.square" size={11} />}
                    </button>
                    <div className="watchlist-chips">
                      {!profile.enabled && <span className="watchlist-chip">Paused</span>}
                      {working && <span className="watchlist-chip">Working…</span>}
                      {report?.notifications === true && (
                        <span className="watchlist-chip ok"><Icon name="checkmark.seal.fill" size={11} /> Notifications on</span>
                      )}
                      {report?.notifications === false && (
                        <span className="watchlist-chip warn"><Icon name="exclamationmark.triangle.fill" size={11} /> Notifications off</span>
                      )}
                      {report?.following === false && (
                        <span className="watchlist-chip warn"><Icon name="exclamationmark.triangle.fill" size={11} /> Not followed</span>
                      )}
                      {report?.repliesSent != null && report.repliesSent > 0 && (
                        <span className="watchlist-chip">{report.repliesSent} {report.repliesSent === 1 ? "reply" : "replies"}</span>
                      )}
                      {report?.lastCheckedAt && <span className="watchlist-chip">Checked {since(report.lastCheckedAt)}</span>}
                      {!report && !working && <span className="watchlist-chip">Not visited yet</span>}
                    </div>
                    {report?.note && <div className="muted small watchlist-note">{report.note}</div>}
                  </div>
                  <div className="watchlist-actions">
                    <button
                      className="mini"
                      disabled={!ready || busy}
                      title={engine ? "Open this profile and turn on post notifications" : "Ask the agent to subscribe"}
                      onClick={() => void (engine
                        ? withSignIn({ kind: "add", handle: profile.handle })
                        : subscribeWatchedProfile(entry, profile.id))}
                    >
                      Subscribe
                    </button>
                    <button
                      className="plain-icon-btn"
                      title={profile.enabled ? "Pause this account" : "Resume this account"}
                      onClick={() => setWatchedProfileEnabled(profile.id, !profile.enabled)}
                    >
                      <Icon name={profile.enabled ? "stop" : "play.circle"} size={15} />
                    </button>
                    <button className="plain-icon-btn" title="Remove from the list" onClick={() => removeWatchedProfile(profile.id)}>
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {(pending || (engine && signInNeeded)) && (
          <div className="watchlist-signin">
            <div className="watchlist-signin-text">
              <strong className="small"><Icon name="lock" size={13} /> Sign in to {site}</strong>
              <div className="muted small">
                {signInTried
                  ? "Still signed out — finish in the browser window, then confirm."
                  : `Opens ${site} in this profile. Sign in there, then confirm.`}
              </div>
            </div>
            <div className="row watchlist-signin-actions">
              <button className="mini" disabled={busy} onClick={cancelSignIn}>Cancel</button>
              <span className="spacer" />
              <button className="btn-bordered" disabled={busy} onClick={() => void openSkillSite(entry)}>
                <Icon name="arrow.up.right.square" size={13} /> Sign in
              </button>
              <button className="btn-bordered-prominent" disabled={busy} onClick={() => void confirmSignedIn()}>
                I'm signed in
              </button>
            </div>
          </div>
        )}

        {engine && (pendingDrafts.length > 0 || recentDrafts.length > 0) && (
          <div className="watchlist-drafts">
            <div className="row watchlist-drafts-head">
              <strong className="small">Drafts</strong>
              {pendingDrafts.length > 0 && <span className="profiles-count">{pendingDrafts.length}</span>}
              <span className="spacer" />
              <label className="muted small watchlist-autosend">
                <input type="checkbox" checked={engineState.autoSend} onChange={(event) => setAutoSend(event.target.checked)} />
                Auto-send
              </label>
            </div>
            {pendingDrafts.map((item) => (
              <DraftRow key={item.id} draft={item} prefix={prefix} busy={busy}
                onSend={() => void sendDraft(entry, item.id)}
                onReject={() => reviewDraft(item.id, "reject")} />
            ))}
            {recentDrafts.map((item) => (
              <div key={item.id} className="watchlist-draft is-done">
                <div className="watchlist-draft-head">
                  <span className="muted small">{prefix}{item.handle}</span>
                  <span className={"watchlist-chip " + (item.status === "sent" ? "ok" : "warn")}>{item.status}</span>
                  {item.gif && <span className="watchlist-chip">GIF: {item.gif}</span>}
                  {item.replyUrl && (
                    <button className="link small" onClick={() => void invoke("open_external", { url: item.replyUrl })}>Open</button>
                  )}
                </div>
                <div className="small watchlist-draft-text">{item.replyText}</div>
                {item.error && <div className="small muted">{item.error}</div>}
              </div>
            ))}
          </div>
        )}

        <div className="watchlist-loop">
          <div className="watchlist-loop-state">
            <span className={"status-dot " + (busy ? "warn-dot" : run?.enabled ? "ok-dot" : "muted-dot")} />
            <div>
              <strong className="small">{busy ? "Working" : run?.enabled ? "Running" : "Stopped"}</strong>
              <div className="muted small">
                {busy && step ? `${step}…`
                  : run?.enabled
                    ? `Next check ${until(run.nextRunAt)}${engineState.lastPassSummary ? ` · ${engineState.lastPassSummary}` : ""}`
                    : engineState.lastPassSummary || "Checks the list on a schedule while NextBrowser is open."}
              </div>
            </div>
          </div>
          <div className="row watchlist-loop-controls">
            <label className="muted small watchlist-interval">
              Every
              <select
                value={run?.enabled ? run.intervalMinutes : interval}
                onChange={(event) => {
                  const minutes = Number(event.target.value);
                  setInterval(minutes);
                  if (run?.enabled) void startWatchlistRun(entry, minutes);
                }}
              >
                {WATCHLIST_INTERVAL_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>{minutes < 60 ? `${minutes} min` : `${minutes / 60} h`}</option>
                ))}
              </select>
            </label>
            {engine && (
              <label className="muted small watchlist-limits"
                title="Unused hourly budget carries over, up to the daily cap.">
                Max
                <input type="number" min={1} max={60} value={engineState.hourlyMax}
                  onChange={(event) => {
                    const value = Math.max(1, Math.min(60, Math.round(Number(event.target.value) || 1)));
                    updateSettings({ hourlyMax: value });
                  }} />
                /h
                <input type="number" min={1} max={500} value={engineState.dailyMax}
                  onChange={(event) => {
                    const value = Math.max(1, Math.min(500, Math.round(Number(event.target.value) || 1)));
                    updateSettings({ dailyMax: value });
                  }} />
                /day
              </label>
            )}
            {engine && (
              <span className="watchlist-chip" title="Replies that may go out right now — the stacked hourly budget, capped by the day.">
                {replyBudget(engineState, Date.now())} ready
              </span>
            )}
            <span className="spacer" />
            <button
              className="btn-bordered"
              disabled={!ready || busy || activeCount === 0 || run?.enabled}
              title="Run one pass now without starting the loop"
              onClick={() => void runWatchlistPass(entry)}
            >
              Check once
            </button>
            {run?.enabled ? (
              <button className="btn-bordered" title="Stop the loop and the pass in progress" onClick={() => stopWatchlistRun(entry.id)}>
                <Icon name="stop" size={14} /> Stop
              </button>
            ) : (
              <button
                className="btn-bordered-prominent"
                disabled={!ready || busy || activeCount === 0}
                title="Check the watched profiles on this interval"
                onClick={() => void withSignIn({ kind: "start", minutes: interval })}
              >
                <Icon name="play.fill" size={13} /> Start
              </button>
            )}
          </div>
        </div>
        {!ready && <div className="muted small watchlist-hint">Connect an agent — it writes the replies.</div>}
      </div>
    </div>
  );
}

function DraftRow({ draft, prefix, busy, onSend, onReject }: {
  draft: XReplyDraft;
  prefix: string;
  busy: boolean;
  onSend: () => void;
  onReject: () => void;
}) {
  return (
    <div className="watchlist-draft">
      <div className="watchlist-draft-head">
        <span className="muted small">Reply to {prefix}{draft.handle}</span>
        <button className="link small" onClick={() => void invoke("open_external", { url: draft.postUrl })}>Source post</button>
        <span className="spacer" />
        <span className="muted small">{since(draft.createdAt)}</span>
      </div>
      <div className="muted small watchlist-draft-source">{draft.postText.slice(0, 160)}{draft.postText.length > 160 ? "…" : ""}</div>
      <div className="watchlist-draft-text">{draft.replyText}</div>
      <div className="row watchlist-draft-actions">
        {draft.gifQuery && <span className="watchlist-chip">GIF: {draft.gifQuery}</span>}
        <span className="spacer" />
        <button className="mini" onClick={onReject}>Discard</button>
        <button className="btn-bordered-prominent" disabled={busy} onClick={onSend}>Send reply</button>
      </div>
    </div>
  );
}
