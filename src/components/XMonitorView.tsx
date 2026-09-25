import { useEffect, useState } from "react";
import type { FeedPost } from "@nextbrowser-oss/x-monitoring";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import type { SkillEntry } from "../skillsCatalog";
import { X_MONITOR_LOG_FILE, followerTrend, isNew } from "../lib/xmonitor/feed";
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

/// The X skill's monitoring mode. Everything on it is read from x.com, never
/// done there: who is signed in, how many follow the account, and what the
/// accounts it follows have posted.
export function XMonitorView({ entry }: { entry: SkillEntry }) {
  const monitor = useStore((s) => s.xMonitorState);
  const feed = useStore((s) => s.xMonitorFeed);
  const replyState = useStore((s) => s.xReplyState);
  const busy = useStore((s) => s.xReplyBusy);
  const step = useStore((s) => s.xReplyStep);
  const allBrowserProfiles = useStore((s) => s.profiles);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const selectedProfile = useStore((s) => s.selectedProfile);
  const updateSettings = useStore((s) => s.updateXReplySettings);
  const openSkillSite = useStore((s) => s.openSkillSite);
  const checkSignIn = useStore((s) => s.checkXReplySignIn);
  const runPass = useStore((s) => s.runXMonitorPass);
  const [, setNowTick] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const browserProfiles = allBrowserProfiles.filter((profile) => workspace?.profileNames.includes(profile.name));
  const savedProfile = replyState.profileName;
  const effectiveProfile = savedProfile ?? selectedProfile;
  const profileAvailable = browserProfiles.some((profile) => profile.name === effectiveProfile);
  const selectedInWorkspace = browserProfiles.some((profile) => profile.name === selectedProfile);
  const site = entry.selector.value;

  // Both modes drive one profile, so whichever read the account last is the
  // answer: the reply agent's check and a monitoring pass write the same record.
  const publisher = replyState.publisher;
  const handle = publisher?.handle ?? monitor.account?.handle;
  const signedIn = profileAvailable && publisher?.signedIn === true;
  const own = handle ? monitor.followers[handle.toLowerCase()] : undefined;
  const trend = followerTrend(own?.history ?? [], own?.followers, Date.now());
  const fresh = feed.announced.filter((item) => Date.now() - item.at < DAY).length;
  const lastPass = monitor.lastPass;

  return (
    <>
      <div className="row watchlist-profile">
        <label className="muted small">Profile</label>
        <select
          value={profileAvailable ? (savedProfile ?? "") : "__choose_profile__"}
          disabled={busy}
          title="The browser profile signed in to x.com. The reply agent uses the same one."
          onChange={(event) => updateSettings({ profileName: event.target.value || undefined, publisher: undefined })}
        >
          {!profileAvailable && <option value="__choose_profile__" disabled>Choose a profile in this workspace</option>}
          {selectedInWorkspace && <option value="">{`Selected · ${selectedProfile}`}</option>}
          {browserProfiles.map((profile) => (
            <option key={profile.name} value={profile.name}>
              {profile.name}{profile.country ? ` · ${profile.country.toUpperCase()}` : ""}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="mini" disabled={busy || !profileAvailable} title={`Open ${site} in this profile to sign in or switch account`}
          onClick={() => void openSkillSite(entry)}>
          Open {site}
        </button>
      </div>
      {!profileAvailable && (
        <p className="muted small" role="status">Choose a browser profile from this workspace to monitor its X account.</p>
      )}

      <div className="xmon-account">
        <span className={"xmon-avatar" + (signedIn ? "" : " is-empty")} aria-hidden>
          {handle ? handle.slice(0, 1).toUpperCase() : <Icon name="person.crop.circle" size={16} />}
        </span>
        <div className="xmon-account-text">
          <strong>{handle ? `@${handle}` : "No account yet"}</strong>
          <span className="muted small">
            <span className={"status-dot " + (signedIn ? "ok-dot" : "muted-dot")} />
            {signedIn
              ? `Signed in${publisher?.checkedAt ? ` · checked ${since(publisher.checkedAt)}` : ""}`
              : publisher
                ? `Not signed in to ${site}`
                : "Sign-in not checked yet"}
          </span>
        </div>
        <span className="spacer" />
        <button className="mini" disabled={busy || !profileAvailable} title="Read which account is signed in"
          onClick={() => void checkSignIn(entry)}>
          Check
        </button>
      </div>

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

      <div className="xmon-feed">
        <div className="row xmon-feed-head">
          <strong className="small">From your Following feed</strong>
          <span className="spacer" />
          {feed.readAt && <span className="muted small">Updated {since(feed.readAt)}</span>}
        </div>
        {feed.posts.length === 0 ? (
          <div className="watchlist-empty">
            <span className="scheduled-empty-icon"><Icon name="list.bullet" size={20} /></span>
            <strong>No posts yet</strong>
            <span className="muted small">
              Press Check now to read the latest posts from the accounts you follow and your follower count.
            </span>
          </div>
        ) : (
          <div className="xmon-posts">
            {feed.posts.map((post) => <PostRow key={post.key} post={post} fresh={isNew(feed, post.key, Date.now())} />)}
          </div>
        )}
      </div>

      <div className="watchlist-loop">
        <div className="watchlist-loop-state">
          <span className={"status-dot " + (busy ? "warn-dot" : "muted-dot")} />
          <div>
            <strong className="small">{busy ? "Working" : lastPass ? `Checked ${since(lastPass.at)}` : "Not checked yet"}</strong>
            <div className="muted small">
              {busy && step
                ? `${step}…`
                : lastPass
                  ? `${lastPass.newPosts} new ${lastPass.newPosts === 1 ? "post" : "posts"} · ${lastPass.followerChanges} follower ${lastPass.followerChanges === 1 ? "change" : "changes"}`
                  : "Reads x.com only. Nothing is posted, liked, or followed."}
            </div>
            {!busy && lastPass?.notes.map((text) => (
              <div key={text} className="small watchlist-pass-note">{text}</div>
            ))}
            <button className="link small" title="Reveal the monitor's log file"
              onClick={() => void invoke("app_data_reveal", { name: X_MONITOR_LOG_FILE })}>
              Show log
            </button>
          </div>
        </div>
        <div className="row watchlist-loop-controls">
          <span className="spacer" />
          <button
            className="btn-bordered-prominent"
            disabled={!profileAvailable || busy}
            title="Read the feed and the follower count now"
            onClick={() => void runPass(entry)}
          >
            <Icon name="arrow.clockwise" size={13} /> Check now
          </button>
        </div>
      </div>
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
