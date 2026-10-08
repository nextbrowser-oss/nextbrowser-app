import { useEffect, useState } from "react";
import { normalizeCommunity, splitKeywords, type Match } from "@nextbrowser-oss/reddit-monitoring";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import type { SkillEntry } from "../skillsCatalog";
import { REDDIT_MONITOR_LOG_FILE, announcedToday, countTrend, isNew, openMatches } from "../lib/redditmonitor/feed";
import { DEFAULT_MONITOR_INTERVAL_MINUTES, formatInterval } from "../types";
import { IntervalDial } from "./IntervalDial";
import { Icon } from "./Icon";
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

const PROFILE_KEY = "redditMonitorProfile";

function storedProfile(): string | undefined {
  try {
    return localStorage.getItem(PROFILE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

/// The Reddit skill's monitoring mode. It finds what needs an answer — the
/// account's mentions and replies, and posts and comments that name the user's
/// keywords — and ranks it by urgency, with the reasons. It never answers:
/// Draft reply hands one match to the reply agent, which shows the draft and
/// posts only what the user approves. It runs as a schedule, so it also shows
/// in the Scheduled list, and it keeps its own profile and its own state.
export function RedditMonitorView({ entry }: { entry: SkillEntry }) {
  const monitor = useStore((s) => s.redditMonitorState);
  const feed = useStore((s) => s.redditMonitorFeed);
  const busy = useStore((s) => s.redditMonitorBusy);
  const step = useStore((s) => s.redditMonitorStep);
  const notice = useStore((s) => s.redditMonitorNotice);
  const replyProfile = useStore((s) => s.watchlistProfiles[entry.id]);
  const watchedCommunities = useStore((s) => s.watchedProfiles).filter((item) => item.skillId === entry.id).map((item) => item.handle);
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
  const updateSettings = useStore((s) => s.updateRedditMonitorSettings);
  const setDone = useStore((s) => s.setRedditMatchDone);
  const draftReply = useStore((s) => s.draftRedditReply);
  const [chosenProfile, setChosenProfile] = useState<string | undefined>(() => storedProfile());
  const [interval, setIntervalChoice] = useState<number>(schedule?.intervalMinutes ?? DEFAULT_MONITOR_INTERVAL_MINUTES);
  const [showDone, setShowDone] = useState(false);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((value) => value + 1), 20_000);
    return () => window.clearInterval(timer);
  }, []);

  const running = schedule?.enabled === true;
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const browserProfiles = allBrowserProfiles.filter((profile) => workspace?.profileNames.includes(profile.name));
  // The schedule's profile wins once there is one; before that, the choice made
  // here, and the reply agent's profile only as a first suggestion.
  const profile = schedule?.profileName ?? chosenProfile ?? replyProfile ?? selectedProfile;
  const profileAvailable = browserProfiles.some((item) => item.name === profile);
  const site = entry.selector.value;
  const settings = monitor.settings;

  const account = monitor.account;
  const handle = account?.handle;
  const signedIn = account?.signedIn === true;
  const karma = monitor.karma && handle && monitor.karma.owner.toLowerCase() === handle.toLowerCase() ? monitor.karma : undefined;
  const trend = countTrend(karma?.history ?? [], karma?.total, Date.now());
  const lastPass = monitor.lastPass;
  const nextRunAt = running && schedule?.lastFiredAt && schedule.intervalMinutes
    ? schedule.lastFiredAt + schedule.intervalMinutes * MINUTE
    : undefined;
  const somethingToWatch = settings.keywords.length > 0 || settings.communities.length > 0 || settings.watchInbox;
  const missingCommunities = watchedCommunities.filter((name) => !settings.communities.some((known) => known.toLowerCase() === name.toLowerCase()));

  const matches = openMatches(feed);
  const doneMatches = feed.matches.filter((match) => feed.done.includes(match.item.key));
  const hasStats = karma?.total !== undefined || !!feed.readAt;
  const hasData = !!account || hasStats || feed.matches.length > 0;
  const notes = !busy ? [...(notice ? [notice] : []), ...(lastPass?.notes ?? [])] : [];

  const chooseProfile = (name: string) => {
    setChosenProfile(name || undefined);
    try { localStorage.setItem(PROFILE_KEY, name); } catch { /* a view preference */ }
  };

  const logLink = (
    <button className="link small" title="Reveal the monitor's log file"
      onClick={() => void invoke("app_data_reveal", { name: REDDIT_MONITOR_LOG_FILE })}>
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
          title={running ? "Stop monitoring to change the profile" : "The browser profile signed in to reddit.com"}
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
        <p className="muted small" role="status">Choose a browser profile from this workspace to monitor Reddit with.</p>
      )}

      {(running || hasData) && (
        <div className="xmon-account">
          <span className={"xmon-avatar" + (signedIn ? "" : " is-empty")} aria-hidden>
            {handle ? handle.slice(0, 1).toUpperCase() : <Icon name="person.crop.circle" size={16} />}
          </span>
          <div className="xmon-account-text">
            <strong>{handle ? `u/${handle}` : account ? "No Reddit account" : "Reading the account…"}</strong>
            <span className="muted small">
              <span className={"status-dot " + (signedIn ? "ok-dot" : "muted-dot")} />
              {signedIn
                ? `Signed in${account?.checkedAt ? ` · checked ${since(account.checkedAt)}` : ""}`
                : account
                  ? `Not signed in to ${site} — mentions wait for a sign-in; communities and search still run`
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
          <span className="muted small">Mentions of the account always count. Keywords are found as whole words in posts, comments and search.</span>
        </div>
        <TermList
          label="Keywords"
          placeholder="brand, product or phrase"
          values={settings.keywords}
          parse={splitKeywords}
          onChange={(keywords) => updateSettings({ keywords })}
        />
        <TermList
          label="Communities"
          prefix="r/"
          placeholder="community without r/"
          values={settings.communities}
          parse={(text) => text.split(/[\s,]+/).map(normalizeCommunity).filter(Boolean)}
          onChange={(communities) => updateSettings({ communities })}
          extra={missingCommunities.length > 0 && (
            <button className="link small" title="The communities the reply agent answers in"
              onClick={() => updateSettings({ communities: [...settings.communities, ...missingCommunities] })}>
              Add the reply agent's {missingCommunities.length === 1 ? `r/${missingCommunities[0]}` : `${missingCommunities.length} communities`}
            </button>
          )}
        />
        <TermList
          label="Skip"
          placeholder="words that rule a match out"
          values={settings.excludeKeywords}
          parse={splitKeywords}
          onChange={(excludeKeywords) => updateSettings({ excludeKeywords })}
        />
        <div className="rmon-toggles">
          <Toggle label="Inbox mentions and replies" value={settings.watchInbox} onChange={(watchInbox) => updateSettings({ watchInbox })} />
          <Toggle label="Search all of Reddit" value={settings.searchAll} onChange={(searchAll) => updateSettings({ searchAll })}
            title="Search covers posts; comments are matched in your communities" />
          <Toggle label="Comments in communities" value={settings.watchComments} onChange={(watchComments) => updateSettings({ watchComments })} />
        </div>
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
          {notes.map((text) => <div key={text} className="small watchlist-pass-note"><UserFacingError message={text} surface="reddit_monitor" /></div>)}
          <div className="row xmon-setup-actions">
            {hasData ? logLink : <span />}
            <span className="spacer" />
            <button
              className="btn-bordered-prominent"
              disabled={!profileAvailable || busy || !somethingToWatch}
              title={somethingToWatch ? "Read Reddit now and then on this interval" : "Add a keyword or a community first"}
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
            <span className="muted small">Karma</span>
            <div className="xmon-stat-row">
              <strong className="xmon-value">{count(karma?.total)}</strong>
              {trend.delta !== undefined && trend.delta !== 0 && (
                <span className={"xmon-delta " + (trend.delta > 0 ? "up" : "down")}>
                  <Icon name={trend.delta > 0 ? "arrow.up.circle" : "arrow.down.circle"} size={11} />
                  {trend.delta > 0 ? "+" : "−"}{Math.abs(trend.delta).toLocaleString()} · 7d
                </span>
              )}
            </div>
            <Sparkline points={trend.points} label="Karma over time" />
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
              <MatchRow key={match.item.key} match={match} fresh={isNew(feed, match.item.key)} replyReady={agentReady}
                onReply={() => void draftReply(entry, match, profile)} onDone={() => setDone(match.item.key, true)} />
            ))}
            {showDone && doneMatches.map((match) => (
              <MatchRow key={match.item.key} match={match} fresh={false} done replyReady={agentReady}
                onReply={() => void draftReply(entry, match, profile)} onDone={() => setDone(match.item.key, false)} />
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
          {notes.map((text) => <div key={text} className="small watchlist-pass-note"><UserFacingError message={text} surface="reddit_monitor" /></div>)}
        </div>
      )}
    </>
  );
}

