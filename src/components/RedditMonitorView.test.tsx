// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "../shared/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyState, type Match } from "@nextbrowser-oss/reddit-monitoring";
import { emptyRedditMonitorFeed, withPass } from "../lib/redditmonitor/feed";
import type { SkillEntry } from "../skillsCatalog";
import { RedditMonitorView } from "./RedditMonitorView";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
vi.mock("../store", () => ({ useStore: (select: (s: unknown) => unknown) => select(fixture.state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));

const entry: SkillEntry = {
  id: "repository:reddit", title: "Reddit", subtitle: "reddit.com", selector: { kind: "domain", value: "reddit.com" },
  category: "social", categoryTitle: "Social", categoryIcon: "globe", categoryOrder: 1,
  watchlist: { title: "Subreddits to answer", placeholder: "community", prefix: "r/", monitor: { engine: "reddit-monitor", label: "Monitoring", replyLabel: "Reply agent" } },
};

const complaint: Match = {
  item: {
    key: "t3_a", id: "a", kind: "post", subreddit: "selfhosted", author: "mira_codes", title: "Acme sync broken after the update?",
    text: "", url: "https://www.reddit.com/r/selfhosted/comments/a/", createdAt: Date.now() - 60_000, nsfw: false,
  },
  source: { kind: "community", name: "r/selfhosted" },
  keywords: ["acme"],
  triage: { urgency: "high", score: 5, reasons: ['Says "broken"', "Asks a question"] },
};

beforeEach(() => {
  fixture.state = {
    redditMonitorState: emptyState({ keywords: ["acme"], communities: ["selfhosted"] }),
    redditMonitorFeed: emptyRedditMonitorFeed(),
    redditMonitorBusy: false,
    watchlistProfiles: {},
    watchedProfiles: [{ id: "1", skillId: "repository:reddit", handle: "webdev", enabled: true }],
    profiles: [{ name: "reddit-us", country: "US" }],
    workspaces: [{ id: "one", profileNames: ["reddit-us"] }],
    activeWorkspaceId: "one",
    selectedProfile: "reddit-us",
    agentReady: () => true,
    monitorScheduleFor: () => undefined,
    startMonitorSchedule: vi.fn(),
    stopMonitorSchedule: vi.fn(),
    setMonitorScheduleInterval: vi.fn(),
    openMonitorSite: vi.fn(),
    updateRedditMonitorSettings: vi.fn(),
    setRedditMatchDone: vi.fn(),
    draftRedditReply: vi.fn(),
  };
});

describe("RedditMonitorView", () => {
  it("shows what is watched, and offers the reply agent's communities", () => {
    const html = renderToStaticMarkup(<RedditMonitorView entry={entry} />);
    expect(html).toContain("What to watch");
    expect(html).toContain("acme");
    expect(html).toContain("r/selfhosted");
    expect(html).toContain("Add the reply agent&#x27;s r/webdev");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Start/);
  });

  it("will not start with nothing to watch", () => {
    vi.useFakeTimers();
    fixture.state.redditMonitorState = emptyState({ watchInbox: false });
    render(<TooltipProvider><RedditMonitorView entry={entry} /></TooltipProvider>);
    const start = screen.getByRole("button", { name: "Start" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.pointerOver(start);
    act(() => vi.advanceTimersByTime(180));
    expect(screen.getByRole("tooltip").textContent).toBe("Add a keyword or a community first");
  });

  it("lists matches with their urgency and reasons, and hands one to the reply agent", () => {
    fixture.state.redditMonitorFeed = withPass(emptyRedditMonitorFeed(), {
      matches: [complaint],
      events: [{ type: "new_item", at: Date.now(), ...complaint }],
      read: true,
    }, Date.now());
    const html = renderToStaticMarkup(<RedditMonitorView entry={entry} />);
    expect(html).toContain("Needs a look · 1");
    expect(html).toContain("rmon-urgency high");
    expect(html).toContain("Acme sync broken after the update?");
    expect(html).toContain("Says &quot;broken&quot; · Asks a question");
    expect(html).toContain("Draft reply");
    expect(html).toContain("New");
  });
});
