import { create } from "zustand";
import { invoke, listen } from "./electronBridge";
import { clawctlEnvelope, clawctlErrorMessage, clawctlJson, clawctlRun } from "./clawctl";
import { prepareSession } from "./preflight";
import {
  AGENTS,
  agentById,
  agentInvocation,
  clawctlAgentAdapter,
  type AgentSpec,
} from "./agents";
import {
  type SkillEntry,
  type SkillCategory,
  selectorFlags,
  selectorTargetHost,
} from "./skillsCatalog";
import { activityFromText, extractToolEvents } from "./lib/activityParser";
import { composePrompt } from "./lib/composePrompt";
import { promptWithAttachments } from "./lib/chatAttachments";
import { normalizeClawctlVersion } from "./lib/version";
import { loadJson, saveJson } from "./lib/storage";
import {
  normalizeConversation,
  normalizeSchedule,
  normalizeScript,
  normalizeUsage,
  serializeConversations,
  serializeSchedules,
  serializeScripts,
  serializeUsage,
} from "./lib/persistence";
import type {
  AppTab,
  ChatAttachment,
  ChatMessage,
  Conversation,
  CustomScript,
  Profile,
  ProxyTraffic,
  ScheduledRun,
  ScriptSyncState,
  SessionStatus,
  SkillApplyState,
  SkillRef,
  UserCommandChip,
  UsageSnapshot,
} from "./types";
import {
  customPrivateSlug,
  customPublishSelector,
} from "./types";

interface QueuedItem {
  conversationId: string;
  rawText: string;
  replyId: string;
}

interface AgentRuntime {
  ready: boolean;
  authorizing: boolean;
  version?: string;
  error?: string;
  loggedIn?: boolean | null;
  queue: QueuedItem[];
  isConsuming: boolean;
  runningReplyId?: string;
  pendingStop: boolean;
}

function emptyRuntime(): AgentRuntime {
  return {
    ready: false,
    authorizing: false,
    queue: [],
    isConsuming: false,
    pendingStop: false,
  };
}

function initRuntimes(): Record<string, AgentRuntime> {
  const r: Record<string, AgentRuntime> = {};
  for (const a of AGENTS) r[a.id] = emptyRuntime();
  return r;
}

const STALL_MS = 120_000;
const WATCHDOG_MS = 5_000;
const PROXY_REFRESH_MS = 120_000;
const SCHEDULE_TICK_MS = 30_000;

// Bound a single streamed reply so a looping/stuck agent that streams for hours
// cannot grow memory without bound; keep only the most recent output once over.
// Far larger than any genuine answer. Mirrors AppState.maxStreamedReplyChars.
const MAX_REPLY_CHARS = 200_000;
const STREAM_TRUNCATION_MARKER = "…[earlier output truncated]\n";
const ACTIVITY_SCAN_TAIL = 2_000;

function capStreamText(text: string): string {
  return text.length > MAX_REPLY_CHARS
    ? STREAM_TRUNCATION_MARKER + text.slice(text.length - MAX_REPLY_CHARS)
    : text;
}

const uid = () => crypto.randomUUID();
const now = () => Date.now();

function skillKey(agentId: string, entryId: string) {
  return `${agentId}:${entryId}`;
}

function pageReadyNote(openedHost?: string): string {
  if (!openedHost) return "";
  return ` The page ${openedHost} is already open in the active NextBrowser profile — work there and don't navigate away unless the steps require it.`;
}

function skillAgentPrompt(
  title: string,
  target: string,
  md: string | undefined,
  slug: string | undefined,
  openedHost?: string,
): string {
  const startHint = openedHost
    ? pageReadyNote(openedHost)
    : ` Start by opening ${target} in the active NextBrowser profile.`;
  if (md) {
    return `Use the "${title}" skill to work with ${target}.${startHint} Follow this SKILL.md exactly, step by step:\n\n${md}`;
  }
  if (slug) {
    return `Use the skill "${slug}" (${title}) to work with ${target}. It is installed in your skills directory — read its SKILL.md and follow it.${startHint}`;
  }
  return `Use the "${title}" skill you just installed to work with ${target}.${startHint}`;
}

function scriptAgentPrompt(
  title: string,
  where: string,
  md: string | undefined,
  slug: string | undefined,
  openedHost?: string,
): string {
  const note = pageReadyNote(openedHost);
  if (md) {
    return `Run the "${title}" script ${where}.${note} Follow this SKILL.md exactly, step by step:\n\n${md}`;
  }
  if (slug) {
    return `Run the "${title}" script ${where}.${note} The skill "${slug}" is installed in your skills directory — read its SKILL.md and follow it step by step.`;
  }
  return `Run the "${title}" script ${where}.${note} Follow its installed SKILL.md step by step.`;
}

async function installedSkillMarkdown(ref?: SkillRef): Promise<string | undefined> {
  const path = ref?.installed?.[0] ?? ref?.installed_path ?? ref?.path;
  if (!path) return undefined;
  try {
    const md = (await invoke<string>("read_file", { path })).trim();
    return md || undefined;
  } catch {
    return undefined;
  }
}

interface State {
  authed: boolean;
  checking: boolean;
  loginError?: string;
  isLoggingIn: boolean;
  proxy?: ProxyTraffic;
  proxyWarning?: string;
  profiles: Profile[];
  statuses: Record<string, string>;
  selectedProfile?: string;
  defaultSession?: SessionStatus;
  profileSearch: string;
  isRefreshing: boolean;
  agentId: string;
  runtime: Record<string, AgentRuntime>;
  conversations: Conversation[];
  activeConvId: Record<string, string>;
  tab: AppTab;
  skillState: Record<string, SkillApplyState>;
  scheduledRuns: ScheduledRun[];
  customScripts: CustomScript[];
  scriptSync: Record<string, ScriptSyncState>;
  usageHistory: UsageSnapshot[];
  showOnboarding: boolean;
  sidebarWidth: number;
  chatListCollapsed: boolean;
  clawctlVersion: string;
  clawctlUpdating: boolean;
  clawctlUpdateStatus?: string;
  clawctlSupportsSkill: boolean;
  skillCategories: SkillCategory[];
  appActive: boolean;
  connectAnnounced: Set<string>;
  workingDir: string;

  bootstrap: () => Promise<void>;
  login: (key: string) => Promise<void>;
  logout: () => void;
  refreshAll: () => Promise<void>;
  refreshProxyData: () => Promise<void>;
  refreshSessions: () => Promise<void>;
  loadProxy: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  loadDefaultSession: () => Promise<void>;
  loadSkillCatalog: () => Promise<void>;
  startDefaultSession: () => Promise<void>;
  stopDefaultSession: () => Promise<void>;
  rotateDefaultSession: () => Promise<void>;
  rotateDefaultSessionCountry: (country: string) => Promise<void>;
  startProfile: (n: string) => Promise<void>;
  stopProfile: (n: string) => Promise<void>;
  rotateProfile: (n: string) => Promise<void>;
  rotateProfileCountry: (n: string, country: string) => Promise<void>;
  deleteProfile: (n: string) => Promise<void>;
  selectProfile: (n?: string) => void;
  switchAgent: (id: string) => void;
  authorizeAgent: () => Promise<void>;
  loginAgent: () => Promise<void>;
  logoutAgent: () => Promise<void>;
  recheckLogin: () => Promise<void>;
  setTab: (t: AppTab) => void;
  setAppActive: (v: boolean) => void;
  setProfileSearch: (q: string) => void;
  setSidebarWidth: (w: number) => void;
  setChatListCollapsed: (v: boolean) => void;
  finishOnboarding: () => void;
  showOnboardingAgain: () => void;
  checkClawctlUpdate: () => Promise<void>;

