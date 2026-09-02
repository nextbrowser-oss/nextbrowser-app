import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SkillEntry } from "./skillsCatalog";

const bridge = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("./electronBridge", () => ({
  invoke: bridge.invoke,
  listen: bridge.listen,
  filePathForFile: () => "",
}));

vi.mock("./lib/analytics", () => ({
  setAnalyticsUserId: vi.fn(),
  trackEvent: vi.fn(),
  trackScreenView: vi.fn(),
  trackTiming: vi.fn(),
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

const watchlistSkill: SkillEntry = {
  id: "repository:x-reply-agent",
  title: "X Reply Agent",
  subtitle: "x.com",
  selector: { kind: "domain", value: "x.com" },
  category: "social",
  categoryTitle: "Social",
  categoryIcon: "bubble.left.and.bubble.right.fill",
  categoryOrder: 40,
  source: "repository",
  instructions: "# X reply agent",
  watchlist: {
    title: "Watched X profiles",
    placeholder: "handle without @",
    prefix: "@",
    profileUrl: "https://x.com/{handle}",
    stateFile: "x-reply-agent-state.json",
    subscribeTask: "Subscribe to @{handle}: turn on post notifications.",
    checkTask: "Run one watch pass over these accounts: {handles}.",
  },
};

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("localStorage", memoryStorage());
  bridge.invoke.mockReset();
  bridge.listen.mockReset();
  bridge.invoke.mockResolvedValue(null);
});

describe("watched profiles", () => {
  it("normalizes a pasted handle, keeps one record per account, and persists the list", async () => {
    const { useStore } = await import("./store");
    const added = useStore.getState().addWatchedProfile("repository:x-reply-agent", "https://x.com/@NextBrowser");
    expect(added?.handle).toBe("NextBrowser");

    const again = useStore.getState().addWatchedProfile("repository:x-reply-agent", "@nextbrowser");
    expect(again?.id).toBe(added?.id);
    expect(useStore.getState().watchedProfiles).toHaveLength(1);

    expect(useStore.getState().addWatchedProfile("repository:x-reply-agent", "not a handle")).toBeUndefined();
    expect(useStore.getState().watchedProfiles).toHaveLength(1);

    const write = bridge.invoke.mock.calls.find(([command, args]) =>
      command === "app_data_write" && (args as { name: string }).name === "watched-profiles.json");
    expect(write).toBeTruthy();
  });

  it("keeps lists of different skills apart and drops a removed account", async () => {
    const { useStore } = await import("./store");
    const store = useStore.getState();
    store.addWatchedProfile("repository:x-reply-agent", "alpha");
    store.addWatchedProfile("other-skill", "alpha");
    expect(useStore.getState().watchedProfilesFor("repository:x-reply-agent").map((item) => item.handle)).toEqual(["alpha"]);

    const target = useStore.getState().watchedProfilesFor("repository:x-reply-agent")[0];
    useStore.getState().removeWatchedProfile(target.id);
    expect(useStore.getState().watchedProfilesFor("repository:x-reply-agent")).toEqual([]);
    expect(useStore.getState().watchedProfilesFor("other-skill")).toHaveLength(1);
  });

  it("runs one pass over the enabled accounts only", async () => {
    const { useStore } = await import("./store");
    const useSkillInChat = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ useSkillInChat });
    const store = useStore.getState();
    store.addWatchedProfile("repository:x-reply-agent", "alpha");
    store.addWatchedProfile("repository:x-reply-agent", "beta");
    const paused = useStore.getState().watchedProfilesFor("repository:x-reply-agent")[1];
    useStore.getState().setWatchedProfileEnabled(paused.id, false);

    await useStore.getState().runWatchlistPass(watchlistSkill);
    expect(useSkillInChat).toHaveBeenCalledWith(
      watchlistSkill,
      "Run one watch pass over these accounts: @alpha.",
      undefined,
    );
    expect(useStore.getState().watchedProfilesFor("repository:x-reply-agent")[0].lastRunAt).toBeTruthy();
  });

  it("falls back to a plain run when nothing is watched yet", async () => {
    const { useStore } = await import("./store");
    const useSkillInChat = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ useSkillInChat });
    await useStore.getState().runWatchlistPass(watchlistSkill);
    expect(useSkillInChat).toHaveBeenCalledWith(watchlistSkill, undefined, undefined);
  });

  it("subscribes one account through the skill and marks it as queued", async () => {
    const { useStore } = await import("./store");
    const useSkillInChat = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ useSkillInChat });
    const profile = useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().subscribeWatchedProfile(watchlistSkill, profile!.id);
    expect(useSkillInChat).toHaveBeenCalledWith(
      watchlistSkill,
      "Subscribe to @alpha: turn on post notifications.",
    );
    expect(useStore.getState().watchedProfiles[0].subscribeQueuedAt).toBeTruthy();
  });

  it("reads the agent state file and replaces the previous reports of that skill", async () => {
    const { useStore } = await import("./store");
    bridge.invoke.mockImplementation(async (command: string) =>
      command === "workspace_file_read"
        ? JSON.stringify({ handles: [{ handle: "alpha", notifications: true, replies_sent: 2 }] })
        : null);

    await useStore.getState().loadWatchReports(watchlistSkill);
    expect(useStore.getState().watchReportFor("repository:x-reply-agent", "ALPHA")).toMatchObject({
      handle: "alpha",
      notifications: true,
      repliesSent: 2,
    });

    bridge.invoke.mockImplementation(async () => null);
    await useStore.getState().loadWatchReports(watchlistSkill);
    expect(useStore.getState().watchReportFor("repository:x-reply-agent", "alpha")).toBeUndefined();
  });

  it("leaves the panel empty instead of failing when the workspace file cannot be read", async () => {
    const { useStore } = await import("./store");
    bridge.invoke.mockRejectedValue(new Error("no bridge"));
    await expect(useStore.getState().loadWatchReports(watchlistSkill)).resolves.toBeUndefined();
    expect(useStore.getState().watchReports).toEqual({});
  });
});

