import { useEffect, useState } from "react";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import type { SkillEntry } from "../skillsCatalog";
import { announcedToday, isNew, openMatches, type SocialMatch } from "../lib/socialmonitor/feed";
import type { SocialEngineSpec } from "../lib/socialmonitor/engines";
import { countTrend } from "../lib/redditmonitor/feed";
import { DEFAULT_MONITOR_INTERVAL_MINUTES, formatInterval } from "../types";
import { IntervalDial } from "./IntervalDial";
import { Icon } from "./Icon";
import { TermList, Toggle } from "./RedditMonitorView";
import { Sparkline } from "./XMonitorView";
import { UserFacingError } from "./UserFacingError";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

function since(timestamp?: number): string {
  if (!timestamp) return "";
  const elapsed = Date.now() - timestamp;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < 60 * MINUTE) return `${Math.round(elapsed / MINUTE)}m ago`;
  if (elapsed < 48 * 60 * MINUTE) return `${Math.round(elapsed / (60 * MINUTE))}h ago`;
  return `${Math.round(elapsed / DAY)}d ago`;
}

function until(timestamp?: number): string {
  if (!timestamp) return "any moment";
  const remaining = timestamp - Date.now();
  if (remaining <= MINUTE) return "any moment";
  if (remaining < 60 * MINUTE) return `in ${Math.round(remaining / MINUTE)}m`;
  return `in ${Math.round(remaining / (60 * MINUTE))}h`;
}

function count(value?: number): string {
  return value === undefined ? "—" : value.toLocaleString();
}

