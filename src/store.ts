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
import { setAnalyticsUserId, trackEvent, trackScreenView, trackTiming } from "./lib/analytics";
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

export interface ManualProxyProfileInput {
  name: string;
  scheme: "http" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
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
const CLAWCTL_DAILY_UPDATE_MS = 24 * 60 * 60 * 1000;
const CLAWCTL_DAILY_UPDATE_POLL_MS = 60 * 60 * 1000;
const CLAWCTL_UPDATE_STATE_FILE = "clawctl-update.json";

function clawbrowserInstallPrompt(agentAdapter: string): string {
  return `NextBrowser cannot find local clawctl/Clawbrowser components. Install them for this machine before doing browser work.

Use the official clawctl release bootstrap, then install the browser runtime and this agent integration.

On macOS/Linux:

\`\`\`bash
case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) platform="linux-amd64" ;;
  Linux:arm64|Linux:aarch64) platform="linux-arm64" ;;
  Darwin:arm64) platform="macos-arm64" ;;
  *) echo "unsupported host: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
archive="clawctl-\${platform}.tar.gz"
url="https://github.com/clawbrowser/clawctl/releases/latest/download/\${archive}"
curl -fL --retry 3 --retry-delay 2 -o "$archive" "$url"
tar -xzf "$archive"
"./clawctl-\${platform}/clawctl" install --agent ${agentAdapter} --no-api-key-prompt --json
\`\`\`

On Windows PowerShell:

\`\`\`powershell
$archive = "clawctl-win-amd64.zip"
$url = "https://github.com/clawbrowser/clawctl/releases/latest/download/$archive"
Invoke-WebRequest -Uri $url -OutFile $archive
Remove-Item -Recurse -Force ".\\clawctl-win-amd64" -ErrorAction SilentlyContinue
Expand-Archive -Force $archive .
$clawctl = ".\\clawctl-win-amd64\\clawctl.exe"
& $clawctl install --agent ${agentAdapter} --no-api-key-prompt --json
\`\`\`

If Windows asks for administrator approval, tell the user exactly that approval is needed. After install, run \`clawctl version\` and report the installed path. Do not invent backend API calls.`;
}

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
  profileIdentities: Record<string, ProxyIdentity>;
  selectedProfile?: string;
  defaultSession?: SessionStatus;
  profileSearch: string;
  isRefreshing: boolean;
  agentId: string;
  runtime: Record<string, AgentRuntime>;
  conversations: Conversation[];
  activeConvId: Record<string, string>;
  tab: AppTab;
  skillState: Record<string, SkillApplyState | string>;
  scheduledRuns: ScheduledRun[];
  customScripts: CustomScript[];
  scriptSync: Record<string, ScriptSyncState>;
  usageHistory: UsageSnapshot[];
  showOnboarding: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  chatListCollapsed: boolean;
  dashboardKeyPromptOpen: boolean;
  clawctlVersion: string;
  clawctlUpdating: boolean;
  clawctlUpdateStatus?: string;
  clawctlSupportsSkill: boolean;
  clawctlAvailable: boolean;
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
  createManualProxyProfile: (input: ManualProxyProfileInput) => Promise<void>;
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
  setSidebarCollapsed: (v: boolean) => void;
  setChatListCollapsed: (v: boolean) => void;
  setDashboardKeyPromptOpen: (v: boolean) => void;
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
  skillApplyError: (entryId: string) => string | undefined;

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
  startRemoteStream: (profile?: string) => Promise<string>;

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
  tickClawctlDailyUpdate: () => Promise<void>;
  ensureConversation: (agentId: string) => void;
  announceConnect: (agentId: string, version: string, loggedIn: boolean | null) => void;
}

let proxyTimer: ReturnType<typeof setInterval> | null = null;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let sessionPollTimer: ReturnType<typeof setInterval> | null = null;
let clawctlDailyUpdateTimer: ReturnType<typeof setInterval> | null = null;
// Guard bootstrap against re-entry. React StrictMode invokes effects twice in
// dev, and without this each agent:* listener would be registered again, so a
// single agent reply would be appended once per registration (duplicate output).
// Mirrors AppState.didBootstrap in the Swift app.
let didBootstrap = false;
type AgentDone = { code: number; stderr: string };
interface ClawctlUpdateState { lastAutoCheckAt?: number }
interface APIKeyIdentity {
  valid: boolean;
  key_id?: string;
  owner_id?: string;
}
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