describe("engine routing", () => {
  const engineSkill = { ...watchlistSkill, watchlist: { ...watchlistSkill.watchlist!, engine: "x-reply" as const } };

  it("runs a pass in app code instead of handing the workflow to the agent", async () => {
    const { useStore } = await import("./store");
    const useSkillInChat = vi.fn().mockResolvedValue(undefined);
    const runXReplyPass = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ useSkillInChat, runXReplyPass });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");

    await useStore.getState().runWatchlistPass(engineSkill);
    expect(runXReplyPass).toHaveBeenCalledWith(engineSkill);
    expect(useSkillInChat).not.toHaveBeenCalled();
  });

  it("starts the loop without opening a chat for it", async () => {
    const { useStore } = await import("./store");
    useStore.setState({ runXReplyPass: vi.fn().mockResolvedValue(undefined), agentReady: () => true });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().startWatchlistRun(engineSkill, 15);
    expect(useStore.getState().watchlistRunFor("repository:x-reply-agent")?.conversationId).toBeUndefined();
    expect(useStore.getState().conversations).toHaveLength(0);
  });

  it("holds the next tick back while a pass is still running", async () => {
    const { useStore } = await import("./store");
    const runXReplyPass = vi.fn().mockResolvedValue(undefined);
    useStore.setState({
      runXReplyPass,
      agentReady: () => true,
      skillCategories: [{ id: "social", title: "Social", blurb: "", icon: "sparkles", entries: [engineSkill] }],
    });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().startWatchlistRun(engineSkill, 5);

    useStore.setState((state) => ({
      xReplyBusy: true,
      watchlistRuns: state.watchlistRuns.map((item) => ({ ...item, nextRunAt: Date.now() - 1 })),
    }));
    runXReplyPass.mockClear();
    await useStore.getState().tickWatchlistRuns();
    expect(runXReplyPass).not.toHaveBeenCalled();
  });
});

