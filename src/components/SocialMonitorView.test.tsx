import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { socialEngine } from "../lib/socialmonitor/engines";
import { emptySocialFeed, withPass, type SocialMatch } from "../lib/socialmonitor/feed";
import type { SkillEntry } from "../skillsCatalog";
import { SocialMonitorView } from "./SocialMonitorView";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../store", () => ({ useStore: (select: (s: unknown) => unknown) => select(fixture.state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));

const spec = socialEngine("instagram-monitor")!;
const entry: SkillEntry = {
  id: "repository:instagram", title: "Instagram", subtitle: "instagram.com", selector: { kind: "domain", value: "instagram.com" },
  category: "social", categoryTitle: "Social", categoryIcon: "globe", categoryOrder: 1,
  watchlist: { title: "Profiles to answer", placeholder: "profile", prefix: "@", monitor: { engine: "instagram-monitor", label: "Monitoring", replyLabel: "Reply agent" } },
};

const question: SocialMatch = {
  item: {
    key: "comment:18032", kind: "comment", author: "tom_k", text: "Does the large one ship to Canada?", url: "https://www.instagram.com/p/C0dEx1/c/18032/",
    createdAt: Date.now() - 60_000, addressed: "comment_on_post", post: { owner: "acme_shop", caption: "New drop is live", url: "https://www.instagram.com/p/C0dEx1/" },
  },
  source: { kind: "own_comments", name: "your posts" },
  keywords: [],
  triage: { urgency: "high", score: 4, reasons: ["Comments on your post", "Asks a question", "No reply yet"] },
};

beforeEach(() => {
  fixture.state = {
    socialMonitors: { "instagram-monitor": { state: spec.withSettings(spec.normalizeState(null), { profiles: ["rival_store"], keywords: ["acme"] }), feed: emptySocialFeed(), busy: false } },
    watchlistProfiles: {},
    profiles: [{ name: "brand", country: "US" }],
    workspaces: [{ id: "one", profileNames: ["brand"] }],
    activeWorkspaceId: "one",
    selectedProfile: "brand",
    agentReady: () => true,
    monitorScheduleFor: () => undefined,
    startMonitorSchedule: vi.fn(),
    stopMonitorSchedule: vi.fn(),
    setMonitorScheduleInterval: vi.fn(),
    openMonitorSite: vi.fn(),
    recheckMonitorSignIn: vi.fn(),
    updateSocialMonitorSettings: vi.fn(),
    setSocialMatchDone: vi.fn(),
    draftSocialReply: vi.fn(),
  };
});

describe("SocialMonitorView", () => {
  it("shows the engine's own settings", () => {
    const html = renderToStaticMarkup(<SocialMonitorView entry={entry} spec={spec} />);
    expect(html).toContain("Profiles to watch");
    expect(html).toContain("@rival_store");
    expect(html).toContain("acme");
    expect(html).toContain("Comments on your posts");
    expect(html).toContain("Open instagram.com");
  });

  it("shows an account nobody has checked yet, with the way to check it", () => {
    const html = renderToStaticMarkup(<SocialMonitorView entry={entry} spec={spec} />);
    expect(html).toContain("Instagram account not checked yet");
    expect(html).toContain("Open instagram.com to sign in; the panel reads the account when you come back");
    expect(html).toContain("Read the signed-in account again");
  });

  it("lists a match with its urgency, its post and the reasons, and offers a draft", () => {
    const slot = (fixture.state.socialMonitors as Record<string, { feed: unknown }>)["instagram-monitor"]!;
    slot.feed = withPass(emptySocialFeed(), { matches: [question], events: [{ type: "new_item", at: Date.now(), ...question }], read: true }, Date.now());
    const html = renderToStaticMarkup(<SocialMonitorView entry={entry} spec={spec} />);
    expect(html).toContain("Needs a look · 1");
    expect(html).toContain("rmon-urgency high");
    expect(html).toContain("Your post");
    expect(html).toContain("on @acme_shop&#x27;s post: “New drop is live”");
    expect(html).toContain("Comments on your post · Asks a question · No reply yet");
    expect(html).toContain("Draft reply");
  });
});