interface VerifyCheck {
  surface?: string;
  expected?: string;
  actual?: string;
  detail?: string;
}

export interface ProxyIdentity {
  ip?: string;
  country?: string;
  city?: string;
  label?: string;
}

function proxyIdentityFromVerify(checks?: VerifyCheck[], visibleText?: string): ProxyIdentity | undefined {
  const check = checks?.find((c) => {
    const surface = (c.surface ?? "").toLowerCase();
    return surface.includes("ip") || surface.includes("proxy");
  });
  const ip = visibleText?.match(/\bIP:\s*([0-9a-fA-F:.]+)/)?.[1];
  const countryFromText = visibleText?.match(/\bCountry:\s*([A-Za-z]{2})\b/)?.[1]?.toUpperCase();
  const actual = check?.actual?.trim();
  const expected = check?.expected?.trim();
  const countryFromActual = actual?.match(/^([A-Za-z]{2})(?:\s*\(([^)]+)\))?/) ?? undefined;
  const country = countryFromText ?? countryFromActual?.[1]?.toUpperCase() ?? expected?.toUpperCase();
  const city = countryFromActual?.[2];
  const label = actual || check?.detail || expected || undefined;
  if (!ip && !country && !city && !label) return undefined;
  return { ip, country, city, label };
}

async function verifyProxyIdentity(profile?: string): Promise<ProxyIdentity | undefined> {
  try {
    const args = [...(profile ? ["--profile", profile] : []), "verify", "--timeout", "15s"];
    const data = await clawctlJson<{ verify?: { checks?: VerifyCheck[]; visible_text?: string } }>(args);
    return proxyIdentityFromVerify(data.verify?.checks, data.verify?.visible_text);
  } catch {
    return undefined;
  }
}

async function refreshAnalyticsIdentity(): Promise<void> {
  const wrap = await clawctlJson<{ identity: APIKeyIdentity }>(["identity"]);
  const ownerId = wrap.identity.owner_id?.trim();
  setAnalyticsUserId(ownerId || undefined);
  trackEvent("analytics_identity_loaded", {
    has_owner_id: !!ownerId,
    has_key_id: !!wrap.identity.key_id,
  });
}

