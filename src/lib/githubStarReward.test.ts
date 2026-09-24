import { describe, expect, it } from "vitest";
import { githubStarErrorMessage, githubStarRepoName, githubStarRewardLabel, shouldAskForGitHubStar } from "./githubStarReward";

const status = { required: true, claimed: false, repoUrl: "https://github.com/nextbrowser-oss/nextbrowser-app", rewardBytes: 1024 ** 3 };

describe("githubStarReward", () => {
  it("asks only while the reward is still to claim", () => {
    expect(shouldAskForGitHubStar(status)).toBe(true);
    expect(shouldAskForGitHubStar({ ...status, claimed: true })).toBe(false);
    expect(shouldAskForGitHubStar({ ...status, required: false })).toBe(false);
    expect(shouldAskForGitHubStar(null)).toBe(false);
    expect(shouldAskForGitHubStar(undefined)).toBe(false);
  });

  it("names the repository and the reward", () => {
    expect(githubStarRepoName(status)).toBe("nextbrowser-oss/nextbrowser-app");
    expect(githubStarRewardLabel(status)).toBe("1 GiB");
    expect(githubStarRewardLabel({ ...status, rewardBytes: 0 })).toBe("1 GB");
  });

  it("shows the backend's reason without Electron's IPC prefix", () => {
    expect(githubStarErrorMessage(new Error(
      "Error invoking remote method 'nextbrowser:invoke': Error: GitHub does not list your account among the stargazers yet",
    ))).toBe("GitHub does not list your account among the stargazers yet");
    expect(githubStarErrorMessage(new Error("plain reason"))).toBe("plain reason");
    expect(githubStarErrorMessage(undefined)).toBe("We couldn't check your star. Try again in a minute.");
  });
});
