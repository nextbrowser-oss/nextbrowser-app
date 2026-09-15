import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*title="Open x.com/);
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
