import { useEffect, useState } from "react";
import { invoke } from "../electronBridge";
import { trackEvent } from "../lib/analytics";
import {
  githubStarErrorMessage,
  githubStarRepoName,
  githubStarRewardLabel,
  shouldAskForGitHubStar,
  type GitHubStarStatus,
} from "../lib/githubStarReward";
import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
import { useStore } from "../store";
import { Icon } from "./Icon";

function useGitHubStarCheck(surface: "launch_modal" | "usage_card") {
  const verify = useStore((s) => s.verifyGitHubStar);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string>();

  const openRepo = (status: GitHubStarStatus) => {
    trackEvent("github_star_repo_opened", { surface });
    void invoke("open_external", { url: status.repoUrl }).catch(() =>
      window.open(status.repoUrl, "_blank", "noopener,noreferrer"),
    );
  };

  const check = async () => {
    if (checking) return;
    setChecking(true);
    setError(undefined);
    trackEvent("github_star_check_started", { surface });
    try {
      await verify();
    } catch (cause) {
      setError(githubStarErrorMessage(cause));
      trackEvent("github_star_check_failed", { surface });
    } finally {
      setChecking(false);
    }
  };

  return { checking, error, openRepo, check };
}

function GitHubStarCopy({ status }: { status: GitHubStarStatus }) {
  const reward = githubStarRewardLabel(status);
  return (
    <p className="github-star-copy">
      Accounts that sign in with GitHub start with 1 MB of proxy traffic. Star{" "}
      <strong>{githubStarRepoName(status)}</strong> on GitHub, check it here, and your limit goes
      up to {reward} of free proxy traffic.
    </p>
  );
}

/**
 * Asked once per launch, after sign-in and setup, while a GitHub sign-up has
 * not claimed its star reward. It can be closed: the same ask stays next to
 * the proxy traffic on the Usage page.
 */
export function GitHubStarModal({ suppressed = false }: { suppressed?: boolean }) {
  const status = useStore((s) => s.githubStar);
  const open = useStore((s) => s.githubStarPromptOpen);
  const setOpen = useStore((s) => s.setGitHubStarPromptOpen);
  const { checking, error, openRepo, check } = useGitHubStarCheck("launch_modal");
  // Another blocking dialog (the agent connection gate) goes first; the ask
  // stays pending and shows once that one is closed.
  const visible = open && !suppressed && shouldAskForGitHubStar(status);

  useEffect(() => {
    if (!visible) return;
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [visible, setOpen]);

  if (!visible || !status) return null;

  return (
    <div className="modal-overlay github-star-overlay">
      <section
        aria-labelledby="github-star-title"
        aria-modal="true"
        className="modal-card github-star-modal"
        role="dialog"
      >
        <div className="modal-title-row">
          <Icon name="star.fill" size={18} />
          <div>
            <strong id="github-star-title">Star NextBrowser on GitHub to get {githubStarRewardLabel(status)} free</strong>
          </div>
        </div>
        <GitHubStarCopy status={status} />
        {error && (
          <div className="github-star-error" role="alert">
            <Icon name="exclamationmark.triangle.fill" size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-bordered" type="button" onClick={() => setOpen(false)} disabled={checking}>
            Later
          </button>
          <button className="btn-bordered" type="button" onClick={() => openRepo(status)}>
            <Icon name="star" size={13} />
            Open GitHub
          </button>
          <button className="primary" type="button" autoFocus onClick={() => void check()} disabled={checking}>
            {checking ? "Checking..." : "I starred it, check"}
          </button>
        </div>
      </section>
    </div>
  );
}

/** The same ask next to the proxy traffic, for whoever closed the prompt. */
export function GitHubStarCard() {
  const status = useStore((s) => s.githubStar);
  const { checking, error, openRepo, check } = useGitHubStarCheck("usage_card");
  if (!shouldAskForGitHubStar(status) || !status) return null;

  return (
    <div className="github-star-card" role="status">
      <div className="github-star-card-heading">
        <Icon name="star.fill" size={16} />
        <strong>Star NextBrowser on GitHub to get {githubStarRewardLabel(status)} free</strong>
      </div>
      <GitHubStarCopy status={status} />
      {error && (
        <div className="github-star-error" role="alert">
          <Icon name="exclamationmark.triangle.fill" size={14} />
          <span>{error}</span>
        </div>
      )}
      <div className="github-star-card-actions">
        <button className="btn-bordered" type="button" onClick={() => openRepo(status)}>
          <Icon name="star" size={13} />
          Open GitHub
        </button>
        <button className="btn-bordered-prominent" type="button" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking..." : "I starred it, check"}
        </button>
      </div>
    </div>
  );
}