  conversationsForAgent: (agentId: string) => Conversation[];
  activeConversation: () => Conversation | undefined;
  agentReady: () => boolean;
  agentVersion: () => string | undefined;
  agentError: () => string | undefined;
  agentLoggedIn: () => boolean | null | undefined;
  queuedCount: () => number;
  hasRunning: () => boolean;
  anyAgentRunning: () => boolean;
  filteredProfiles: () => Profile[];
  currentSessionDisplayName: () => string;
  skillApplyState: (entryId: string) => SkillApplyState;

  newChat: () => string;
  createNamedChat: (agentId: string, title: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  deleteConversation: (id: string) => void;
  forkConversation: (atMessageId?: string) => void;
  clearChat: () => void;
  enqueue: (text: string, chip?: UserCommandChip, into?: string, attachments?: ChatAttachment[]) => void;
  stopRunning: () => void;
  cancelQueuedReply: (replyId: string) => boolean;
  editQueuedReply: (replyId: string, newText: string) => boolean;
  canManageQueuedReply: (replyId: string) => boolean;
  send: (text: string) => Promise<void>;
  tryGuidePrompt: (text: string, tab?: AppTab) => Promise<void>;

  applySkill: (entry: SkillEntry) => Promise<SkillRef | undefined>;
  useSkillInChat: (entry: SkillEntry) => Promise<void>;
  runScript: (entry: SkillEntry, host?: string) => Promise<void>;

  addScheduledRun: (run: Omit<ScheduledRun, "id" | "agent" | "enabled">) => void;
  updateScheduledRun: (id: string, patch: Partial<ScheduledRun>) => void;
  deleteScheduledRun: (id: string) => void;
  setScheduledRunEnabled: (id: string, enabled: boolean) => void;
  scheduledRunChatTitle: (run: ScheduledRun) => string | undefined;

  saveCustomScript: (script: CustomScript) => Promise<void>;
  deleteCustomScript: (id: string) => void;
  runCustomScript: (script: CustomScript) => Promise<void>;

  // Internal queue/runtime helpers
  reconcileQueues: () => void;
  startTimers: () => void;
  tickScheduledRuns: () => Promise<void>;
  startConsumer: (agentId: string) => void;
  dequeue: (agentId: string) => QueuedItem | null;
  processItem: (agentId: string, item: QueuedItem) => Promise<void>;
  setMessageStatus: (cid: string, mid: string, status: ChatMessage["status"], fallback?: string) => void;
  appendToMessage: (cid: string, mid: string, chunk: string) => void;
  makeStepMessage: (cid: string) => string;
  appendStep: (cid: string, mid: string, step: string) => void;
  startSessionPoll: () => void;
  ensureConversation: (agentId: string) => void;
  announceConnect: (agentId: string, version: string, loggedIn: boolean | null) => void;
}

let proxyTimer: ReturnType<typeof setInterval> | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let sessionPollTimer: ReturnType<typeof setInterval> | null = null;
// Guard bootstrap against re-entry. React StrictMode invokes effects twice in
// dev, and without this each agent:* listener would be registered again, so a
// single agent reply would be appended once per registration (duplicate output).
// Mirrors AppState.didBootstrap in the Swift app.
let didBootstrap = false;
type AgentDone = { code: number; stderr: string };
const completionResolvers = new Map<string, (result: AgentDone) => void>();

function persistConvs(conversations: Conversation[]) {
  void saveJson("conversations.json", serializeConversations(conversations));
}

function persistSchedules(runs: ScheduledRun[]) {
  void saveJson("scheduled-runs.json", serializeSchedules(runs));
}

function persistScripts(scripts: CustomScript[]) {
  void saveJson("custom-scripts.json", serializeScripts(scripts));
}

export const useStore = create<State>((set, get) => ({
  authed: false,
  checking: true,
  isLoggingIn: false,
  profiles: [],
  statuses: {},
  profileSearch: "",
  isRefreshing: false,
  agentId: localStorage.getItem("lastAgent") ?? "claude",
  runtime: initRuntimes(),
  conversations: [],
  activeConvId: {},
  tab: "chat",
  skillState: {},
  skillCategories: [],
  scheduledRuns: [],
  customScripts: [],
  scriptSync: {},
  usageHistory: [],
  showOnboarding: false,
  sidebarWidth: Number(localStorage.getItem("sidebarWidth") ?? 300),
  chatListCollapsed: localStorage.getItem("chatListCollapsed") === "true",
  clawctlVersion: "",
  clawctlUpdating: false,
  clawctlSupportsSkill: true,
  appActive: true,
  connectAnnounced: new Set(),
  workingDir: "",

  conversationsForAgent: (agentId) =>
    get()
      .conversations.filter((c) => c.agent === agentId)
      .sort((a, b) => b.updatedAt - a.updatedAt),

  activeConversation: () => {
    const s = get();
    const id = s.activeConvId[s.agentId];
    if (id) return s.conversations.find((c) => c.id === id);
    return get().conversationsForAgent(s.agentId)[0];
  },

  agentReady: () => get().runtime[get().agentId]?.ready ?? false,
  agentVersion: () => get().runtime[get().agentId]?.version,
  agentError: () => get().runtime[get().agentId]?.error,
  agentLoggedIn: () => get().runtime[get().agentId]?.loggedIn,
  queuedCount: () =>
    (get().activeConversation()?.messages ?? []).filter((m) => m.status === "queued").length,
  hasRunning: () => !!get().runtime[get().agentId]?.runningReplyId,
  anyAgentRunning: () => Object.values(get().runtime).some((runtime) => !!runtime.runningReplyId),
  filteredProfiles: () => {
    const q = get().profileSearch.trim().toLowerCase();
    if (!q) return get().profiles;
    return get().profiles.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.country?.toLowerCase().includes(q) ?? false) ||
        (p.city?.toLowerCase().includes(q) ?? false),
    );
  },
  currentSessionDisplayName: () => get().selectedProfile ?? "current session",
  skillApplyState: (entryId) => get().skillState[skillKey(get().agentId, entryId)] ?? "idle",

  bootstrap: async () => {
    if (didBootstrap) return;
    didBootstrap = true;
    const [rawConvs, rawSchedules, rawScripts, rawHistory, wd] = await Promise.all([
      loadJson<Conversation[]>("conversations.json", []),
      loadJson<ScheduledRun[]>("scheduled-runs.json", []),
      loadJson<CustomScript[]>("custom-scripts.json", []),
      loadJson<UsageSnapshot[]>("usage-history.json", []),
      invoke<string>("working_directory").catch(() => ""),
    ]);
    const convs = rawConvs.map(normalizeConversation);
    const schedules = rawSchedules.map(normalizeSchedule);
    const scripts = rawScripts.map(normalizeScript);
    const history = rawHistory.map(normalizeUsage);
    const activeConvId: Record<string, string> = {};
    for (const a of AGENTS) {
      const first = convs.find((c) => c.agent === a.id);
      if (first) activeConvId[a.id] = first.id;
    }
    set({
      conversations: convs,
      activeConvId,
      scheduledRuns: schedules,
      customScripts: scripts,
      usageHistory: history,
      workingDir: wd,
    });
    get().reconcileQueues();

    await listen<[string, string]>("agent:chunk", (e) => {
      const [replyId, chunk] = e.payload;
      set((s) => {
        const conversations = s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== replyId) return m;
            const text = capStreamText(m.text + chunk);
            return {
              ...m,
              text,
              status: "streaming" as const,
              lastActivityAt: now(),
              stalled: false,
              // Scan only the recent tail — activityFromText over the whole
              // growing text on every chunk is O(n²) and stalls the UI thread.
              activityLabel: activityFromText(text.slice(-ACTIVITY_SCAN_TAIL)) ?? m.activityLabel,
              toolEvents: extractToolEvents(chunk, m.toolEvents ?? []),
            };
          }),
        }));
        // Persist on completion (agent:done), not on every chunk — writing the
        // whole conversation store to disk per 4 KB chunk is an IO storm the
        // Swift app avoids. An interrupted reply is reconciled on next launch.
        return { conversations };
      });
    });

    await listen<[string, string]>("agent:activity", (e) => {
      const [replyId, chunk] = e.payload;
      set((s) => {
        const conversations = s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== replyId) return m;
            return {
              ...m,
              lastActivityAt: now(),
              stalled: false,
              activityLabel: activityFromText(chunk) ?? m.activityLabel,
              toolEvents: extractToolEvents(chunk, m.toolEvents ?? []),
            };
          }),
        }));
        // Persisted on completion (agent:done), not per chunk — see agent:chunk.
        return { conversations };
      });
    });

    await listen<[string, number, string]>("agent:done", async (e) => {
      const [replyId, code, stderr] = e.payload;
      const owningConversation = get().conversations.find((conversation) =>
        conversation.messages.some((message) => message.id === replyId),
      );
      const agentId =
        Object.entries(get().runtime).find(([, runtime]) => runtime.runningReplyId === replyId)?.[0] ??
        owningConversation?.agent ??
        get().agentId;
      const rt = get().runtime[agentId];
      const stopped = rt?.pendingStop;
      set((s) => {
        const runtime = { ...s.runtime };
        if (runtime[agentId]) {
          runtime[agentId] = {
            ...runtime[agentId],
            runningReplyId: undefined,
            pendingStop: false,
          };
        }
        const conversations = s.conversations.map((c) => ({
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== replyId) return m;
            let status = m.status;
            let text = m.text.trim();
            if (stopped) {
              status = "cancelled";
              text = text ? `${text}\n[stopped]` : "[stopped]";
            } else if (code !== 0 && m.status === "streaming") {
              status = "failed";
              const detail = stderr.trim();
              if (detail) {
                const name = agentById(agentId).name;
                text = text ? `${text}\n[${name} error] ${detail}` : `[${name} error] ${detail}`;
              }
            } else if (m.status === "streaming") {
              status = "done";
              if (!text) text = "(no output)";
            }
            return { ...m, status, text, stalled: false };
          }),
        }));
        persistConvs(conversations);
        return { conversations, runtime };
      });
      try {
        await get().refreshAll();
      } finally {
        const resolve = completionResolvers.get(replyId);
        completionResolvers.delete(replyId);
        resolve?.({ code, stderr });
      }
    });

    try {
      const ver = await invoke<string>("clawctl_version");
      const supportsSkill = await invoke<boolean>("clawctl_supports_skill");
      set({ clawctlVersion: normalizeClawctlVersion(ver), clawctlSupportsSkill: supportsSkill });
    } catch {
      set({ clawctlVersion: "not found", clawctlSupportsSkill: false });
    }

    try {
      await get().loadProxy();
      set({ authed: true });
      get().startTimers();
      await get().refreshAll();
      await get().authorizeAgent();
      if (!localStorage.getItem("onboardingComplete")) {
        set({ showOnboarding: true });
      }
    } catch {
      /* manual login */
    } finally {
      set({ checking: false });
    }
  },

  startTimers: () => {
    if (proxyTimer) clearInterval(proxyTimer);
    proxyTimer = setInterval(() => {
      if (!get().appActive || !get().authed) return;
      get().loadProxy().catch(() => {});
      get().loadDefaultSession().catch(() => {});
    }, PROXY_REFRESH_MS);
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = setInterval(() => get().tickScheduledRuns(), SCHEDULE_TICK_MS);
  },

  tickScheduledRuns: async () => {
    if (!get().authed) return;
    const d = new Date();
    const hour = d.getHours();
    const minute = d.getMinutes();
    const weekday = d.getDay() + 1;
    for (const run of get().scheduledRuns) {
      if (!run.enabled) continue;
      if (run.hour !== hour || run.minute !== minute || !run.weekdays.includes(weekday)) continue;
      if (run.lastFiredAt) {
        const last = new Date(run.lastFiredAt);
        if (
          last.toDateString() === d.toDateString() &&
          last.getHours() === hour &&
          last.getMinutes() === minute
        )
          continue;
      }
      const runs = get().scheduledRuns.map((r) =>
        r.id === run.id ? { ...r, lastFiredAt: now() } : r,
      );
      set({ scheduledRuns: runs });
      persistSchedules(runs);
      const prev = get().agentId;
      get().switchAgent(run.agent);
      if (!get().agentReady()) await get().authorizeAgent();
      let cid = run.conversationId;
      if (!cid || !get().conversations.some((c) => c.id === cid && c.agent === run.agent)) {
        cid = get().newChat();
        const title = run.title || "Scheduled";
        get().renameConversation(cid, title);
      } else {
        get().selectConversation(cid);
      }
      get().enqueue(run.prompt, undefined, cid);
      get().switchAgent(prev);
    }
  },

  reconcileQueues: () => {
    const s = get();
    const runtime = { ...s.runtime };
    let conversations = [...s.conversations];
    for (const agent of AGENTS) {
      const r = { ...runtime[agent.id] };
      const restored: QueuedItem[] = [];
      conversations = conversations.map((conv) => {
        if (conv.agent !== agent.id) return conv;
        const msgs = conv.messages.map((m, i, arr) => {
          if (m.role !== "assistant") return m;
          if (m.status === "streaming" && r.runningReplyId !== m.id) {
            return {
              ...m,
              status: "failed" as const,
              text: m.text.trim() || "Interrupted before the reply finished.",
            };
          }
          if (m.status === "queued") {
            const tracked = r.queue.some((q) => q.replyId === m.id);
            if (tracked) return m;
            const user = i > 0 ? arr[i - 1] : undefined;
            if (user?.role === "user") {
              restored.push({
                conversationId: conv.id,
                rawText: user.text,
                replyId: m.id,
              });
              return m;
            }
            return { ...m, status: "failed" as const, text: "(orphaned queued reply)" };
          }
          return m;
        });
        return { ...conv, messages: msgs };
      });
      for (const item of restored) {
        if (!r.queue.some((q) => q.replyId === item.replyId)) r.queue.push(item);
      }
      if (r.isConsuming && !r.runningReplyId) r.isConsuming = false;
      runtime[agent.id] = r;
    }
    persistConvs(conversations);
    set({ conversations, runtime });
    const agentId = get().agentId;
    if (runtime[agentId]?.ready && runtime[agentId].queue.length) {
      get().startConsumer(agentId);
    }
  },

  startConsumer: (agentId: string) => {
    const rt = get().runtime[agentId];
    if (!rt?.ready || rt.isConsuming) return;
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], isConsuming: true },
      },
    }));
    void (async () => {
      while (true) {
        const item = get().dequeue(agentId);
        if (!item) break;
        await get().processItem(agentId, item);
      }
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], isConsuming: false },
        },
      }));
    })();
  },

  dequeue: (agentId: string) => {
    const rt = get().runtime[agentId];
    if (!rt?.queue.length) return null;
    const item = rt.queue[0];
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: {
          ...s.runtime[agentId],
          queue: s.runtime[agentId].queue.slice(1),
        },
      },
    }));
    return item;
  },

  processItem: async (agentId: string, item: QueuedItem) => {
    if (!get().runtime[agentId]?.ready) {
      get().setMessageStatus(item.conversationId, item.replyId, "failed", "Agent not connected.");
      return;
    }
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: {
          ...s.runtime[agentId],
          runningReplyId: item.replyId,
          pendingStop: false,
        },
      },
    }));
    get().setMessageStatus(item.conversationId, item.replyId, "streaming");
    get().startSessionPoll();

    const prompt = composePrompt(
      get().conversations,
      item.conversationId,
      item.replyId,
      item.rawText,
      get().selectedProfile,
    );
    const a = agentById(agentId);
    const { args, stdin } = agentInvocation(a, prompt);

    const watchdog = setInterval(() => {
      const conv = get().conversations.find((c) => c.id === item.conversationId);
      const msg = conv?.messages.find((m) => m.id === item.replyId);
      if (!msg || msg.status !== "streaming") return;
      const last = msg.lastActivityAt ?? msg.runStartedAt ?? msg.createdAt;
      const stalled = now() - last >= STALL_MS;
      if (msg.stalled !== stalled) {
        set((s) => {
          const conversations = s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === item.replyId ? { ...m, stalled } : m,
            ),
          }));
          persistConvs(conversations);
          return { conversations };
        });
      }
    }, WATCHDOG_MS);

    const completion = new Promise<AgentDone>((resolve) => {
      completionResolvers.set(item.replyId, resolve);
    });
    try {
      await invoke("agent_run", {
        replyId: item.replyId,
        binary: a.binary,
        envVar: a.envVar,
        args,
        stdinText: stdin ?? null,
        workingDir: get().workingDir || null,
      });
      // The Rust command returns after spawning. Await the matching done event so
      // this agent's queue remains strictly serial, like Swift AgentRunner.
      await completion;
    } catch (e) {
      completionResolvers.delete(item.replyId);
      get().appendToMessage(item.conversationId, item.replyId, `\n[error] ${e}`);
      get().setMessageStatus(item.conversationId, item.replyId, "failed");
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], runningReplyId: undefined },
        },
      }));
    } finally {
      clearInterval(watchdog);
    }
  },

  setMessageStatus: (cid: string, mid: string, status: ChatMessage["status"], fallback?: string) => {
    const changedAt = now();
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === cid
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === mid
                  ? {
                      ...m,
                      status,
                      text: m.text || fallback || m.text,
                      ...(status === "streaming"
                        ? {
                            runStartedAt: changedAt,
                            lastActivityAt: changedAt,
                            stalled: false,
                            activityLabel: "Thinking",
                          }
                        : {}),
                    }
                  : m,
              ),
              updatedAt: now(),
            }
          : c,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  appendToMessage: (cid: string, mid: string, chunk: string) => {
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === cid
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === mid ? { ...m, text: m.text + chunk } : m,
              ),
            }
          : c,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  makeStepMessage: (cid: string) => {
    const id = uid();
    const message: ChatMessage = {
      id,
      role: "system",
      text: "Preparing…",
      status: "done",
      createdAt: now(),
    };
    set((s) => {
      const conversations = s.conversations.map((conversation) =>
        conversation.id === cid
          ? {
              ...conversation,
              messages: [...conversation.messages, message],
              updatedAt: now(),
            }
          : conversation,
      );
      persistConvs(conversations);
      return { conversations };
    });
    return id;
  },

  appendStep: (cid: string, mid: string, step: string) => {
    set((s) => {
      const conversations = s.conversations.map((conversation) =>
        conversation.id === cid
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === mid
                  ? {
                      ...message,
                      text:
                        !message.text || message.text === "Preparing…"
                          ? `✓ ${step}`
                          : `${message.text}   ✓ ${step}`,
                    }
                  : message,
              ),
            }
          : conversation,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  startSessionPoll: () => {
    if (sessionPollTimer) return;
    sessionPollTimer = setInterval(() => {
      if (!get().anyAgentRunning()) {
        if (sessionPollTimer) clearInterval(sessionPollTimer);
        sessionPollTimer = null;
        return;
      }
      get().loadProfiles().catch(() => {});
      get().loadDefaultSession().catch(() => {});
    }, 2000);
  },

  login: async (key) => {
    set({ loginError: undefined, isLoggingIn: true });
    try {
      await clawctlRun(["config", "set", "--api-key", key.trim()]);
      await get().loadProxy();
      set({ authed: true });
      get().startTimers();
      await get().refreshAll();
      await get().authorizeAgent();
      if (!localStorage.getItem("onboardingComplete")) set({ showOnboarding: true });
    } catch (e) {
      set({ loginError: String(e) });
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: () => {
    if (proxyTimer) clearInterval(proxyTimer);
    if (scheduleTimer) clearInterval(scheduleTimer);
    if (sessionPollTimer) clearInterval(sessionPollTimer);
    proxyTimer = scheduleTimer = sessionPollTimer = null;
    set({
      authed: false,
      runtime: initRuntimes(),
      connectAnnounced: new Set(),
      proxy: undefined,
      proxyWarning: undefined,
      profiles: [],
      statuses: {},
      defaultSession: undefined,
      skillState: {},
      tab: "chat",
    });
  },

  refreshAll: async () => {
    set({ isRefreshing: true });
    try {
      await get().loadProxy().catch(() => {});
      await get().loadProfiles();
      await get().loadDefaultSession();
      await get().loadSkillCatalog();
    } finally {
      set({ isRefreshing: false });
    }
  },

  refreshProxyData: async () => {
    set({ isRefreshing: true });
    try {
      await get().loadProxy();
    } finally {
      set({ isRefreshing: false });
    }
  },

  refreshSessions: async () => {
    set({ isRefreshing: true });
    try {
      await get().loadProfiles();
      await get().loadDefaultSession();
    } finally {
      set({ isRefreshing: false });
    }
  },

  loadProxy: async () => {
    const wrap = await clawctlJson<{ proxy_traffic: ProxyTraffic }>(["proxy-traffic"]);
    const p = wrap.proxy_traffic;
    const frac =
      p.percent_used != null
        ? p.percent_used / 100
        : p.limit_bytes
          ? p.used_bytes / p.limit_bytes
          : 0;
    const proxyWarning =
      frac >= 1
        ? "Proxy traffic limit reached. Add data in the dashboard."
        : frac >= 0.9
          ? "Proxy traffic almost exhausted."
          : undefined;
    const snap: UsageSnapshot = {
      id: uid(),
      date: now(),
      usedBytes: p.used_bytes,
      limitBytes: p.limit_bytes ?? undefined,
    };
    const history = [...get().usageHistory];
    const last = history[history.length - 1];
    const same =
      last?.usedBytes === snap.usedBytes && last?.limitBytes === snap.limitBytes;
    const elapsed = last ? snap.date - last.date : Number.POSITIVE_INFINITY;
    if (same && elapsed < 30_000) {
      // Match Swift: ignore rapid duplicate manual refreshes.
    } else if (same && elapsed < 300_000 && history.length) {
      history[history.length - 1] = snap;
    } else {
      history.push(snap);
    }
    if (history.length > 96) history.splice(0, history.length - 96);
    void saveJson("usage-history.json", serializeUsage(history));
    set({ proxy: p, proxyWarning, usageHistory: history });
  },

  loadProfiles: async () => {
    try {
      const list = await clawctlJson<{ profiles: Profile[] }>(["profiles", "ls"]);
      set({ profiles: list.profiles });
      for (const p of list.profiles) {
        try {
          const st = await clawctlJson<SessionStatus>(["status", "--profile", p.name]);
          set((s) => ({ statuses: { ...s.statuses, [p.name]: st.status } }));
        } catch {
          set((s) => ({ statuses: { ...s.statuses, [p.name]: "unknown" } }));
        }
      }
    } catch {
      /* non-fatal */
    }
  },

  loadDefaultSession: async () => {
    try {
      const st = await clawctlJson<SessionStatus>(["status"]);
      set({ defaultSession: st });
    } catch {
      set({ defaultSession: undefined });
    }
  },

  loadSkillCatalog: async () => {
    if (!get().clawctlSupportsSkill) return;
    try {
      const catalog = await clawctlJson<{ categories: Array<{ id: string; title: string; icon: string; order: number; skills: SkillRef[] }> }>(["skill", "list"]);
      set({
        skillCategories: catalog.categories.map((category) => ({
          id: category.id, title: category.title, icon: category.icon,
          blurb: `Published ${category.title.toLowerCase()} available from the backend.`,
          entries: category.skills
            .filter((ref) => ref.slug && ref.title && ref.selector && (ref.kind === "domain" || ref.kind === "captcha"))
            .map((ref) => ({
              id: ref.slug!, title: ref.title!, subtitle: ref.selector!, description: ref.description,
              category: category.id, categoryTitle: category.title,
              categoryIcon: category.icon, categoryOrder: category.order,
              selector: { kind: ref.kind === "domain" && ref.selector!.endsWith(".script") ? "script" : ref.kind!, value: ref.selector! },
            })),
        })),
      });
    } catch {
      set({ skillCategories: [] });
    }
  },

  startDefaultSession: async () => {
    await clawctlRun(["start", "--format", "json"]);
    await get().loadDefaultSession();
  },

  stopDefaultSession: async () => {
    await clawctlRun(["stop", "--format", "json"]);
    await get().loadDefaultSession();
  },

  rotateDefaultSession: async () => {
    await clawctlRun(["rotate", "--format", "json"]);
    await get().loadDefaultSession();
    await get().loadProxy().catch(() => {});
  },

  rotateDefaultSessionCountry: async (country) => {
    await clawctlRun(["rotate", "--country", country, "--verify", "--format", "json"]);
    await get().loadDefaultSession();
    await get().loadProxy().catch(() => {});
  },

  startProfile: async (n) => {
    set((s) => ({ statuses: { ...s.statuses, [n]: "starting" } }));
    await clawctlRun(["start", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
  },

  stopProfile: async (n) => {
    set((s) => ({ statuses: { ...s.statuses, [n]: "stopping" } }));
    await clawctlRun(["stop", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
  },

  rotateProfile: async (n) => {
    set((s) => ({ statuses: { ...s.statuses, [n]: "rotating" } }));
    await clawctlRun(["rotate", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
    await get().loadProxy().catch(() => {});
  },

  rotateProfileCountry: async (n, country) => {
    set((s) => ({ statuses: { ...s.statuses, [n]: "rotating" } }));
    await clawctlRun([
      "rotate",
      "--profile",
      n,
      "--country",
      country,
      "--verify",
      "--format",
      "json",
    ]);
    await get().loadProfiles();
    await get().loadProxy().catch(() => {});
  },

  deleteProfile: async (n) => {
    if (get().statuses[n] === "running") {
      await clawctlRun(["stop", "--profile", n, "--format", "json"]);
    }
    await clawctlRun(["profiles", "rm", n, "--format", "json"]);
    if (get().selectedProfile === n) set({ selectedProfile: undefined });
    set((s) => {
      const statuses = { ...s.statuses };
      delete statuses[n];
      return { statuses };
    });
    await get().loadProfiles();
  },

  selectProfile: (n) => set({ selectedProfile: n }),

  switchAgent: (id) => {
    if (id === get().agentId) return;
    localStorage.setItem("lastAgent", id);
    set({ agentId: id });
    get().ensureConversation(id);
    get().reconcileQueues();
    get().startConsumer(id);
  },

  ensureConversation: (agentId: string) => {
    const convs = get().conversationsForAgent(agentId);
    if (!convs.length) {
      get().newChat();
    } else if (!get().activeConvId[agentId]) {
      set((s) => ({
        activeConvId: { ...s.activeConvId, [agentId]: convs[0].id },
      }));
    }
  },

  authorizeAgent: async () => {
    const agentId = get().agentId;
    const rt = get().runtime[agentId];
    if (rt?.ready || rt?.authorizing) return;
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], authorizing: true, error: undefined },
      },
    }));
    const a = agentById(agentId);
    try {
      const version = await invoke<string>("agent_authorize", {
        binary: a.binary,
        envVar: a.envVar,
      });
      const loggedIn = (await invoke<boolean | null>("agent_check_login", {
        binary: a.binary,
        envVar: a.envVar,
        statusArgs: a.statusArgs ?? [],
      })) as boolean | null;
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: {
            ...s.runtime[agentId],
            ready: true,
            authorizing: false,
            version,
            loggedIn,
            error: undefined,
          },
        },
      }));
      get().ensureConversation(agentId);
      get().announceConnect(agentId, version, loggedIn);
      get().reconcileQueues();
      get().startConsumer(agentId);
      // Installation is idempotent. Keep connection fast and refresh the
      // agent's bundled clawctl skill/integration in the background.
      const adapter = clawctlAgentAdapter(agentId);
      void clawctlRun(["install", "--agent", adapter, "--no-api-key-prompt"]).then((result) => {
        if (result.code !== 0) {
          console.warn(`Could not install clawctl skill for ${adapter}: ${clawctlErrorMessage(result)}`);
        }
      }).catch((error) => console.warn(`Could not install clawctl skill for ${adapter}:`, error));
    } catch (e) {
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: {
            ...s.runtime[agentId],
            ready: false,
            authorizing: false,
            error: String(e),
          },
        },
      }));
    }
  },

  announceConnect: (agentId: string, version: string, loggedIn: boolean | null) => {
    const announced = get().connectAnnounced;
    if (announced.has(agentId)) return;
    const a = agentById(agentId);
    const cid = get().activeConvId[agentId];
    if (!cid) return;
    const conv = get().conversations.find((c) => c.id === cid);
    const prefix = `${a.name} connected`;
    if (conv?.messages.some((m) => m.role === "system" && m.text.startsWith(prefix))) {
      announced.add(agentId);
      set({ connectAnnounced: new Set(announced) });
      return;
    }
    announced.add(agentId);
    const note = loggedIn === false ? " You're not signed in — use “Log in”." : "";
    const msg: ChatMessage = {
      id: uid(),
      role: "system",
      text: `${prefix} — ${version}.${note}`,
      status: "done",
      createdAt: now(),
    };
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === cid ? { ...c, messages: [...c.messages, msg], updatedAt: now() } : c,
      );
      persistConvs(conversations);
      return { conversations, connectAnnounced: new Set(announced) };
    });
  },

  loginAgent: async () => {
    const agentId = get().agentId;
    const a = agentById(agentId);
    try {
      await invoke("open_terminal_login", {
        binary: a.binary,
        envVar: a.envVar,
        loginArgs: a.loginArgs,
      });
      const cid = get().activeConvId[agentId] ?? get().activeConversation()?.id;
      if (cid) {
        const msg: ChatMessage = {
          id: uid(),
          role: "system",
          text: `Opened Terminal to sign in to ${a.name}. Finish in your browser; this updates automatically.`,
          status: "done",
          createdAt: now(),
        };
        set((s) => {
          const conversations = s.conversations.map((c) =>
            c.id === cid ? { ...c, messages: [...c.messages, msg], updatedAt: now() } : c,
          );
          persistConvs(conversations);
          return { conversations };
        });
      }
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const loggedIn = (await invoke<boolean | null>("agent_check_login", {
          binary: a.binary,
          envVar: a.envVar,
          statusArgs: a.statusArgs ?? [],
        })) as boolean | null;
        if (loggedIn === true) {
          set((s) => ({
            runtime: {
              ...s.runtime,
              [agentId]: { ...s.runtime[agentId], loggedIn: true },
            },
          }));
          return;
        }
      }
    } catch (e) {
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], error: String(e) },
        },
      }));
    }
  },

  // Switch the signed-in account for an agent that owns its own auth (Claude
  // Code, Codex). Their credentials live inside the CLI, so the only reliable
  // way to change accounts is to run the CLI's own logout in a real terminal
  // (interactive, shows output) — the same proven path as "Log in". Afterwards
  // we poll login status so the UI flips back to "Log in" once signed out.
  logoutAgent: async () => {
    const agentId = get().agentId;
    const a = agentById(agentId);
    if (!a.logoutArgs.length) return;
    try {
      await invoke("open_terminal_login", {
        binary: a.binary,
        envVar: a.envVar,
        loginArgs: a.logoutArgs,
      });
      const cid = get().activeConvId[agentId] ?? get().activeConversation()?.id;
      if (cid) {
        const msg: ChatMessage = {
          id: uid(),
          role: "system",
          text: `Opened Terminal to sign out of ${a.name}. Once it finishes, use “Log in” to sign in with another account.`,
          status: "done",
          createdAt: now(),
        };
        set((s) => {
          const conversations = s.conversations.map((c) =>
            c.id === cid ? { ...c, messages: [...c.messages, msg], updatedAt: now() } : c,
          );
          persistConvs(conversations);
          return { conversations };
        });
      }
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const loggedIn = (await invoke<boolean | null>("agent_check_login", {
          binary: a.binary,
          envVar: a.envVar,
          statusArgs: a.statusArgs ?? [],
        })) as boolean | null;
        if (loggedIn !== true) {
          set((s) => ({
            runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], loggedIn } },
          }));
          return;
        }
      }
    } catch (e) {
      set((s) => ({
        runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], error: String(e) } },
      }));
    }
  },

  recheckLogin: async () => {
    const agentId = get().agentId;
    const a = agentById(agentId);
    if (!get().runtime[agentId]?.ready) return;
    const loggedIn = (await invoke<boolean | null>("agent_check_login", {
      binary: a.binary,
      envVar: a.envVar,
      statusArgs: a.statusArgs ?? [],
    })) as boolean | null;
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], loggedIn },
      },
    }));
  },

  setTab: (t) => set({ tab: t }),
  setAppActive: (v) => set({ appActive: v }),
  setProfileSearch: (q) => set({ profileSearch: q }),
  setSidebarWidth: (w) => {
    localStorage.setItem("sidebarWidth", String(w));
    set({ sidebarWidth: w });
  },
  setChatListCollapsed: (v) => {
    localStorage.setItem("chatListCollapsed", String(v));
    set({ chatListCollapsed: v });
  },
  finishOnboarding: () => {
    localStorage.setItem("onboardingComplete", "true");
    set({ showOnboarding: false });
  },
  showOnboardingAgain: () => set({ showOnboarding: true }),

  checkClawctlUpdate: async () => {
    set({ clawctlUpdating: true, clawctlUpdateStatus: undefined });
    try {
      const res = await clawctlRun(["update"]);
      const text = res.stdout + res.stderr;
      const line = text.split("\n").find((l) => l.includes("clawctl updated:"));
      if (line) {
        const to = line.split(">").pop()?.trim() ?? "";
        set({
          clawctlUpdateStatus: to
            ? `updated → ${normalizeClawctlVersion(to)}`
            : "updated",
        });
      } else if (res.code === 0) {
        // Already current — keep the footer on one line; show nothing.
        set({ clawctlUpdateStatus: undefined });
      } else {
        set({ clawctlUpdateStatus: "update failed" });
      }
      const ver = await invoke<string>("clawctl_version");
      const supportsSkill = await invoke<boolean>("clawctl_supports_skill");
      set({ clawctlVersion: normalizeClawctlVersion(ver), clawctlSupportsSkill: supportsSkill });
    } catch {
      set({ clawctlUpdateStatus: "update failed" });
    } finally {
      set({ clawctlUpdating: false });
    }
  },

  newChat: () => {
    const agentId = get().agentId;
    const n = get().conversationsForAgent(agentId).length + 1;
    const c: Conversation = {
      id: uid(),
      title: `Chat ${n}`,
      agent: agentId,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const conversations = [...get().conversations, c];
    persistConvs(conversations);
    set({
      conversations,
      activeConvId: { ...get().activeConvId, [agentId]: c.id },
    });
    return c.id;
  },

  // Create a titled chat bound to a specific agent (used by scheduled runs to
  // spin up a dedicated chat for a task right from the editor). Does not change
  // the active chat/agent selection.
  createNamedChat: (agentId, title) => {
    const clean = title.trim();
    const c: Conversation = {
      id: uid(),
      title: clean || `Chat ${get().conversationsForAgent(agentId).length + 1}`,
      agent: agentId,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const conversations = [...get().conversations, c];
    persistConvs(conversations);
    set({
      conversations,
      activeConvId: { ...get().activeConvId, [agentId]: get().activeConvId[agentId] ?? c.id },
    });
    return c.id;
  },

  selectConversation: (id) => {
    const agentId = get().agentId;
    set({ activeConvId: { ...get().activeConvId, [agentId]: id } });
  },

  renameConversation: (id, title) => {
    const t = title.trim();
    if (!t) return;
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === id ? { ...c, title: t } : c,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  deleteConversation: (id) => {
    const agentId = get().agentId;
    const conversations = get().conversations.filter((c) => c.id !== id);
    const activeConvId = { ...get().activeConvId };
    if (activeConvId[agentId] === id) {
      activeConvId[agentId] = get()
        .conversationsForAgent(agentId)
        .filter((c) => c.id !== id)[0]?.id;
    }
    persistConvs(conversations);
    set({ conversations, activeConvId });
  },

  forkConversation: (atMessageId) => {
    const conv = get().activeConversation();
    if (!conv) return;
    let messages = [...conv.messages];
    if (atMessageId) {
      const idx = messages.findIndex((m) => m.id === atMessageId);
      if (idx >= 0) messages = messages.slice(0, idx + 1);
    }
    const fork: Conversation = {
      id: uid(),
      title: `${conv.title} · fork`,
      agent: conv.agent,
      messages,
      createdAt: now(),
      updatedAt: now(),
      parentId: conv.id,
      forkedFromMessageId: atMessageId,
    };
    const conversations = [...get().conversations, fork];
    persistConvs(conversations);
    set({
      conversations,
      activeConvId: { ...get().activeConvId, [conv.agent]: fork.id },
    });
  },

  clearChat: () => {
    if (get().hasRunning()) return;
    const cid = get().activeConversation()?.id;
    if (!cid) return;
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === cid ? { ...c, messages: [], updatedAt: now() } : c,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  enqueue: (text, chip, into, attachments = []) => {
    const prompt = text.trim();
    if (!prompt) return;
    if (prompt === "/login" || prompt.startsWith("/login ")) {
      void get().loginAgent();
      return;
    }
    if (!get().agentReady()) return;
    const agentId = get().agentId;
    const cid = into ?? get().activeConversation()?.id ?? get().newChat();
    const replyId = uid();
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      text: prompt,
      status: "done",
      createdAt: now(),
      commandChip: chip,
      attachments,
    };
    const reply: ChatMessage = {
      id: replyId,
      role: "assistant",
      text: "",
      status: "queued",
      createdAt: now(),
    };
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === cid
          ? { ...c, messages: [...c.messages, userMsg, reply], updatedAt: now() }
          : c,
      );
      const runtime = {
        ...s.runtime,
        [agentId]: {
          ...s.runtime[agentId],
          queue: [
            ...s.runtime[agentId].queue,
            {
              conversationId: cid,
              rawText: promptWithAttachments(prompt, attachments),
              replyId,
            },
          ],
        },
      };
      persistConvs(conversations);
      return { conversations, runtime };
    });
    get().startConsumer(agentId);
  },

  stopRunning: () => {
    const agentId = get().agentId;
    const replyId = get().runtime[agentId]?.runningReplyId;
    if (!replyId) return;
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], pendingStop: true },
      },
    }));
    void invoke("agent_terminate", { replyId });
  },

  canManageQueuedReply: (replyId) => {
    const agentId = get().agentId;
    const rt = get().runtime[agentId];
    if (rt?.runningReplyId === replyId) return false;
    const conv = get().conversations.find((c) =>
      c.messages.some((m) => m.id === replyId),
    );
    const msg = conv?.messages.find((m) => m.id === replyId);
    if (msg?.status !== "queued") return false;
    return rt?.queue.some((q) => q.replyId === replyId) ?? false;
  },

  cancelQueuedReply: (replyId) => {
    if (!get().canManageQueuedReply(replyId)) return false;
    const agentId = get().agentId;
    set((s) => {
      const runtime = {
        ...s.runtime,
        [agentId]: {
          ...s.runtime[agentId],
          queue: s.runtime[agentId].queue.filter((q) => q.replyId !== replyId),
        },
      };
      const conversations = s.conversations.map((c) => {
        const replyIdx = c.messages.findIndex((m) => m.id === replyId);
        if (replyIdx < 0) return c;
        const msgs = [...c.messages];
        msgs.splice(replyIdx, 1);
        if (replyIdx > 0 && msgs[replyIdx - 1]?.role === "user") msgs.splice(replyIdx - 1, 1);
        return { ...c, messages: msgs, updatedAt: now() };
      });
      persistConvs(conversations);
      return { conversations, runtime };
    });
    return true;
  },

  editQueuedReply: (replyId, newText) => {
    const text = newText.trim();
    if (!text || !get().canManageQueuedReply(replyId)) return false;
    const agentId = get().agentId;
    set((s) => {
      const runtime = {
        ...s.runtime,
        [agentId]: {
          ...s.runtime[agentId],
          queue: s.runtime[agentId].queue.map((q) =>
            q.replyId === replyId ? { ...q, rawText: text } : q,
          ),
        },
      };
      const conversations = s.conversations.map((c) => {
        const replyIdx = c.messages.findIndex((m) => m.id === replyId);
        if (replyIdx < 1) return c;
        const msgs = c.messages.map((m, i) =>
          i === replyIdx - 1 && m.role === "user"
            ? { ...m, text, commandChip: undefined }
            : m,
        );
        return { ...c, messages: msgs, updatedAt: now() };
      });
      persistConvs(conversations);
      return { conversations, runtime };
    });
    return true;
  },

  send: async (text) => {
    get().enqueue(text);
  },

  tryGuidePrompt: async (text, tab = "chat") => {
    set({ tab });
    if (!get().agentReady()) await get().authorizeAgent();
    if (get().agentReady()) get().enqueue(text);
  },

  applySkill: async (entry) => {
    const targets = [
      { id: "claude", adapter: "claude-code" },
      { id: "codex", adapter: "codex" },
    ];
    set((s) => {
      const skillState = { ...s.skillState };
      for (const target of targets) skillState[skillKey(target.id, entry.id)] = "applying";
      return { skillState };
    });
    if (!get().clawctlSupportsSkill) {
      set((s) => {
        const skillState = { ...s.skillState };
        for (const target of targets) skillState[skillKey(target.id, entry.id)] = "failed";
        return { skillState };
      });
      return undefined;
    }
    let activeRef: SkillRef | undefined;
    let anyRef: SkillRef | undefined;
    const failures: string[] = [];
    for (const target of targets) {
      const key = skillKey(target.id, entry.id);
      try {
        const ref = await clawctlJson<SkillRef>([
          "skill",
          "check",
          ...selectorFlags(entry.selector),
          "--agent",
          target.adapter,
        ]);
        set((s) => ({
          skillState: {
            ...s.skillState,
            [key]: ref.found === true ? "installed" : "failed",
          },
        }));
        if (ref.found === true) {
          anyRef ??= ref;
          if (target.id === get().agentId) activeRef = ref;
        }
      } catch (error) {
        failures.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
        set((s) => ({ skillState: { ...s.skillState, [key]: "failed" } }));
      }
    }
    if (!activeRef && !anyRef && failures.length) {
      throw new Error(`Skill installation failed. ${failures.join(" · ")}`);
    }
    return activeRef ?? anyRef;
  },

  useSkillInChat: async (entry) => {
    if (!get().agentReady()) return;
    set({ tab: "chat" });
    const target =
      entry.selector.kind === "domain" ? entry.selector.value : entry.selector.value;
    const cid = get().activeConversation()?.id ?? get().newChat();

    const ref = await get().applySkill(entry);
    if (!get().agentReady()) return;
    const stepId = get().makeStepMessage(cid);
    const prep = await prepareSession({
      host: selectorTargetHost(entry.selector),
      selectedProfile: get().selectedProfile,
      statuses: get().statuses,
      defaultSession: get().defaultSession,
      onStep: (step) => get().appendStep(cid, stepId, step),
    });

    const md = await installedSkillMarkdown(ref);

    const chip: UserCommandChip = { kind: "skill", title: entry.title, detail: target };
    const prompt = skillAgentPrompt(
      entry.title,
      target,
      md,
      ref?.slug ?? ref?.title,
      prep.host,
    );
    get().enqueue(prompt, chip, cid);
    await get().loadDefaultSession();
  },

  runScript: async (entry, host = "") => {
    const onHost = host.trim();
    if (entry.js) {
      set({ tab: "chat" });
      const cid = get().activeConversation()?.id ?? get().newChat();
      const detail = onHost || get().currentSessionDisplayName();
      const userMsg: ChatMessage = {
        id: uid(),
        role: "user",
        text: entry.title,
        status: "done",
        createdAt: now(),
        commandChip: { kind: "script", title: entry.title, detail },
      };
      set((s) => {
        const conversations = s.conversations.map((conversation) =>
          conversation.id === cid
            ? {
                ...conversation,
                messages: [...conversation.messages, userMsg],
                updatedAt: now(),
              }
            : conversation,
        );
        persistConvs(conversations);
        return { conversations };
      });
      const stepId = get().makeStepMessage(cid);
      const prep = await prepareSession({
        host: onHost || undefined,
        selectedProfile: get().selectedProfile,
        statuses: get().statuses,
        defaultSession: get().defaultSession,
        onStep: (step) => get().appendStep(cid, stepId, step),
      });
      try {
        const { env, res } = await clawctlEnvelope<unknown>([
          ...prep.profileArgs,
          "eval",
          entry.js,
        ]);
        let result: string;
        if (res.code === 0 && env.ok !== false) {
          get().appendStep(cid, stepId, "Done");
          const on = prep.host ?? get().currentSessionDisplayName();
          result = `✓ Ran "${entry.title}" on ${on}.`;
        } else {
          result = `Couldn't run "${entry.title}": ${clawctlErrorMessage(res)}`;
        }
        const resultMsg: ChatMessage = {
          id: uid(),
          role: "system",
          text: result,
          status: "done",
          createdAt: now(),
        };
        set((s) => {
          const conversations = s.conversations.map((c) =>
            c.id === cid ? { ...c, messages: [...c.messages, resultMsg], updatedAt: now() } : c,
          );
          persistConvs(conversations);
          return { conversations };
        });
      } catch (e) {
        const errMsg: ChatMessage = {
          id: uid(),
          role: "system",
          text: `Couldn't run "${entry.title}": ${e}`,
          status: "done",
          createdAt: now(),
        };
        set((s) => {
          const conversations = s.conversations.map((c) =>
            c.id === cid ? { ...c, messages: [...c.messages, errMsg], updatedAt: now() } : c,
          );
          persistConvs(conversations);
          return { conversations };
        });
      }
      await get().loadDefaultSession();
      return;
    }

    if (!get().agentReady()) return;
    const ref = await get().applySkill(entry);
    if (!get().agentReady()) return;
    set({ tab: "chat" });
    const cid = get().activeConversation()?.id ?? get().newChat();
    const stepId = get().makeStepMessage(cid);
    const prep = await prepareSession({
      host: onHost || undefined,
      selectedProfile: get().selectedProfile,
      statuses: get().statuses,
      defaultSession: get().defaultSession,
      onStep: (step) => get().appendStep(cid, stepId, step),
    });
    const where = onHost
      ? `on ${onHost}`
      : `in the active NextBrowser session (${get().currentSessionDisplayName()})`;
    const md = await installedSkillMarkdown(ref);
    const prompt = scriptAgentPrompt(
      entry.title,
      where,
      md,
      ref?.slug ?? ref?.title,
      prep.host,
    );
    get().enqueue(
      prompt,
      {
        kind: "script",
        title: entry.title,
        detail: onHost || get().currentSessionDisplayName(),
      },
      cid,
    );
    await get().loadDefaultSession();
  },

  addScheduledRun: (partial) => {
    const run: ScheduledRun = {
      id: uid(),
      title: partial.title,
      prompt: partial.prompt,
      agent: get().agentId,
      hour: partial.hour,
      minute: partial.minute,
      weekdays: partial.weekdays.length ? partial.weekdays : [2, 3, 4, 5, 6],
      enabled: true,
      conversationId: partial.conversationId,
    };
    const scheduledRuns = [...get().scheduledRuns, run];
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
  },

  updateScheduledRun: (id, patch) => {
    const scheduledRuns = get().scheduledRuns.map((r) =>
      r.id === id ? { ...r, ...patch, lastFiredAt: undefined } : r,
    );
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
  },

  deleteScheduledRun: (id) => {
    const scheduledRuns = get().scheduledRuns.filter((r) => r.id !== id);
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
  },

  setScheduledRunEnabled: (id, enabled) => {
    const scheduledRuns = get().scheduledRuns.map((r) =>
      r.id === id ? { ...r, enabled } : r,
    );
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
  },

  scheduledRunChatTitle: (run) => {
    if (!run.conversationId) return undefined;
    return get().conversations.find((c) => c.id === run.conversationId)?.title;
  },

  saveCustomScript: async (script) => {
    const existing = get().customScripts.find((s) => s.id === script.id);
    const updated: CustomScript = {
      ...script,
      updatedAt: now(),
      createdAt: existing?.createdAt ?? now(),
    };
    const scripts = existing
      ? get().customScripts.map((s) => (s.id === script.id ? updated : s))
      : [...get().customScripts, updated];
    persistScripts(scripts);
    set({ customScripts: scripts, scriptSync: { ...get().scriptSync, [script.id]: "syncing" } });
    let tempPath: string | undefined;
    try {
      const slug = customPrivateSlug(updated);
      const selector = customPublishSelector(updated);
      const description = updated.domain
        ? `Private custom script for ${updated.domain} (not shared).`
        : "Private custom script (not shared).";
      const markdown = `---\nname: ${updated.title || "Custom script"}\ndescription: ${description}\n---\n\n${updated.instructions}`;
      tempPath = await invoke<string>("write_temp_skill", { slug, content: markdown });
      const { env, res } = await clawctlEnvelope<SkillRef>([
        "skill",
        "add",
        "--domain",
        selector,
        "--private",
        "--slug",
        slug,
        "--title",
        updated.title || slug,
        "--description",
        "Private custom script (not shared)",
        "--file",
        tempPath,
      ]);
      if (res.code !== 0 || env.ok === false) throw new Error(clawctlErrorMessage(res));
      const synced = {
        ...updated,
        serverSlug: env.data?.slug ?? slug,
        submittedAt: now(),
      };
      const final = scripts.map((s) => (s.id === script.id ? synced : s));
      persistScripts(final);
      set({
        customScripts: final,
        scriptSync: { ...get().scriptSync, [script.id]: "synced" },
      });
    } catch {
      set((s) => ({
        scriptSync: { ...s.scriptSync, [script.id]: "failed" },
      }));
    } finally {
      if (tempPath) void invoke("remove_temp_file", { path: tempPath });
    }
  },

  deleteCustomScript: (id) => {
    const customScripts = get().customScripts.filter((s) => s.id !== id);
    persistScripts(customScripts);
    set({ customScripts });
  },

  runCustomScript: async (script) => {
    if (!get().agentReady()) return;
    set({ tab: "chat" });
    const domain = script.domain.trim();
    const cid = get().activeConversation()?.id ?? get().newChat();
    const stepId = get().makeStepMessage(cid);
    const prep = await prepareSession({
      host: domain || undefined,
      selectedProfile: get().selectedProfile,
      statuses: get().statuses,
      defaultSession: get().defaultSession,
      onStep: (step) => get().appendStep(cid, stepId, step),
    });
    if (!get().agentReady()) return;
    const target = domain || `the active NextBrowser session (${get().currentSessionDisplayName()})`;
    const chip: UserCommandChip = {
      kind: "script",
      title: script.title,
      detail: domain || get().currentSessionDisplayName(),
    };
    const note = pageReadyNote(prep.host);
    const prompt = `Run my custom script "${script.title}" on ${target} in the active NextBrowser session.${note}\nFollow these steps exactly:\n\n${script.instructions}`;
    get().enqueue(prompt, chip, cid);
  },
}));

export { AGENTS, type AgentSpec };