export const useStore = create<State>((set, get) => ({
  authed: false,
  checking: true,
  isLoggingIn: false,
  profiles: [],
  statuses: {},
  profileIdentities: {},
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
  sidebarCollapsed: localStorage.getItem("sidebarCollapsed") === "true",
  chatListCollapsed: localStorage.getItem("chatListCollapsed") === "true",
  dashboardKeyPromptOpen: false,
  clawctlVersion: "",
  clawctlUpdating: false,
  clawctlSupportsSkill: true,
  clawctlAvailable: true,
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
  skillApplyState: (entryId) => {
    const value = get().skillState[skillKey(get().agentId, entryId)];
    return value === "applying" || value === "installed" || value === "failed" ? value : "idle";
  },
  skillApplyError: (entryId) => get().skillState[skillKey(get().agentId, `${entryId}:error`)],

  bootstrap: async () => {
    if (didBootstrap) return;
    didBootstrap = true;
    const startedAt = performance.now();
    trackEvent("bootstrap_started");
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
      trackEvent(stopped ? "agent_turn_cancelled" : code === 0 ? "agent_turn_completed" : "agent_turn_failed", {
        agent: agentId,
        exit_code: code,
      });
      try {
        await get().refreshAll();
      } finally {
        const resolve = completionResolvers.get(replyId);
        completionResolvers.delete(replyId);
        resolve?.({ code, stderr });
      }
    });

    const clawctlPath = await invoke<string | null>("clawctl_resolve").catch(() => null);
    set({ clawctlAvailable: !!clawctlPath });
    trackEvent("clawctl_resolve", { found: !!clawctlPath });
    try {
      const ver = await invoke<string>("clawctl_version");
      const supportsSkill = await invoke<boolean>("clawctl_supports_skill");
      set({ clawctlVersion: normalizeClawctlVersion(ver), clawctlSupportsSkill: supportsSkill, clawctlAvailable: true });
      trackEvent("clawctl_detected", { supports_skill: supportsSkill });
      await refreshAnalyticsIdentity().catch(() => {
        trackEvent("analytics_identity_unavailable", { phase: "bootstrap" });
      });
    } catch {
      set({ clawctlVersion: "not found", clawctlSupportsSkill: false, clawctlAvailable: false });
      trackEvent("clawctl_missing");
    }
    set({ authed: true });
    get().startTimers();
    void get().tickClawctlDailyUpdate();

    try {
      await get().refreshAll();
      await get().authorizeAgent();
      if (!localStorage.getItem("onboardingComplete")) {
        set({ showOnboarding: true });
      }
      trackTiming("bootstrap_completed", startedAt, {
        clawctl_available: get().clawctlAvailable,
        profile_count: get().profiles.length,
        conversation_count: get().conversations.length,
      });
    } catch {
      /* app remains usable without dashboard credentials or local clawctl */
      trackTiming("bootstrap_completed", startedAt, {
        clawctl_available: get().clawctlAvailable,
        partial: true,
      });
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
    if (clawctlDailyUpdateTimer) clearInterval(clawctlDailyUpdateTimer);
    clawctlDailyUpdateTimer = setInterval(
      () => void get().tickClawctlDailyUpdate(),
      CLAWCTL_DAILY_UPDATE_POLL_MS,
    );
  },

  tickClawctlDailyUpdate: async () => {
    if (!get().clawctlAvailable) return;
    if (get().clawctlUpdating) return;
    const state = await loadJson<ClawctlUpdateState>(CLAWCTL_UPDATE_STATE_FILE, {});
    const lastAutoCheckAt = Number(state.lastAutoCheckAt ?? 0);
    if (lastAutoCheckAt > 0 && now() - lastAutoCheckAt < CLAWCTL_DAILY_UPDATE_MS) return;
    await saveJson(CLAWCTL_UPDATE_STATE_FILE, { lastAutoCheckAt: now() });
    await get().checkClawctlUpdate();
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
      trackEvent("scheduled_run_fired", {
        agent: run.agent,
        has_conversation: !!run.conversationId,
      });
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
    trackEvent("agent_turn_started", {
      agent: agentId,
      has_profile: !!get().selectedProfile,
      queue_depth: get().runtime[agentId]?.queue.length ?? 0,
    });
    get().startSessionPoll();

    const prompt = composePrompt(
      get().conversations,
      item.conversationId,
      item.replyId,
      item.rawText,
      get().selectedProfile,
      { clawctlAvailable: get().clawctlAvailable },
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
        if (stalled) trackEvent("agent_turn_stalled", { agent: agentId });
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
      trackEvent("agent_turn_spawn_failed", { agent: agentId });
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
    const startedAt = performance.now();
    const apiKey = key.trim();
    trackEvent("dashboard_key_save_started");
    if (!apiKey) {
      set({ loginError: "Enter your dashboard API key before signing in.", isLoggingIn: false });
      trackTiming("dashboard_key_save_failed", startedAt, { reason: "empty_key" });
      return;
    }
    set({ loginError: undefined, isLoggingIn: true });
    try {
      await clawctlRun(["config", "set", "--api-key", apiKey]);
      await refreshAnalyticsIdentity().catch(() => {
        trackEvent("analytics_identity_unavailable", { phase: "login" });
      });
      await get().loadProxy();
      set({ authed: true, clawctlAvailable: true });
      get().startTimers();
      await get().refreshAll();
      await get().authorizeAgent();
      if (!localStorage.getItem("onboardingComplete")) set({ showOnboarding: true });
      trackEvent("login", { method: "dashboard_key" });
      trackTiming("dashboard_key_save_succeeded", startedAt);
    } catch (e) {
      set({ loginError: String(e) });
      trackTiming("dashboard_key_save_failed", startedAt);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: () => {
    trackEvent("dashboard_logout");
    setAnalyticsUserId(undefined);
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
      profileIdentities: {},
      defaultSession: undefined,
      skillState: {},
      tab: "chat",
    });
  },

  refreshAll: async () => {
    const startedAt = performance.now();
    trackEvent("refresh_all_started");
    set({ isRefreshing: true });
    try {
      await get().loadProxy().catch(() => {});
      await get().loadProfiles();
      await get().loadDefaultSession();
      await get().loadSkillCatalog();
    } finally {
      set({ isRefreshing: false });
      trackTiming("refresh_all_completed", startedAt, {
        profile_count: get().profiles.length,
        has_proxy: !!get().proxy,
      });
    }
  },

  refreshProxyData: async () => {
    const startedAt = performance.now();
    trackEvent("proxy_refresh_started");
    set({ isRefreshing: true });
    try {
      await get().loadProxy();
      trackTiming("proxy_refresh_succeeded", startedAt, { proxy_state: get().proxy?.state ?? "unknown" });
    } catch {
      trackTiming("proxy_refresh_failed", startedAt);
    } finally {
      set({ isRefreshing: false });
    }
  },

  refreshSessions: async () => {
    const startedAt = performance.now();
    trackEvent("sessions_refresh_started");
    set({ isRefreshing: true });
    try {
      await get().loadProfiles();
      await get().loadDefaultSession();
    } finally {
      set({ isRefreshing: false });
      trackTiming("sessions_refresh_completed", startedAt, { profile_count: get().profiles.length });
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
    trackEvent("proxy_loaded", {
      proxy_state: p.state,
      limited: p.limited,
      percent_used_bucket: p.percent_used == null ? "unknown" : Math.min(100, Math.floor(p.percent_used / 10) * 10),
      has_limit: p.limit_bytes != null,
      warning: proxyWarning != null,
    });
  },

  loadProfiles: async () => {
    try {
      const list = await clawctlJson<{ profiles: Profile[] }>(["profiles", "ls"]);
      set({ profiles: list.profiles });
      trackEvent("profiles_loaded", {
        profile_count: list.profiles.length,
        country_count: new Set(list.profiles.map((p) => p.country).filter(Boolean)).size,
      });
      for (const p of list.profiles) {
        try {
          const st = await clawctlJson<SessionStatus>(["status", "--profile", p.name]);
          set((s) => ({ statuses: { ...s.statuses, [p.name]: st.status } }));
          if (st.status === "running") {
            const identity = await verifyProxyIdentity(p.name);
            if (identity) set((s) => ({ profileIdentities: { ...s.profileIdentities, [p.name]: identity } }));
          }
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
      if (st.status === "running") {
        const identity = await verifyProxyIdentity();
        if (identity) set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: identity } }));
      }
      trackEvent("default_session_loaded", { session_status: st.status, backend: st.backend ?? "unknown" });
    } catch {
      set({ defaultSession: undefined });
      trackEvent("default_session_unavailable");
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
      trackEvent("skill_catalog_loaded", {
        category_count: catalog.categories.length,
        skill_count: catalog.categories.reduce((total, category) => total + category.skills.length, 0),
      });
    } catch {
      set({ skillCategories: [] });
      trackEvent("skill_catalog_failed");
    }
  },

  startDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("session_create_requested", { scope: "default" });
    trackEvent("session_start_requested", { scope: "default" });
    await clawctlRun(["start", "--format", "json"]);
    await get().loadDefaultSession();
    const identity = await verifyProxyIdentity();
    if (identity) set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: identity } }));
    await get().loadProfiles();
    trackTiming("session_create_completed", startedAt, { scope: "default", session_status: get().defaultSession?.status ?? "unknown" });
    trackTiming("session_start_completed", startedAt, { scope: "default", session_status: get().defaultSession?.status ?? "unknown" });
  },

  stopDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("session_stop_requested", { scope: "default" });
    await clawctlRun(["stop", "--format", "json"]);
    await get().loadDefaultSession();
    trackTiming("session_stop_completed", startedAt, { scope: "default", session_status: get().defaultSession?.status ?? "unknown" });
  },

  rotateDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("proxy_ip_change_requested", { scope: "default_session" });
    trackEvent("session_rotate_requested", { scope: "default" });
    await clawctlRun(["rotate", "--format", "json"]);
    await get().loadDefaultSession();
    await get().loadProxy().catch(() => {});
    const after = await verifyProxyIdentity();
    if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: after } }));
    trackTiming("proxy_ip_change_completed", startedAt, { scope: "default_session" });
    trackTiming("session_rotate_completed", startedAt, { scope: "default" });
  },

  rotateDefaultSessionCountry: async (country) => {
    const startedAt = performance.now();
    trackEvent("proxy_country_change_requested", { scope: "default_session", country });
    trackEvent("session_rotate_requested", { scope: "default", country });
    await clawctlRun(["rotate", "--country", country, "--verify", "--format", "json"]);
    await get().loadDefaultSession();
    await get().loadProxy().catch(() => {});
    const after = await verifyProxyIdentity();
    const identity = after ?? { country };
    set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: identity } }));
    trackTiming("proxy_country_change_completed", startedAt, { scope: "default_session", country });
    trackTiming("session_rotate_completed", startedAt, { scope: "default", country });
  },

  startProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("profile_session_create_requested", { scope: "profile" });
    trackEvent("profile_start_requested");
    set((s) => ({ statuses: { ...s.statuses, [n]: "starting" } }));
    await clawctlRun(["start", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
    const identity = await verifyProxyIdentity(n);
    if (identity) set((s) => ({ profileIdentities: { ...s.profileIdentities, [n]: identity } }));
    trackTiming("profile_session_create_completed", startedAt, { status: get().statuses[n] ?? "unknown" });
    trackTiming("profile_start_completed", startedAt, { status: get().statuses[n] ?? "unknown" });
  },

  stopProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("profile_stop_requested");
    set((s) => ({ statuses: { ...s.statuses, [n]: "stopping" } }));
    await clawctlRun(["stop", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
    trackTiming("profile_stop_completed", startedAt, { status: get().statuses[n] ?? "unknown" });
  },

  rotateProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("proxy_ip_change_requested", { scope: "profile" });
    trackEvent("profile_rotate_requested");
    set((s) => ({ statuses: { ...s.statuses, [n]: "rotating" } }));
    await clawctlRun(["rotate", "--profile", n, "--format", "json"]);
    await get().loadProfiles();
    await get().loadProxy().catch(() => {});
    const after = await verifyProxyIdentity(n);
    if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, [n]: after } }));
    trackTiming("proxy_ip_change_completed", startedAt, { scope: "profile", status: get().statuses[n] ?? "unknown" });
    trackTiming("profile_rotate_completed", startedAt, { status: get().statuses[n] ?? "unknown" });
  },

  rotateProfileCountry: async (n, country) => {
    const startedAt = performance.now();
    trackEvent("proxy_country_change_requested", { scope: "profile", country });
    trackEvent("profile_rotate_requested", { country });
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
    const after = await verifyProxyIdentity(n);
    if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, [n]: after } }));
    trackTiming("proxy_country_change_completed", startedAt, { scope: "profile", country, status: get().statuses[n] ?? "unknown" });
    trackTiming("profile_rotate_completed", startedAt, { country, status: get().statuses[n] ?? "unknown" });
  },

  createManualProxyProfile: async (input) => {
    const startedAt = performance.now();
    const name = input.name.trim();
    const host = input.host.trim();
    const username = input.username?.trim() ?? "";
    trackEvent("profile_manual_proxy_create_requested", {
      scheme: input.scheme,
      has_username: username.length > 0,
    });
    const result = await clawctlRun(
      [
        "profiles",
        "create",
        name,
        "--manual-proxy",
        "--proxy-scheme",
        input.scheme,
        "--proxy-host",
        host,
        "--proxy-port",
        String(input.port),
        ...(username ? ["--proxy-username", username] : []),
        "--format",
        "json",
      ],
      input.password ? { CLAWCTL_PROXY_PASSWORD: input.password } : undefined,
    );
    if (result.code !== 0) throw new Error(clawctlErrorMessage(result));
    await get().loadProfiles();
    trackTiming("profile_manual_proxy_create_completed", startedAt, {
      profile_count: get().profiles.length,
    });
  },

  deleteProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("profile_session_delete_requested", { was_running: get().statuses[n] === "running" });
    trackEvent("profile_delete_requested", { was_running: get().statuses[n] === "running" });
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
    trackTiming("profile_session_delete_completed", startedAt);
    trackTiming("profile_delete_completed", startedAt);
  },

  selectProfile: (n) => {
    trackEvent("profile_selected", { selected: !!n });
    set({ selectedProfile: n });
  },

  switchAgent: (id) => {
    if (id === get().agentId) return;
    trackEvent("agent_switched", { from_agent: get().agentId, to_agent: id });
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
    const startedAt = performance.now();
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
    trackEvent("agent_connect_started", { agent: agentId });
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
      trackTiming("agent_connect_succeeded", startedAt, {
        agent: agentId,
        logged_in: loggedIn === true,
        clawctl_available: get().clawctlAvailable,
      });
      get().reconcileQueues();
      get().startConsumer(agentId);
      const adapter = clawctlAgentAdapter(agentId);
      if (!get().clawctlAvailable) {
        const conv = get().activeConversation();
        const alreadyQueued = conv?.messages.some((message) =>
          message.text.includes("NextBrowser cannot find local clawctl/Clawbrowser components"),
        );
        if (!alreadyQueued) get().enqueue(clawbrowserInstallPrompt(adapter));
        trackEvent("install_prompt_sent", { agent: agentId, adapter });
        return;
      }
      // Installation is idempotent. Keep connection fast and refresh the
      // agent's bundled clawctl skill/integration in the background.
      void clawctlRun(["install", "--agent", adapter, "--no-api-key-prompt"]).then((result) => {
        if (result.code !== 0) {
          console.warn(`Could not install clawctl skill for ${adapter}: ${clawctlErrorMessage(result)}`);
        }
      }).catch((error) => console.warn(`Could not install clawctl skill for ${adapter}:`, error));
    } catch (e) {
      trackTiming("agent_connect_failed", startedAt, { agent: agentId });
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
    trackEvent("agent_login_started", { agent: agentId });
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
          trackEvent("agent_login_succeeded", { agent: agentId });
          return;
        }
      }
      trackEvent("agent_login_timeout", { agent: agentId });
    } catch (e) {
      trackEvent("agent_login_failed", { agent: agentId });
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
    trackEvent("agent_logout_started", { agent: agentId });
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
          trackEvent("agent_logout_succeeded", { agent: agentId, login_state: loggedIn === false ? "logged_out" : "unknown" });
          return;
        }
      }
      trackEvent("agent_logout_timeout", { agent: agentId });
    } catch (e) {
      trackEvent("agent_logout_failed", { agent: agentId });
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

  setTab: (t) => {
    const previousTab = get().tab;
    if (previousTab === t) return;
    trackEvent("tab_opened", { tab: t, previous_tab: previousTab });
    trackScreenView(t, { source: "tab_opened", previous_tab: previousTab });
    set({ tab: t });
  },
  setAppActive: (v) => set({ appActive: v }),
  setProfileSearch: (q) => set({ profileSearch: q }),
  setSidebarWidth: (w) => {
    localStorage.setItem("sidebarWidth", String(w));
    set({ sidebarWidth: w });
  },
  setSidebarCollapsed: (v) => {
    localStorage.setItem("sidebarCollapsed", String(v));
    set({ sidebarCollapsed: v });
  },
  setChatListCollapsed: (v) => {
    localStorage.setItem("chatListCollapsed", String(v));
    set({ chatListCollapsed: v });
  },
  setDashboardKeyPromptOpen: (v) => {
    trackEvent(v ? "dashboard_key_prompt_opened" : "dashboard_key_prompt_closed");
    set({ dashboardKeyPromptOpen: v, loginError: v ? undefined : get().loginError });
  },
  finishOnboarding: () => {
    localStorage.setItem("onboardingComplete", "true");
    set({ showOnboarding: false });
  },
  showOnboardingAgain: () => set({ showOnboarding: true }),

  checkClawctlUpdate: async () => {
    const startedAt = performance.now();
    trackEvent("clawctl_update_started");
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
        trackEvent("clawctl_update_available", { updated: true });
      } else if (res.code === 0) {
        // Already current — keep the footer on one line; show nothing.
        set({ clawctlUpdateStatus: undefined });
        trackEvent("clawctl_update_not_available");
      } else {
        set({ clawctlUpdateStatus: "update failed" });
        trackEvent("clawctl_update_failed", { exit_code: res.code });
      }
      const ver = await invoke<string>("clawctl_version");
      const supportsSkill = await invoke<boolean>("clawctl_supports_skill");
      set({ clawctlVersion: normalizeClawctlVersion(ver), clawctlSupportsSkill: supportsSkill, clawctlAvailable: true });
      trackTiming("clawctl_update_completed", startedAt, { supports_skill: supportsSkill });
    } catch {
      set({ clawctlUpdateStatus: "update failed", clawctlAvailable: false });
      trackTiming("clawctl_update_failed", startedAt);
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
    trackEvent("chat_created", { agent: agentId, conversation_count: conversations.length });
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
    trackEvent("chat_created", { agent: agentId, named: true, conversation_count: conversations.length });
    return c.id;
  },

  selectConversation: (id) => {
    const agentId = get().agentId;
    trackEvent("chat_selected", { agent: agentId });
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
      trackEvent("chat_renamed", { agent: get().agentId });
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
    trackEvent("chat_deleted", { agent: agentId, conversation_count: conversations.length });
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
    trackEvent("chat_forked", { agent: conv.agent, message_count: messages.length, partial: !!atMessageId });
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
      trackEvent("chat_cleared", { agent: get().agentId });
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
    trackEvent("chat_message_queued", {
      agent: agentId,
      has_chip: !!chip,
      chip_kind: chip?.kind ?? "none",
      attachment_count: attachments.length,
      prompt_length_bucket: Math.min(5000, Math.ceil(prompt.length / 250) * 250),
    });
    trackEvent("chat_request_submitted", {
      agent: agentId,
      has_chip: !!chip,
      chip_kind: chip?.kind ?? "none",
      attachment_count: attachments.length,
      prompt_length_bucket: Math.min(5000, Math.ceil(prompt.length / 250) * 250),
    });
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
    trackEvent("agent_turn_stop_requested", { agent: agentId });
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
    trackEvent("queued_reply_cancelled", { agent: agentId });
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
    trackEvent("queued_reply_edited", { agent: agentId });
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
    trackEvent("guide_prompt_used", { tab });
    set({ tab });
    if (!get().agentReady()) await get().authorizeAgent();
    if (get().agentReady()) get().enqueue(text);
  },

  applySkill: async (entry) => {
    const startedAt = performance.now();
    trackEvent("skill_apply_started", {
      category: entry.category,
      selector_kind: entry.selector.kind,
    });
    const targets = AGENTS.map((agent) => ({
      id: agent.id,
      adapter: clawctlAgentAdapter(agent.id),
    }));
    set((s) => {
      const skillState = { ...s.skillState };
      for (const target of targets) skillState[skillKey(target.id, entry.id)] = "applying";
      delete skillState[skillKey(get().agentId, `${entry.id}:error`)];
      return { skillState };
    });
    if (!get().clawctlSupportsSkill) {
      set((s) => {
        const skillState = { ...s.skillState };
        for (const target of targets) skillState[skillKey(target.id, entry.id)] = "failed";
        return { skillState };
      });
      trackTiming("skill_apply_failed", startedAt, {
        category: entry.category,
        reason: "unsupported_clawctl",
      });
      set((s) => ({
        skillState: {
          ...s.skillState,
          [skillKey(get().agentId, `${entry.id}:error`)]: "Resolved clawctl does not support the `skill` command. Update clawctl or set CLAWCTL_BIN to a newer build.",
        },
      }));
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
      const message = `Skill installation failed. ${failures.join(" · ")}`;
      set((s) => ({
        skillState: {
          ...s.skillState,
          [skillKey(get().agentId, `${entry.id}:error`)]: message,
        },
      }));
      trackTiming("skill_apply_failed", startedAt, {
        category: entry.category,
        selector_kind: entry.selector.kind,
      });
      throw new Error(message);
    }
    trackTiming("skill_apply_completed", startedAt, {
      category: entry.category,
      selector_kind: entry.selector.kind,
      installed: !!(activeRef ?? anyRef),
    });
    return activeRef ?? anyRef;
  },

  useSkillInChat: async (entry) => {
    if (!get().agentReady()) return;
    trackEvent("skill_usage_requested", {
      category: entry.category,
      selector_kind: entry.selector.kind,
    });
    trackEvent("skill_used_in_chat", {
      category: entry.category,
      selector_kind: entry.selector.kind,
    });
    set({ tab: "chat" });
    const target =
      entry.selector.kind === "domain" ? entry.selector.value : entry.selector.value;
    const cid = get().activeConversation()?.id ?? get().newChat();

    let ref: SkillRef | undefined;
    try {
      ref = await get().applySkill(entry);
    } catch (error) {
      const cidForError = get().activeConversation()?.id ?? get().newChat();
      const message = error instanceof Error ? error.message : String(error);
      const errMsg: ChatMessage = {
        id: uid(),
        role: "system",
        text: `Apply failed for "${entry.title}": ${message}`,
        status: "done",
        createdAt: now(),
      };
      set((s) => {
        const conversations = s.conversations.map((c) =>
          c.id === cidForError ? { ...c, messages: [...c.messages, errMsg], updatedAt: now() } : c,
        );
        persistConvs(conversations);
        return { conversations };
      });
      return;
    }
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
    trackEvent("script_usage_requested", {
      script_type: entry.js ? "local_eval" : "agent_skill",
      has_host: !!onHost,
      category: entry.category,
    });
    trackEvent("script_run_started", {
      script_type: entry.js ? "local_eval" : "agent_skill",
      has_host: !!onHost,
      category: entry.category,
    });
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
          trackEvent("script_run_completed", { script_type: "local_eval", has_host: !!onHost });
        } else {
          result = `Couldn't run "${entry.title}": ${clawctlErrorMessage(res)}`;
          trackEvent("script_run_failed", { script_type: "local_eval", exit_code: res.code });
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
        trackEvent("script_run_failed", { script_type: "local_eval" });
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
    let ref: SkillRef | undefined;
    try {
      ref = await get().applySkill(entry);
    } catch (error) {
      set({ tab: "chat" });
      const cid = get().activeConversation()?.id ?? get().newChat();
      const message = error instanceof Error ? error.message : String(error);
      const errMsg: ChatMessage = {
        id: uid(),
        role: "system",
        text: `Apply failed for "${entry.title}": ${message}`,
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
      return;
    }
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
    trackEvent("script_run_queued", { script_type: "agent_skill", has_host: !!onHost });
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
    trackEvent("scheduled_run_created", {
      agent: run.agent,
      weekday_count: run.weekdays.length,
      has_conversation: !!run.conversationId,
      scheduled_count: scheduledRuns.length,
    });
  },

  updateScheduledRun: (id, patch) => {
    const scheduledRuns = get().scheduledRuns.map((r) =>
      r.id === id ? { ...r, ...patch, lastFiredAt: undefined } : r,
    );
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
    trackEvent("scheduled_run_updated", {
      enabled_changed: patch.enabled != null,
      time_changed: patch.hour != null || patch.minute != null,
      weekday_changed: patch.weekdays != null,
    });
  },

  deleteScheduledRun: (id) => {
    const scheduledRuns = get().scheduledRuns.filter((r) => r.id !== id);
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
    trackEvent("scheduled_run_deleted", { scheduled_count: scheduledRuns.length });
  },

  setScheduledRunEnabled: (id, enabled) => {
    const scheduledRuns = get().scheduledRuns.map((r) =>
      r.id === id ? { ...r, enabled } : r,
    );
    persistSchedules(scheduledRuns);
    set({ scheduledRuns });
    trackEvent("scheduled_run_toggled", { enabled });
  },

  scheduledRunChatTitle: (run) => {
    if (!run.conversationId) return undefined;
    return get().conversations.find((c) => c.id === run.conversationId)?.title;
  },

  saveCustomScript: async (script) => {
    const existing = get().customScripts.find((s) => s.id === script.id);
    const startedAt = performance.now();
    trackEvent("custom_script_save_started", {
      existing: !!existing,
      has_domain: !!script.domain.trim(),
    });
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
      trackTiming("custom_script_save_completed", startedAt, {
        existing: !!existing,
        has_domain: !!script.domain.trim(),
      });
    } catch {
      set((s) => ({
        scriptSync: { ...s.scriptSync, [script.id]: "failed" },
      }));
      trackTiming("custom_script_save_failed", startedAt, {
        existing: !!existing,
        has_domain: !!script.domain.trim(),
      });
    } finally {
      if (tempPath) void invoke("remove_temp_file", { path: tempPath });
    }
  },

  deleteCustomScript: (id) => {
    const customScripts = get().customScripts.filter((s) => s.id !== id);
    persistScripts(customScripts);
    set({ customScripts });
    trackEvent("custom_script_deleted", { script_count: customScripts.length });
  },

  runCustomScript: async (script) => {
    if (!get().agentReady()) return;
    trackEvent("custom_script_run_requested", {
      has_domain: !!script.domain.trim(),
      has_server_slug: !!script.serverSlug,
    });
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

  startRemoteStream: async (profile) => {
    const args = ["remote", ...(profile ? ["--profile", profile] : [])];
    const res = await clawctlRun([...args, "--format", "json"]);
    if (res.code !== 0) throw new Error(clawctlErrorMessage(res));
    let result: { dashboard_url?: string; data?: { dashboard_url?: string } };
    try {
      result = JSON.parse(res.stdout);
    } catch {
      throw new Error(clawctlErrorMessage(res));
    }
    if (result.data?.dashboard_url) result = result.data;
    if (!result.dashboard_url) throw new Error("clawctl remote did not return a dashboard URL.");
    return result.dashboard_url;
  },
}));

export { AGENTS, type AgentSpec };