describe("watchlist loop", () => {
  async function loadStoreWithSkill() {
    const { useStore } = await import("./store");
    useStore.setState({
      skillCategories: [{
        id: "social",
        title: "Social",
        blurb: "",
        icon: "bubble.left.and.bubble.right.fill",
        entries: [watchlistSkill],
      }],
      agentReady: () => true,
    });
    return useStore;
  }

  it("fires the first pass immediately and schedules the next one", async () => {
    const useStore = await loadStoreWithSkill();
    const runWatchlistPass = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ runWatchlistPass });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");

    await useStore.getState().startWatchlistRun(watchlistSkill, 15);
    const run = useStore.getState().watchlistRunFor("repository:x-reply-agent");
    expect(run?.enabled).toBe(true);
    expect(runWatchlistPass).toHaveBeenCalledWith(watchlistSkill, {
      conversationId: run?.conversationId,
      background: true,
    });
    expect(run?.nextRunAt).toBeGreaterThan(Date.now() + 14 * 60_000);
  });

  it("holds the next pass back while the previous one is still running", async () => {
    const useStore = await loadStoreWithSkill();
    const runWatchlistPass = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ runWatchlistPass });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().startWatchlistRun(watchlistSkill, 5);
    const run = useStore.getState().watchlistRunFor("repository:x-reply-agent")!;

    useStore.setState((state) => ({
      watchlistRuns: state.watchlistRuns.map((item) => ({ ...item, nextRunAt: Date.now() - 1 })),
      conversations: state.conversations.map((conversation) => conversation.id === run.conversationId
        ? { ...conversation, messages: [{ id: "reply", role: "assistant" as const, text: "", status: "streaming" as const, createdAt: Date.now() }] }
        : conversation),
    }));
    runWatchlistPass.mockClear();

    await useStore.getState().tickWatchlistRuns();
    expect(runWatchlistPass).not.toHaveBeenCalled();
  });

  it("stops scheduling and ends the pass in flight", async () => {
    const useStore = await loadStoreWithSkill();
    const runWatchlistPass = vi.fn().mockResolvedValue(undefined);
    const stopRunning = vi.fn();
    useStore.setState({ runWatchlistPass, stopRunning });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().startWatchlistRun(watchlistSkill, 5);
    const run = useStore.getState().watchlistRunFor("repository:x-reply-agent")!;

    useStore.setState((state) => ({
      runtime: { ...state.runtime, [state.agentId]: { ...state.runtime[state.agentId], runningReplyId: "reply" } },
      conversations: state.conversations.map((conversation) => conversation.id === run.conversationId
        ? { ...conversation, messages: [{ id: "reply", role: "assistant" as const, text: "", status: "streaming" as const, createdAt: Date.now() }] }
        : conversation),
    }));

    useStore.getState().stopWatchlistRun("repository:x-reply-agent");
    expect(stopRunning).toHaveBeenCalled();
    expect(useStore.getState().watchlistRunFor("repository:x-reply-agent")?.enabled).toBe(false);

    runWatchlistPass.mockClear();
    await useStore.getState().tickWatchlistRuns();
    expect(runWatchlistPass).not.toHaveBeenCalled();
  });

  it("keeps the loop off while no agent is connected", async () => {
    const useStore = await loadStoreWithSkill();
    const runWatchlistPass = vi.fn().mockResolvedValue(undefined);
    useStore.setState({ runWatchlistPass, agentReady: () => false });
    useStore.getState().addWatchedProfile("repository:x-reply-agent", "alpha");
    await useStore.getState().startWatchlistRun(watchlistSkill, 5);
    expect(runWatchlistPass).not.toHaveBeenCalled();
    expect(useStore.getState().watchlistRunFor("repository:x-reply-agent")?.enabled).toBe(true);
  });
});

