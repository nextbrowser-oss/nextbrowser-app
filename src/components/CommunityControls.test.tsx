// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GitHubStarStatus } from "../lib/githubStarReward";
import { GITHUB_STARS_REFRESH_EVENT } from "../lib/githubStarReward";
import { discordUrl, repoUrl } from "../constants";
import { TooltipProvider } from "../shared/ui";
import { CommunityControls } from "./CommunityControls";

const fixture = vi.hoisted(() => ({
  githubStar: undefined as GitHubStarStatus | null | undefined,
  invoke: vi.fn(async () => 67),
}));
vi.mock("../store", () => ({ useStore: (select: (state: typeof fixture) => unknown) => select(fixture) }));
vi.mock("../electronBridge", () => ({ invoke: fixture.invoke }));
const status: GitHubStarStatus = { required: true, claimed: false, revoked: false, repoUrl, rewardBytes: 1_000_000_000 };
const view = () => <TooltipProvider><CommunityControls /></TooltipProvider>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); fixture.invoke.mockClear(); fixture.githubStar = undefined; });

it("distinguishes an unverified star, a verified star, and a revoked star", async () => {
  fixture.githubStar = status;
  const { rerender } = render(view());
  const discord = screen.getByRole("button", { name: "Join Nextbrowser on Discord" });
  expect(discord.className).toContain("community-discord--missing");
  fireEvent.pointerOver(discord);
  expect((await screen.findByRole("tooltip")).textContent).toContain("star is not verified");
  fixture.githubStar = { ...status, required: false, claimed: true };
  rerender(view());
  expect(discord.className).toContain("community-discord--verified");
  expect(screen.getByRole("tooltip").textContent).toContain("GitHub star verified");
  fixture.githubStar = { ...status, claimed: true, revoked: true };
  rerender(view());
  expect(discord.className).toContain("community-discord--missing");
  await act(async () => {});
});

it.each([undefined, null])("keeps unavailable account status neutral (%s)", async value => {
  fixture.githubStar = value;
  render(view());
  const discord = screen.getByRole("button", { name: "Join Nextbrowser on Discord" });
  expect(discord.className).toContain("community-discord--unknown");
  await act(async () => {});
});

it("retains the repository count, refresh signal and separate community destinations", async () => {
  const open = vi.spyOn(window, "open").mockImplementation(() => null);
  render(view());
  await screen.findByText("67");
  fireEvent.click(screen.getByRole("button", { name: "Star Nextbrowser on GitHub" }));
  fireEvent.click(screen.getByRole("button", { name: "Join Nextbrowser on Discord" }));
  expect(open.mock.calls.map(call => call[0])).toEqual([repoUrl, discordUrl]);
  fireEvent(window, new Event(GITHUB_STARS_REFRESH_EVENT));
  expect(fixture.invoke).toHaveBeenLastCalledWith("github_stars", { refresh: true });
  await act(async () => {});
});
