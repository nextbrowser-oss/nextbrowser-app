import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeState as normalizeRedditMonitorState } from "@nextbrowser-oss/reddit-monitoring";
import { socialEngine } from "../lib/socialmonitor/engines";
import { emptySocialFeed } from "../lib/socialmonitor/feed";
import { emptyXReplyState } from "../lib/xreply/state";
import type { SkillEntry } from "../skillsCatalog";
import { WatchedProfilesPanel } from "./WatchedProfilesPanel";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../store", () => ({ useStore: (select: (s: unknown) => unknown) => select(fixture.state), X_REPLY_LOG_FILE: "test.log" }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
const entry: SkillEntry = {
  id: "x", title: "X", subtitle: "x.com", selector: { kind: "domain", value: "x.com" },
  category: "social", categoryTitle: "Social", categoryIcon: "globe", categoryOrder: 1,
  watchlist: { title: "Watched X profiles", placeholder: "handle", profileUrl: "https://x.com/{handle}", engine: "x-reply" },
};
beforeEach(() => {
  fixture.state = {
    watchedProfiles: [], watchReports: {}, watchPublishers: {}, xReplyState: emptyXReplyState(),
    redditMonitorState: normalizeRedditMonitorState(null),
    profiles: [{ name: "local", country: "US" }, { name: "foreign", country: "EE" }],
    workspaces: [{ id: "one", profileNames: ["local", "deleted"] }, { id: "two", profileNames: ["foreign"] }],
    activeWorkspaceId: "one", selectedProfile: "local", agentReady: () => true,
    watchlistRuns: [], watchlistProfiles: {}, watchlistSignIns: {}, watchlistDevices: {},
    watchlistTransportFor: () => undefined,
  };
});
const render = () => renderToStaticMarkup(<WatchedProfilesPanel entry={entry} onClose={() => {}} />);

describe("workspace browser selection", () => {
  it("lists only existing profiles in the active workspace", () => {
    const html = render();
    expect(html).toContain('value="local"');
    expect(html).not.toContain('value="foreign"');
    expect(html).not.toContain('value="deleted"');
    expect(html).not.toContain("read on every pass");
  });
  it("blocks a saved foreign profile instead of silently falling back to the selected profile", () => {
    fixture.state.xReplyState = { ...emptyXReplyState(), profileName: "foreign" };
    const html = render();
    expect(html).toContain("Choose a profile in this workspace");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-tooltip-id=[^>]*>Open x.com/);
    expect(html).not.toContain('value="foreign"');
  });
  it("does not offer a default session when the selected profile belongs to another workspace", () => {
    fixture.state.selectedProfile = "foreign";
    expect(render()).not.toContain("Selected · foreign");
    expect(render()).toContain("Choose a profile in this workspace");
    expect(render()).not.toContain("Default session");
  });
  it("shows an empty selection when the active workspace has no profiles", () => {
    fixture.state.activeWorkspaceId = "empty";
    expect(render()).not.toContain('value="local"');
    expect(render()).toContain("Choose a profile in this workspace");
  });
});

describe("a monitoring-only skill", () => {
  it("opens on monitoring with no switch to a reply mode", () => {
    const spec = socialEngine("instagram-monitor")!;
    Object.assign(fixture.state, {
      socialMonitors: { "instagram-monitor": { state: spec.normalizeState(null), feed: emptySocialFeed(), busy: false } },
      monitorScheduleFor: () => undefined, startMonitorSchedule: vi.fn(), stopMonitorSchedule: vi.fn(),
      setMonitorScheduleInterval: vi.fn(), openMonitorSite: vi.fn(), updateSocialMonitorSettings: vi.fn(),
      setSocialMatchDone: vi.fn(), draftSocialReply: vi.fn(),
    });
    const instagram: SkillEntry = {
      id: "repository:instagram", title: "Instagram", subtitle: "instagram.com", selector: { kind: "domain", value: "instagram.com" },
      category: "social", categoryTitle: "Social", categoryIcon: "globe", categoryOrder: 1,
      watchlist: { title: "Instagram", placeholder: "profile", monitor: { engine: "instagram-monitor", label: "Monitoring", only: true } },
    };
    const html = renderToStaticMarkup(<WatchedProfilesPanel entry={instagram} onClose={() => {}} />);
    expect(html).not.toContain("skill-mode-switch");
    expect(html).not.toContain("Reply agent");
    expect(html).toContain("Profiles to watch");
  });
});

describe("the sign-in step line", () => {
  const site: SkillEntry = {
    id: "site", title: "Site", subtitle: "example.com", selector: { kind: "domain", value: "example.com" },
    category: "social", categoryTitle: "Social", categoryIcon: "globe", categoryOrder: 1,
    watchlist: { title: "Watched accounts", placeholder: "account", signIn: { url: "https://example.com/home", probe: "({})" } },
  };
  const renderSite = () => renderToStaticMarkup(<WatchedProfilesPanel entry={site} onClose={() => {}} />);

  it("still shows why Open or Check failed after the action ended", () => {
    Object.assign(fixture.state, { watchlistBusy: undefined, watchlistStepFor: "site", watchlistStep: "The page could not be opened." });
    expect(renderSite()).toContain("The page could not be opened.");
  });

  it("shows another skill's line on that skill only", () => {
    Object.assign(fixture.state, { watchlistStepFor: "other", watchlistStep: "The page could not be opened." });
    const html = renderSite();
    expect(html).not.toContain("The page could not be opened.");
    expect(html).toContain("Sign-in to example.com not checked yet");
  });
});