/// A short list edited in place: chips with a remove button, and a field that
/// takes one entry or several separated by commas.
export function TermList({ label, prefix, placeholder, values, parse, onChange, extra }: {
  label: string;
  prefix?: string;
  placeholder: string;
  values: string[];
  parse: (text: string) => string[];
  onChange: (values: string[]) => void;
  extra?: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const added = parse(draft).filter((value) => !values.some((known) => known.toLowerCase() === value.toLowerCase()));
    if (added.length) onChange([...values, ...added]);
    setDraft("");
  };
  return (
    <div className="rmon-terms">
      <div className="row rmon-terms-head">
        <span className="muted small">{label}</span>
        <span className="spacer" />
        {extra}
      </div>
      <div className="rmon-terms-box">
        {values.map((value) => (
          <span key={value} className="rmon-term">
            {prefix}{value}
            <button className="rmon-term-remove" title={`Remove ${prefix ?? ""}${value}`} aria-label={`Remove ${prefix ?? ""}${value}`}
              onClick={() => onChange(values.filter((item) => item !== value))}>
              <Icon name="xmark" size={9} />
            </button>
          </span>
        ))}
        <input
          value={draft}
          placeholder={values.length ? "" : placeholder}
          spellCheck={false}
          autoCapitalize="none"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add();
            } else if (event.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => { if (draft.trim()) add(); }}
        />
      </div>
    </div>
  );
}

