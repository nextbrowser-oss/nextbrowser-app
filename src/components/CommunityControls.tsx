import { useEffect, useState } from "react";
import { IconButton } from "../shared/ui";
import { useStore } from "../store";
import { invoke } from "../electronBridge";
import { GITHUB_STARS_REFRESH_EVENT } from "../lib/githubStarReward";
import { discordUrl, repoUrl } from "../constants";
import { Icon } from "./Icon";

function GithubMark({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.02-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
    </svg>
  );
}

function DiscordMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.36 2.8a.08.08 0 0 0-.09.04c-.21.38-.45.88-.62 1.27a18.38 18.38 0 0 0-5.5 0 12.38 12.38 0 0 0-.63-1.27.08.08 0 0 0-.09-.04 19.73 19.73 0 0 0-4.96 1.57.07.07 0 0 0-.03.03C.31 9.1-.55 13.68-.13 18.21c0 .02.01.05.03.06a19.9 19.9 0 0 0 6.08 3.07.08.08 0 0 0 .09-.03c.47-.64.88-1.31 1.24-2.01a.08.08 0 0 0-.04-.11 13.04 13.04 0 0 1-1.9-.91.08.08 0 0 1-.01-.13c.13-.09.25-.19.37-.29a.08.08 0 0 1 .08-.01c3.98 1.82 8.3 1.82 12.24 0a.08.08 0 0 1 .08.01c.12.1.25.2.38.29a.08.08 0 0 1-.01.13c-.6.36-1.23.66-1.9.91a.08.08 0 0 0-.04.11c.36.7.77 1.37 1.24 2.01a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6.08-3.07.08.08 0 0 0 .03-.06c.5-5.23-.84-9.77-3.63-13.81a.06.06 0 0 0-.03-.03ZM8.02 15.45c-1.2 0-2.18-1.1-2.18-2.45s.96-2.45 2.18-2.45c1.23 0 2.2 1.11 2.18 2.45 0 1.35-.96 2.45-2.18 2.45Zm7.96 0c-1.2 0-2.18-1.1-2.18-2.45s.96-2.45 2.18-2.45c1.23 0 2.2 1.11 2.18 2.45 0 1.35-.95 2.45-2.18 2.45Z" />
    </svg>
  );
}

function formatStars(count?: number | null): string {
  if (count == null) return "—";
  if (count < 1000) return `${count}`;
  const rounded = count < 10_000 ? Math.round(count / 100) / 10 : Math.round(count / 1000);
  return `${rounded}k`;
}

// The host reuses a count for two minutes and answers a refresh no more than
// every 15 seconds, so polling and focus refreshes cost little.
const GITHUB_STARS_POLL_MS = 2 * 60 * 1000;
// A count that just changed on GitHub (the user's own star) can trail the
// stargazer list by a moment, so a verified star reads it twice.
const GITHUB_STARS_SETTLE_MS = 20 * 1000;

function GithubStarButton({ stars }: { stars?: number | null }) {
  const label = "Star Nextbrowser on GitHub";
  return (
    <IconButton appearance="plain" size="small" label={label} className="community-github"
      onClick={() => window.open(repoUrl, "_blank", "noopener,noreferrer")}>
      <GithubMark size={17} />
      <span className="github-star-count">
        <Icon name="star.fill" size={11} fill="currentColor" className="github-star-glyph" />
        {formatStars(stars)}
      </span>
    </IconButton>
  );
}

function DiscordButton() {
  const status = useStore(state => state.githubStar);
  const tone = status?.claimed && !status.revoked ? "verified" : status?.required || status?.revoked ? "missing" : "unknown";
  const hint = tone === "verified"
    ? "GitHub star verified. Thanks for supporting Nextbrowser! Join our Discord community."
    : tone === "missing"
      ? "Your GitHub star is not verified. Star Nextbrowser on GitHub and verify it in Usage. Join our Discord community for help."
      : "Join our Discord community. Sign in with GitHub and verify your star in Usage to show your support status.";
  return <IconButton appearance="plain" size="small" label="Join Nextbrowser on Discord" hint={hint}
    className={`community-discord community-discord--${tone}`}
    onClick={() => window.open(discordUrl, "_blank", "noopener,noreferrer")}>
    <DiscordMark size={18} />
  </IconButton>;
}

export function CommunityControls() {
  // No number until the host answers: a stale one would read as a lost star.
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let settleTimer: number | undefined;
    const load = (refresh: boolean) => {
      invoke<number | null>("github_stars", refresh ? { refresh: true } : {})
        .then((count) => {
          if (!cancelled && typeof count === "number") setStars(count);
        })
        .catch(() => undefined);
    };
    load(false);
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") load(false);
    }, GITHUB_STARS_POLL_MS);
    // Coming back from the repository page is when a star was likely added.
    const onFocus = () => load(true);
    const onStarVerified = () => {
      load(true);
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => load(true), GITHUB_STARS_SETTLE_MS);
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener(GITHUB_STARS_REFRESH_EVENT, onStarVerified);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.clearTimeout(settleTimer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(GITHUB_STARS_REFRESH_EVENT, onStarVerified);
    };
  }, []);

  return (
    <div className="community-controls">
      <GithubStarButton stars={stars} />
      <DiscordButton />
    </div>
  );
}