function openUrl(url: string) {
  void invoke("open_external", { url }).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

function storedProfile(key: string): string | undefined {
  try {
    return localStorage.getItem(key) || undefined;
  } catch {
    return undefined;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/// The monitoring mode of a social skill — Instagram, TikTok, Facebook. Each
/// engine finds what needs an answer and ranks it, with the reasons; the panel
/// is the same for all of them, and the engine's spec says what differs: the
/// settings to edit, how a match is described, what the reply agent is asked.
/// It never answers: Draft reply hands one match to the reply agent, which
/// shows the draft and posts only what the user approves.
export function SocialMonitorView({ entry, spec }: { entry: SkillEntry; spec: SocialEngineSpec }) {
  const slot = useStore((s) => s.socialMonitors[spec.engine]);
  const replyProfile = useStore((s) => s.watchlistProfiles[entry.id]);
  const allBrowserProfiles = useStore((s) => s.profiles);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const agentReady = useStore((s) => s.agentReady());
  const schedule = useStore((s) => s.monitorScheduleFor(entry.id));
  const startSchedule = useStore((s) => s.startMonitorSchedule);
  const stopSchedule = useStore((s) => s.stopMonitorSchedule);
  const setInterval_ = useStore((s) => s.setMonitorScheduleInterval);
  const openSite = useStore((s) => s.openMonitorSite);
  const updateSettings = useStore((s) => s.updateSocialMonitorSettings);
  const setDone = useStore((s) => s.setSocialMatchDone);
  const draftReply = useStore((s) => s.draftSocialReply);
  const profileKey = `${spec.engine}:profile`;
  const [chosenProfile, setChosenProfile] = useState<string | undefined>(() => storedProfile(profileKey));
  const [interval, setIntervalChoice] = useState<number>(schedule?.intervalMinutes ?? DEFAULT_MONITOR_INTERVAL_MINUTES);
  const [showDone, setShowDone] = useState(false);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!slot) return null;
  const { state, feed, busy, step, notice } = slot;
  const settings = state.settings as Record<string, unknown>;
  const running = schedule?.enabled === true;
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const browserProfiles = allBrowserProfiles.filter((profile) => workspace?.profileNames.includes(profile.name));
  // The schedule's profile wins once there is one; before that, the choice made
  // here, and the reply agent's profile only as a first suggestion.
  const profile = schedule?.profileName ?? chosenProfile ?? replyProfile ?? selectedProfile;
  const profileAvailable = browserProfiles.some((item) => item.name === profile);
  const site = spec.site;

  const account = spec.account(state);
  const handle = account?.handle;
  const signedIn = account?.signedIn === true;
  const followers = spec.followers(state);
  const trend = countTrend(followers?.history ?? [], followers?.value, Date.now());
  const lastPass = state.lastPass;
  const nextRunAt = running && schedule?.lastFiredAt && schedule.intervalMinutes
    ? schedule.lastFiredAt + schedule.intervalMinutes * MINUTE
    : undefined;
  const canStart = spec.canStart(settings);

  const matches = openMatches(feed);
  const doneMatches = feed.matches.filter((match) => feed.done.includes(match.item.key));
  const hasStats = followers?.value !== undefined || !!feed.readAt;
  const hasData = !!account || hasStats || feed.matches.length > 0;
  const notes = !busy ? [...(notice ? [notice] : []), ...(lastPass?.notes ?? [])] : [];

  const chooseProfile = (name: string) => {
    setChosenProfile(name || undefined);
    try { localStorage.setItem(profileKey, name); } catch { /* a view preference */ }
  };

  const logLink = (
    <button className="link small" title="Reveal the monitor's log file"
      onClick={() => void invoke("app_data_reveal", { name: spec.files.log })}>
      Show log
    </button>
  );

  return (
    <>
      <div className="row watchlist-profile">
        <label className="muted small">Profile</label>
        <select
          value={profileAvailable ? profile : "__choose_profile__"}
          disabled={busy || running}
          title={running ? "Stop monitoring to change the profile" : `The browser profile signed in to ${site}`}
          onChange={(event) => chooseProfile(event.target.value)}
        >
          {!profileAvailable && <option value="__choose_profile__" disabled>Choose a profile in this workspace</option>}
          {browserProfiles.map((item) => (
            <option key={item.name} value={item.name}>
              {item.name}{item.country ? ` · ${item.country.toUpperCase()}` : ""}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="mini" disabled={busy || !profileAvailable} title={`Open ${site} in this profile to sign in or switch account`}
          onClick={() => void openSite(entry, profile)}>
          Open {site}
        </button>
      </div>
      {!profileAvailable && (
        <p className="muted small" role="status">Choose a browser profile from this workspace to monitor {spec.name} with.</p>
      )}

      {(running || hasData) && (
        <div className="xmon-account">
          <span className={"xmon-avatar" + (signedIn ? "" : " is-empty")} aria-hidden>
            {handle ? handle.slice(0, 1).toUpperCase() : <Icon name="person.crop.circle" size={16} />}
          </span>
          <div className="xmon-account-text">
            <strong>{handle ? `${spec.handlePrefix}${handle}` : account ? `No ${spec.name} account` : "Reading the account…"}</strong>
            <span className="muted small">
              <span className={"status-dot " + (signedIn ? "ok-dot" : "muted-dot")} />
              {signedIn
                ? `Signed in${account?.checkedAt ? ` · checked ${since(account.checkedAt)}` : ""}`
                : account
                  ? `Not signed in to ${site} — ${spec.signedOutNote}`
                  : "The first check is on its way"}
            </span>
          </div>
          <span className="spacer" />
          {!running && (
            <button className="plain-icon-btn" disabled={busy || !profileAvailable}
              title="Read the signed-in account again" aria-label="Read the signed-in account again"
              onClick={() => void openSite(entry, profile)}>
              <Icon name="arrow.clockwise" size={14} />
            </button>
          )}
        </div>
      )}

      <div className="xmon-setup rmon-watch">
        <div className="xmon-setup-head">
          <strong className="small">What to watch</strong>
          <span className="muted small">{spec.intro}</span>
        </div>
        {spec.lists.map((list) => (
          <TermList
            key={list.key}
            label={list.label}
            prefix={list.prefix}
            placeholder={list.placeholder}
            values={list.read ? list.read(settings[list.key]) : strings(settings[list.key])}
            parse={list.parse}
            onChange={(values) => updateSettings(spec.engine, { [list.key]: list.write ? list.write(values) : values })}
          />
        ))}
        {spec.toggles.length > 0 && (
          <div className="rmon-toggles">
            {spec.toggles.map((toggle) => (
              <Toggle key={toggle.key} label={toggle.label} title={toggle.title} value={settings[toggle.key] === true}
                onChange={(value) => updateSettings(spec.engine, { [toggle.key]: value })} />
            ))}
          </div>
        )}
      </div>

      {!running && (
        <div className="xmon-setup">
          <div className="xmon-setup-head">
            <strong className="small">Schedule</strong>
            {busy && step && <span className="muted small">{`${step}…`}</span>}
          </div>
          <IntervalDial
            value={interval}
            onChange={(minutes) => {
              setIntervalChoice(minutes);
              if (schedule) setInterval_(entry.id, minutes);
            }}
          />
          {notes.map((text) => <div key={text} className="small watchlist-pass-note"><UserFacingError message={text} surface="social_monitor" /></div>)}
          <div className="row xmon-setup-actions">
            {hasData ? logLink : <span />}
            <span className="spacer" />
            <button
              className="btn-bordered-prominent"
              disabled={!profileAvailable || busy || !canStart}
              title={canStart ? `Read ${spec.name} now and then on this interval` : spec.startHint}
              onClick={() => void startSchedule(entry, { intervalMinutes: interval, profileName: profile })}
            >
              <Icon name="play.fill" size={13} /> Start
            </button>
          </div>
        </div>
      )}

      {hasStats && (
        <div className="xmon-stats">
          <div className="xmon-stat xmon-stat-main">
            <span className="muted small">Followers</span>
            <div className="xmon-stat-row">
              <strong className="xmon-value">{count(followers?.value)}</strong>
              {trend.delta !== undefined && trend.delta !== 0 && (
                <span className={"xmon-delta " + (trend.delta > 0 ? "up" : "down")}>
                  <Icon name={trend.delta > 0 ? "arrow.up.circle" : "arrow.down.circle"} size={11} />
                  {trend.delta > 0 ? "+" : "−"}{Math.abs(trend.delta).toLocaleString()} · 7d
                </span>
              )}
            </div>
            <Sparkline points={trend.points} label="Followers over time" />
          </div>
          <div className="xmon-stat">
            <span className="muted small">New matches · 24h</span>
            <strong className="xmon-value">{feed.readAt ? announcedToday(feed, Date.now()).toLocaleString() : "—"}</strong>
          </div>
          <div className="xmon-stat">
            <span className="muted small">Urgent · 24h</span>
            <strong className={"xmon-value" + (announcedToday(feed, Date.now(), "high") > 0 ? " rmon-urgent-value" : "")}>
              {feed.readAt ? announcedToday(feed, Date.now(), "high").toLocaleString() : "—"}
            </strong>
          </div>
        </div>
      )}

      {hasData && feed.matches.length > 0 && (
        <div className="xmon-feed">
          <div className="row xmon-feed-head">
            <strong className="small">Needs a look{matches.length ? ` · ${matches.length}` : ""}</strong>
            <span className="spacer" />
            {doneMatches.length > 0 && (
              <button className="link small" onClick={() => setShowDone((value) => !value)}>
                {showDone ? "Hide done" : `${doneMatches.length} done`}
              </button>
            )}
            {feed.readAt && <span className="muted small">Updated {since(feed.readAt)}</span>}
          </div>
          <div className="xmon-posts">
            {matches.length === 0 && !showDone && <div className="muted small">All caught up.</div>}
            {matches.map((match) => (
              <MatchRow key={match.item.key} spec={spec} match={match} fresh={isNew(feed, match.item.key)} replyReady={agentReady}
                onReply={() => void draftReply(entry, match, profile)} onDone={() => setDone(spec.engine, match.item.key, true)} />
            ))}
            {showDone && doneMatches.map((match) => (
              <MatchRow key={match.item.key} spec={spec} match={match} fresh={false} done replyReady={agentReady}
                onReply={() => void draftReply(entry, match, profile)} onDone={() => setDone(spec.engine, match.item.key, false)} />
            ))}
          </div>
          {!agentReady && <div className="muted small">Connect an agent to draft replies. It shows every draft before anything is posted.</div>}
        </div>
      )}

      {running && (
        <div className="watchlist-loop xmon-running">
          <div className="row xmon-running-row">
            <span className={"status-dot " + (busy ? "warn-dot" : "ok-dot")} />
            <div className="xmon-running-text">
              <strong className="small">{busy ? "Working" : `Running · every ${formatInterval(schedule?.intervalMinutes ?? interval)}`}</strong>
              <span className="muted small">
                {busy && step
                  ? `${step}…`
                  : `Next check ${until(nextRunAt)}${lastPass ? ` · last ${since(lastPass.at)}` : ""}`}
              </span>
            </div>
            <span className="spacer" />
            {logLink}
            <button className="btn-bordered" title="Stop monitoring" onClick={() => stopSchedule(entry.id)}>
              <Icon name="stop" size={14} /> Stop
            </button>
          </div>
          {notes.map((text) => <div key={text} className="small watchlist-pass-note"><UserFacingError message={text} surface="social_monitor" /></div>)}
        </div>
      )}
    </>
  );
}

const URGENCY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

function MatchRow({ spec, match, fresh, done, replyReady, onReply, onDone }: {
  spec: SocialEngineSpec;
  match: SocialMatch;
  fresh: boolean;
  done?: boolean;
  replyReady: boolean;
  onReply: () => void;
  onDone: () => void;
}) {
  const { item, triage } = match;
  const context = spec.context(match);
  const authorUrl = spec.authorUrl(match);
  return (
    <div className={"xmon-post rmon-match" + (fresh ? " is-new" : "") + (done ? " is-done" : "") + ` is-${triage.urgency}`}>
      <div className="xmon-post-body">
        <div className="xmon-post-head small">
          <span className={"watchlist-chip rmon-urgency " + triage.urgency}>{URGENCY_LABEL[triage.urgency]}</span>
          <span className="muted">{spec.where(match)}</span>
          {item.author && (authorUrl
            ? (
              <button className="watchlist-handle" title={`Open ${item.author}`} onClick={() => openUrl(authorUrl)}>
                {spec.handlePrefix}{item.author}
              </button>
            )
            : <strong className="small">{spec.handlePrefix}{item.author}</strong>)}
          {fresh && <span className="watchlist-chip ok">New</span>}
          <span className="spacer" />
          <span className="muted">{since(item.createdAt)}</span>
        </div>
        {context && <div className="muted small rmon-context">{context}</div>}
        {item.text && <div className={"xmon-post-text small" + (item.kind === "post" || item.kind === "video" ? " rmon-title" : "")}>{item.text}</div>}
        {triage.reasons.length > 0 && <div className="muted small rmon-reasons">{triage.reasons.join(" · ")}</div>}
      </div>
      <div className="rmon-actions">
        <button className="mini" disabled={!replyReady} title="Hand this to the reply agent: it shows you a draft and posts only what you approve"
          onClick={onReply}>
          <Icon name="square.and.pencil" size={12} /> Draft reply
        </button>
        <div className="row rmon-actions-icons">
          <button className="plain-icon-btn" title={`Open on ${spec.site}`} onClick={() => openUrl(item.url)}>
            <Icon name="arrow.up.right.square" size={14} />
          </button>
          <button className="plain-icon-btn" title={done ? "Bring it back" : "Mark done"} aria-label={done ? "Bring it back" : "Mark done"} onClick={onDone}>
            <Icon name={done ? "arrow.uturn.left" : "checkmark.circle.fill"} size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
