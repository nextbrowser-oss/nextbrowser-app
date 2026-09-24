import { humanBytes } from "../types";

/**
 * The GitHub star reward, as the main process reads it from the backend.
 *
 * An account that signed in with GitHub starts with a tiny proxy limit. It is
 * asked to star the NextBrowser repository; the backend checks the star and
 * raises the limit to `rewardBytes`, once. `required` is true while the
 * account is still below the reward and has not claimed it.
 */
export interface GitHubStarStatus {
  required: boolean;
  claimed: boolean;
  repoUrl: string;
  rewardBytes: number;
}

/** "1 GB", or a neutral fallback when the backend did not say. */
export function githubStarRewardLabel(status?: GitHubStarStatus | null): string {
  return status && status.rewardBytes > 0 ? humanBytes(status.rewardBytes) : "1 GB";
}

/** The repository as "owner/name" for the link text. */
export function githubStarRepoName(status?: GitHubStarStatus | null): string {
  return (status?.repoUrl ?? "").replace(/^https:\/\/github\.com\//, "") || "nextbrowser-oss/nextbrowser-app";
}

/** A star prompt belongs on screen only while the reward is still to claim. */
export function shouldAskForGitHubStar(status?: GitHubStarStatus | null): boolean {
  return status?.required === true && !status.claimed;
}

const fallbackCheckError = "We couldn't check your star. Try again in a minute.";

/**
 * The backend's reason for a failed check, without the prefix Electron adds
 * to an error that crossed IPC ("Error invoking remote method ...: Error:").
 */
export function githubStarErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "").trim();
  return message || fallbackCheckError;
}