export function Toggle({ label, value, onChange, title }: { label: string; value: boolean; onChange: (value: boolean) => void; title?: string }) {
  return (
    <label className="rmon-toggle small" title={title}>
      <input type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

const URGENCY_LABEL = { high: "High", medium: "Medium", low: "Low" } as const;

function MatchRow({ match, fresh, done, replyReady, onReply, onDone }: {
  match: Match;
  fresh: boolean;
  done?: boolean;
  replyReady: boolean;
  onReply: () => void;
  onDone: () => void;
}) {
  const { item, source, triage } = match;
  const where = source.kind === "inbox" ? "Inbox" : item.subreddit ? `r/${item.subreddit}` : source.name;
  const what = item.kind === "post" ? item.title : item.text;
  const context = item.kind === "comment" && item.title ? `on “${item.title}”` : item.kind === "message" && item.title ? item.title : "";
  return (
    <div className={"xmon-post rmon-match" + (fresh ? " is-new" : "") + (done ? " is-done" : "") + ` is-${triage.urgency}`}>
      <div className="xmon-post-body">
        <div className="xmon-post-head small">
          <span className={"watchlist-chip rmon-urgency " + triage.urgency}>{URGENCY_LABEL[triage.urgency]}</span>
          <span className="muted">{where}</span>
          <button className="watchlist-handle" title={`Open u/${item.author}`} onClick={() => openUrl(`https://www.reddit.com/user/${item.author}`)}>
            u/{item.author}
          </button>
          {fresh && <span className="watchlist-chip ok">New</span>}
          <span className="spacer" />
          <span className="muted">{since(item.createdAt)}</span>
        </div>
        {context && <div className="muted small rmon-context">{context}</div>}
        {what && <div className={"xmon-post-text small" + (item.kind === "post" ? " rmon-title" : "")}>{what}</div>}
        {triage.reasons.length > 0 && <div className="muted small rmon-reasons">{triage.reasons.join(" · ")}</div>}
      </div>
      <div className="rmon-actions">
        <button className="mini" disabled={!replyReady} title="Hand this to the reply agent: it shows you a draft and posts only what you approve"
          onClick={onReply}>
          <Icon name="square.and.pencil" size={12} /> Draft reply
        </button>
        <div className="row rmon-actions-icons">
          <button className="plain-icon-btn" title="Open on reddit.com" onClick={() => openUrl(item.url)}>
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