describe("cloud-phone skills", () => {
  const redditSkill: SkillEntry = {
    id: "repository:reddit-cloud-phone",
    title: "Reddit on a Cloud Phone",
    subtitle: "reddit.com",
    selector: { kind: "domain", value: "reddit.com" },
    runtime: "cloud-phone",
    category: "social",
    categoryTitle: "Social",
    categoryIcon: "bubble.left.and.bubble.right.fill",
    categoryOrder: 40,
    source: "repository",
    instructions: "# Reddit on a cloud phone",
    watchlist: {
      title: "Watched subreddits",
      placeholder: "community without r/",
      prefix: "r/",
      profileUrl: "https://www.reddit.com/r/{handle}",
      stateFile: "reddit-cloud-phone-state.json",
      handleMaxLength: 21,
      subscribeTask: "Subscribe to r/{handle}.",
      checkTask: "Run one engagement pass over these communities: {handles}.",
    },
  };

  it("runs a pass on the workspace's cloud phone without preparing a browser", async () => {
    const { useStore } = await import("./store");
    const { setMultiloginSelection } = await import("./lib/multiloginSelection");
    const agentId = useStore.getState().agentId;
    useStore.setState((state) => ({
      runtime: { ...state.runtime, [agentId]: { ...state.runtime[agentId], ready: true, queue: [] } },
      applySkill: vi.fn().mockResolvedValue(undefined),
      skillCategories: [{ id: "social", title: "Social", blurb: "", icon: "sparkles", entries: [redditSkill] }],
    }));
    const cid = useStore.getState().newChat();
    useStore.setState((state) => ({
      conversations: state.conversations.map((conversation) =>
        conversation.id === cid ? { ...conversation, workspaceId: "ws-phone" } : conversation),
    }));
    setMultiloginSelection("ws-phone", { kind: "mobile", id: "phone-1", name: "Reddit-test" });
    // The skill's own handle limit applies: a 16-character subreddit is a fine name here.
    expect(useStore.getState().addWatchedProfile(redditSkill.id, "https://www.reddit.com/r/learnprogramming/")?.handle)
      .toBe("learnprogramming");

    await useStore.getState().runWatchlistPass(redditSkill);

    const prompt = useStore.getState().conversations.find((conversation) => conversation.id === cid)
      ?.messages.filter((message) => message.role === "user").at(-1)?.text ?? "";
    expect(prompt).toContain("cloud phone “Reddit-test” (id phone-1)");
    expect(prompt).toContain("Run one engagement pass over these communities: r/learnprogramming.");
    expect(prompt).toContain("# Reddit on a cloud phone");
    expect(prompt).toContain("Do not start, open, inspect, or change any NextBrowser browser profile");
    // No browser session was prepared or touched on the way.
    expect(bridge.invoke.mock.calls.filter(([channel]) => channel === "nextctl_run")).toHaveLength(0);
  });

  it("asks which phone to use when the workspace has none selected", async () => {
    const { useStore } = await import("./store");
    const agentId = useStore.getState().agentId;
    useStore.setState((state) => ({
      runtime: { ...state.runtime, [agentId]: { ...state.runtime[agentId], ready: true, queue: [] } },
      applySkill: vi.fn().mockResolvedValue(undefined),
    }));
    const cid = useStore.getState().newChat();

    await useStore.getState().useSkillInChat(redditSkill);

    const prompt = useStore.getState().conversations.find((conversation) => conversation.id === cid)
      ?.messages.filter((message) => message.role === "user").at(-1)?.text ?? "";
    expect(prompt).toContain("No cloud phone is selected for this workspace");
    expect(prompt).toContain("mobile profiles list --json");
    expect(bridge.invoke.mock.calls.filter(([channel]) => channel === "nextctl_run")).toHaveLength(0);
  });
});
