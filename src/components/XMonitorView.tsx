import { useEffect, useState } from "react";
import type { FeedPost } from "@nextbrowser-oss/x-monitoring";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import type { SkillEntry } from "../skillsCatalog";
import { X_MONITOR_LOG_FILE, followerTrend, isNew } from "../lib/xmonitor/feed";
import { DEFAULT_MONITOR_INTERVAL_MINUTES, formatInterval } from "../types";
import { IntervalDial } from "./IntervalDial";
import { Icon } from "./Icon";

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

function count(value?: number): string {
  return value === undefined ? "—" : value.toLocaleString();
}

function openUrl(url: string) {
  void invoke("open_external", { url }).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
}

const PROFILE_KEY = "xMonitorProfile";

function storedProfile(): string | undefined {
  try {
    return localStorage.getItem(PROFILE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function until(timestamp?: number): string {
  if (!timestamp) return "any moment";
  const remaining = timestamp - Date.now();
  if (remaining <= MINUTE) return "any moment";
  if (remaining < 60 * MINUTE) return `in ${Math.round(remaining / MINUTE)}m`;
  return `in ${Math.round(remaining / (60 * MINUTE))}h`;
}

/// The X skill's monitoring mode. Everything on it is read from x.com, never
/// done there: who is signed in, how many follow the account, and what the
/// accounts it follows have posted. It runs as a schedule, so it also shows in
/// the Scheduled list, and it keeps its own profile and its own state: the
/// reply agent's settings are never touched from here.
export function XMonitorView({ entry }: { entry: SkillEntry }) {
  const monitor = useStore((s) => s.xMonitorState);
  const feed = useStore((s) => s.xMonitorFeed);
  const replyProfile = useStore((s) => s.xReplyState.profileName);
  const busy = useStore((s) => s.xReplyBusy);
  const step = useStore((s) => s.xReplyStep);
  const allBrowserProfiles = useStore((s) => s.profiles);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const schedule = useStore((s) => s.monitorScheduleFor(entry.id));
  const startSchedule = useStore((s) => s.startMonitorSchedule);
  const stopSchedule = useStore((s) => s.stopMonitorSchedule);
  const setInterval_ = useStore((s) => s.setMonitorScheduleInterval);
  const openSite = useStore((s) => s.openMonitorSite);
  const [chosenProfile, setChosenProfile] = useState<string | undefined>(() => storedProfile());
  const [interval, setIntervalChoice] = useState<number>(schedule?.intervalMinutes ?? DEFAULT_MONITOR_INTERVAL_MINUTES);
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

  const account = monitor.account;
  const handle = account?.handle;
  const signedIn = account?.signedIn === true;
  const own = handle ? monitor.followers[handle.toLowerCase()] : undefined;
  const trend = followerTrend(own?.history ?? [], own?.followers, Date.now());
  const fresh = feed.announced.filter((item) => Date.now() - item.at < DAY).length;
  const lastPass = monitor.lastPass;
  const nextRunAt = running && schedule?.lastFiredAt && schedule.intervalMinutes
    ? schedule.lastFiredAt + schedule.intervalMinutes * MINUTE
    : undefined;

  const chooseProfile = (name: string) => {
    setChosenProfile(name || undefined);
    try { localStorage.setItem(PROFILE_KEY, name); } catch { /* a view preference */ }
  };

  // Nothing is shown that nothing has been read for: before the first pass the
  // panel is the profile and the schedule, and the dashboard appears once there
  // is an account to show. After Stop the schedule comes back on top and what
  // was read stays below it.
  const hasStats = own?.followers !== undefined || !!feed.readAt;
  const hasData = !!account || hasStats || feed.posts.length > 0;
  const notes = !busy ? lastPass?.notes ?? [] : [];
  const logLink = (
    <button className="link small" title="Reveal the monitor's log file"
      onClick={() => void invoke("app_data_reveal", { name: X_MONITOR_LOG_FILE })}>
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
          title={running ? "Stop monitoring to change the profile" : "The browser profile signed in to x.com"}
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
        <p className="muted small" role="status">Choose a browser profile from this workspace to monitor its X account.</p>
      )}

      {(running || hasData) && (
        <div className="xmon-account">
          <span className={"xmon-avatar" + (signedIn ? "" : " is-empty")} aria-hidden>
            {handle ? handle.slice(0, 1).toUpperCase() : <Icon name="person.crop.circle" size={16} />}
          </span>
          <div className="xmon-account-text">
            <strong>{handle ? `@${handle}` : account ? "No X account" : "Reading the account…"}</strong>
            <span className="muted small">
              <span className={"status-dot " + (signedIn ? "ok-dot" : "muted-dot")} />
              {signedIn
                ? `Signed in${account?.checkedAt ? ` · checked ${since(account.checkedAt)}` : ""}`
                : account
                  ? `Not signed in to ${site} — open it and sign in`
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
          {notes.map((text) => <div key={text} className="small watchlist-pass-note">{text}</div>)}
          <div className="row xmon-setup-actions">
            {hasData ? logLink : <span />}
            <span className="spacer" />
            <button
              className="btn-bordered-prominent"
              disabled={!profileAvailable || busy}
              title="Read the account now and then on this interval"
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
              <strong className="xmon-value">{count(own?.followers)}</strong>
              {trend.delta !== undefined && trend.delta !== 0 && (
                <span className={"xmon-delta " + (trend.delta > 0 ? "up" : "down")}>
                  <Icon name={trend.delta > 0 ? "arrow.up.circle" : "arrow.down.circle"} size={11} />
                  {trend.delta > 0 ? "+" : "−"}{Math.abs(trend.delta).toLocaleString()} · 7d
                </span>
              )}
            </div>
            {own?.exact === false && <span className="muted small">Rounded by x.com</span>}
            <Sparkline points={trend.points} label="Followers over time" />
          </div>
          <div className="xmon-stat">
            <span className="muted small">Following</span>
            <strong className="xmon-value">{count(own?.following)}</strong>
          </div>
          <div className="xmon-stat">
            <span className="muted small">New posts · 24h</span>
            <strong className="xmon-value">{feed.readAt ? fresh.toLocaleString() : "—"}</strong>
          </div>
        </div>
      )}

      {hasData && feed.posts.length > 0 && (
        <div className="xmon-feed">
          <div className="row xmon-feed-head">
            <strong className="small">From your Following feed</strong>
            <span className="spacer" />
            {feed.readAt && <span className="muted small">Updated {since(feed.readAt)}</span>}
          </div>
          <div className="xmon-posts">
            {feed.posts.map((post) => <PostRow key={post.key} post={post} fresh={isNew(feed, post.key)} />)}
          </div>
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
          {notes.map((text) => <div key={text} className="small watchlist-pass-note">{text}</div>)}
        </div>
      )}
    </>
  );
}

function PostRow({ post, fresh }: { post: FeedPost; fresh: boolean }) {
  const media = [
    post.photos ? `${post.photos} photo${post.photos === 1 ? "" : "s"}` : "",
    post.video ? "video" : "",
    post.card ? "link" : "",
  ].filter(Boolean);
  return (
    <div className={"xmon-post" + (fresh ? " is-new" : "")}>
      <span className="xmon-post-avatar" aria-hidden>{post.author.slice(0, 1).toUpperCase()}</span>
      <div className="xmon-post-body">
        <div className="xmon-post-head small">
          <button className="watchlist-handle" title={`Open @${post.author}`} onClick={() => openUrl(`https://x.com/${post.author}`)}>
            @{post.author}
          </button>
          {post.repost && post.repostedBy && <span className="muted">reposted by @{post.repostedBy}</span>}
          {post.reply && <span className="watchlist-chip">Reply</span>}
          {fresh && <span className="watchlist-chip ok">New</span>}
          <span className="spacer" />
          <span className="muted">{since(post.createdAt)}</span>
        </div>
        {post.text && <div className="xmon-post-text small">{post.text}</div>}
        {(media.length > 0 || post.quotedUrl) && (
          <div className="watchlist-chips">
            {media.map((item) => <span key={item} className="watchlist-chip">{item}</span>)}
            {post.quotedUrl && <span className="watchlist-chip">Quote</span>}
          </div>
        )}
      </div>
      <button className="plain-icon-btn" title="Open the post on x.com" onClick={() => openUrl(post.url)}>
        <Icon name="arrow.up.right.square" size={14} />
      </button>
    </div>
  );
}

/** Sparkline of one series: a 2px line in the accent, with a hover readout.
 *  The number above it is the headline; this only shows the shape. */
function Sparkline({ points, label }: { points: number[]; label: string }) {
  const [hover, setHover] = useState<number>();
  const width = 220;
  const height = 40;
  const pad = 3;
  if (points.length === 0) return <div className="xmon-spark is-empty" />;
  const series = points.length === 1 ? [points[0], points[0]] : points;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const x = (index: number) => pad + (index * (width - pad * 2)) / (series.length - 1);
  const y = (value: number) => (max === min ? height / 2 : pad + ((max - value) * (height - pad * 2)) / (max - min));
  const line = series.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const active = hover === undefined ? undefined : Math.min(hover, series.length - 1);
  return (
    <div className="xmon-spark">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${points.map((value) => value.toLocaleString()).join(", ")}`}
        onMouseMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - box.left) / box.width;
          setHover(Math.round(ratio * (series.length - 1)));
        }}
        onMouseLeave={() => setHover(undefined)}
      >
        <polyline points={`${pad},${height} ${line} ${width - pad},${height}`} className="xmon-spark-area" />
        <polyline points={line} className="xmon-spark-line" />
        {active !== undefined && (
          <>
            <line x1={x(active)} x2={x(active)} y1={0} y2={height} className="xmon-spark-cross" />
            <circle cx={x(active)} cy={y(series[active])} r={4} className="xmon-spark-dot" />
          </>
        )}
      </svg>
      {active !== undefined && <span className="xmon-spark-tip small">{series[active].toLocaleString()}</span>}
    </div>
  );
}
