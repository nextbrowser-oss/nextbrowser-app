import { create } from "zustand";
import { invoke, listen } from "./electronBridge";
import {
  nextctlEnvelope as rawNextctlEnvelope,
  nextctlErrorMessage,
  nextctlJson as rawNextctlJson,
  nextctlRun as rawNextctlRun,
  type NextctlRunOptions,
  type RunResult,
} from "./nextctl";
import { prepareSession, type VerificationFailureChoice, tidyEngineTabs } from "./preflight";
import {
  AGENTS,
  agentById,
  agentInvocation,
  missingAgentInstallError,
  nextctlAgentAdapter,
  type AgentSpec,
} from "./agents";
import {
  type SkillEntry,
  type SkillCategory,
  type SkillWatchlistTransport,
  fillTemplate,
  readPath,
  resolveWatchlistTransport,
  selectorFlags,
  selectorTargetHost,
  signInIsForDevice,
} from "./skillsCatalog";
import { REPOSITORY_SKILL_CATEGORIES, mergeSkillCategories } from "./repositorySkills";
import { cliBrowser } from "./lib/xreply/browser";
import { openNotifications, readPublisher, runPass, subscribeHandle } from "./lib/xreply/engine";
import { errorText as xReplyErrorText, setXReplyLogSink, xlog } from "./lib/xreply/log";
import { emptyXReplyState, normalizeXReplyState, type XReplyState } from "./lib/xreply/state";
import { activityFromText, extractToolEvents } from "./lib/activityParser";
import { composePrompt } from "./lib/composePrompt";
import { executionTargetForTurn, type ExecutionTarget } from "./lib/executionTarget";
import { shouldApplyRemoteConversation } from "./lib/conversationSync";
import { hasVPSPromptMarker, vpsConnectionInstructions } from "./lib/vpsPrompt";
import { promptWithAttachments } from "./lib/chatAttachments";
import { normalizeNextctlVersion } from "./lib/version";
import { isProxyTrafficExhaustedError, proxyTrafficWarning } from "./lib/proxyTraffic";
import { trafficGateState } from "./lib/trafficGate";
import { activeAutomationRecording, clearActiveAutomationRecording } from "./lib/automationRecording";
import { clearActiveAutomationExecution } from "./lib/automationExecution";
import { setAnalyticsUserId, trackEvent, trackScreenView, trackTiming } from "./lib/analytics";
import { internalError } from "./lib/userFacingError";
import { agentEmptyReplyMessage } from "./lib/agentRunResult";
import { userFacingBrowserError } from "./lib/userFacingBrowserError";
import {
  hasCompletedCurrentOnboarding,
  saveOnboardingCompletion,
} from "./lib/onboarding";
import type { RemoteStreamInfo } from "./remoteControl";
import { appendAppData, loadJson, saveJson } from "./lib/storage";
import { apiBaseUrl } from "./constants";
import { accountLoginURL } from "./lib/accountAuth";
import { requiresWorkspaceSetup } from "./lib/workspaceSetup";
import { publicScriptJavaScript } from "./lib/scriptCommands";
import { validateEntityName } from "./lib/entityValidation";
import { moveProfileToWorkspace as moveProfileBetweenWorkspaces } from "./lib/workspaceProfiles";
import { isProjectRevisionConflict, isWorkspaceNotFound, isWorkspaceRevisionConflict, mergeWorkspaceAfterRevisionConflict } from "./lib/workspaceConflict";
import {
  normalizeConversation,
  normalizeWorkflowSkill,
  normalizeSchedule,
  normalizeScript,
  normalizeUsage,
  serializeConversations,
  serializeWorkflowSkills,
  serializeSchedules,
  serializeScripts,
  serializeUsage,
} from "./lib/persistence";
import { scheduleDue } from "./lib/scheduleDue";
import { resolveScheduledProfile } from "./lib/scheduleProfile";
import type {
  AppTab,
  AutomationRecipeResult,
  BrowserWorkflowSkill,
  ChatAttachment,
  ChatMessage,
  Conversation,
  CustomScript,
  Profile,
  ProfileCreateRequest,
  PersonalProxy,
  ProxyTraffic,
  ScheduledRun,
  ScriptSyncState,
  SessionStatus,
  SkillApplyState,
  SkillRef,
  UserCommandChip,
  UsageSnapshot,
  WatchedProfile,
  WatchedProfileReport,
  WatchedPublisher,
  WatchlistRun,
  Workspace,
} from "./types";
import {
  DEFAULT_WATCHLIST_INTERVAL_MINUTES,
  clampWatchlistInterval,
  normalizeWatchHandle,
  parseWatchState,
  sameWatchHandle,
} from "./types";
import type { RotationCountry } from "./lib/countryFlag";
import type { GitHubStarStatus } from "./lib/githubStarReward";
import { browserProfileContext } from "./lib/browserProfileContext";
import { CONNECTOR_PROMPT_RESUMED_EVENT, type ConnectorPrompt } from "./connectorsCatalog";
import { clearMultiloginSelection, multiloginSelectionForWorkspace, type MultiloginProfileSelection } from "./lib/multiloginSelection";
import { cloudPhoneFromSelection, cloudPhoneSkillPrompt } from "./lib/cloudPhoneSkill";
import { isMultiloginStartRequest, multiloginStartReply } from "./lib/multiloginChatCommand";
import { multiloginSessionName, nextctlRemoteArgs, type LiveStreamTarget } from "./lib/liveStreamTarget";
import { customPrivateSlug, customPublishSelector } from "./types";

interface QueuedItem {
  conversationId: string;
  rawText: string;
  replyId: string;
  executionTarget: ExecutionTarget;
  selectedProfile?: string;
}

/// How a skill run is placed. A loop tick supplies its own conversation and
/// stays in the background, so a pass that fires while the user is reading
/// something else does not drag the window to another chat.
export interface SkillRunOptions {
  conversationId?: string;
  background?: boolean;
}

type BrowserToolset = "clawbrowser" | "dasbrowser" | "camoufox";

function runtimeForProfile(workspaces: Workspace[], profileName: string): BrowserToolset {
  for (const workspace of workspaces) {
    if (workspace.profileNames.includes(profileName)) {
      return workspace.profileToolsets[profileName] ?? "clawbrowser";
    }
  }
  return "clawbrowser";
}

function privateSkillContext(skills: BrowserWorkflowSkill[], text: string): string {
  const lower = text.toLowerCase();
  const intent = /\b(post|publish|comment|reply|send)\b|опубли|отправ|коммент/i.test(text) ? "posting"
    : /\b(find|search)\b|найди|поиск/i.test(text) ? "search"
      : /\b(scrape|extract|parse)\b|скрейп|парс/i.test(text) ? "scrape"
        : /\b(fill|upload|form)\b|заполни|загруз/i.test(text) ? "form" : "other";
  const match = skills
    .filter((skill) => skill.domain && lower.includes(skill.domain.toLowerCase()))
    .sort((a, b) => Number(b.capability === intent) - Number(a.capability === intent) || b.updatedAt - a.updatedAt)[0];
  if (!match || (match.capability !== intent && intent !== "other")) return "";
  return `\n\nA private skill owned by this user matches the domain and intent. Execute its structured recipe first; fall back to its prose workflow only if the page changed. Do not repeat start/prepare because Nextbrowser owns session setup.\nPrivate skill: ${match.title}\nRecipe: ${JSON.stringify(match.recipe)}\nFallback: ${match.instructions}`;
}

export interface ManualProxyProfileInput {
  name: string;
  scheme: "http" | "socks5";
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ManualProxyBatchSaveResult {
  saved: Array<{ index: number; proxy: PersonalProxy }>;
  failed: Array<{ index: number; message: string }>;
}

export interface PersonalProxyTestResult {
  ok: true;
  ip?: string;
  latencyMs: number;
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

interface AgentAuthorizationOptions {
  suggestInstalledAlternative?: boolean;
  skipNextctlSetup?: boolean;
  deferMissingNextctlPrompt?: boolean;
}

interface PairingStartResponse {
  pairing_id: string;
  pairing_code: string;
  verification_url: string;
  status: string;
  expires_at: string;
  poll_after_ms: number;
  poll_token: string;
}

interface PairingPollResponse {
  pairing_id: string;
  kind: "browser" | "agent";
  status: "pending" | "approved" | "rejected" | "expired" | "completed";
  expires_at: string;
  poll_after_ms: number;
  api_key?: string;
}

interface AccountPairingState {
  pairingId: string;
  verificationUrl: string;
  pollToken: string;
  status: PairingPollResponse["status"];
  expiresAt: string;
}

interface AuthDeepLinkPayload {
  pairingId?: string;
  status?: string;
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
const PROFILE_STATUS_REFRESH_MS = 15_000;
const SCHEDULE_TICK_MS = 30_000;
const PROFILE_CREATE_REQUEST_POLL_MS = 10_000;
const NEXTCTL_DAILY_UPDATE_MS = 20 * 60 * 1000;
const NEXTCTL_DAILY_UPDATE_POLL_MS = 60 * 1000;
// Retries stay silent in the background: only the last one surfaces
// nextctlUpdateError, so a transient failure (or GitHub's anonymous API
// rate limit) doesn't interrupt the user unless every attempt fails.
const NEXTCTL_UPDATE_MAX_RETRIES = 5;
const NEXTCTL_UPDATE_RETRY_BASE_MS = 90 * 1000;
const NEXTCTL_UPDATE_RETRY_STEP_MS = 10 * 1000;
function nextctlUpdateRetryDelay(attempt: number): number {
  return NEXTCTL_UPDATE_RETRY_BASE_MS + (attempt - 1) * NEXTCTL_UPDATE_RETRY_STEP_MS;
}
// GitHub's anonymous API limit (60 requests/hour per IP) resets within the
// hour; once the retries above are exhausted, wait the window out before the
// daily background check tries again.
const NEXTCTL_UPDATE_RATE_LIMIT_MS = 60 * 60 * 1000;
const NEXTCTL_UPDATE_STATE_FILE = "nextctl-update.json";
const NEXTCTL_UPDATE_ERROR = "We couldn't update the Nextbrowser CLI (nextctl). Please retry.";
const NEXTCTL_UPDATE_ERROR_DETAIL_LIMIT = 160;

function nextctlUpdateErrorMessage(reason?: string): string {
  const raw = String(reason ?? "");
  // A request failure reads like
  // "fetch releases/latest <url>: unexpected status 403 Forbidden". Keep only
  // the HTTP status so the message stays short; otherwise drop any request URL
  // and collapse whitespace. The status must not run past its line: nextctl
  // prints "Warning: ..." on the next one.
  const status = raw.match(/\b\d{3}[ \t]+[A-Za-z][A-Za-z \t]*/);
  const detail = (status
    ? status[0].trim()
    : raw
      .replace(/\s+/g, " ")
      .trim()
      .replace(/https?:\/\/\S+?(?=[:\s]|$)/g, "")
      .replace(/\s+([:;,])/g, "$1")
      .trim()
  ).slice(0, NEXTCTL_UPDATE_ERROR_DETAIL_LIMIT);
  return detail ? `${NEXTCTL_UPDATE_ERROR} ${detail}` : NEXTCTL_UPDATE_ERROR;
}

// GitHub's anonymous REST API allows 60 requests/hour per IP and answers 403
// when exceeded. Retrying within minutes only keeps hitting the limit.
function isNextctlRateLimit(reason: string): boolean {
  return /\b403\b|rate limit|forbidden/i.test(reason);
}

// nextctl appends "(rate limit resets at <RFC3339>)" when GitHub's
// X-RateLimit-Reset header was present on the 403 it hit. Prefer that real
// reset time over the flat one-hour guess below; fall back to the guess when
// nextctl couldn't read the header (older nextctl, or GitHub omitted it).
function nextctlRateLimitResetAt(reason: string): number | undefined {
  const match = reason.match(/rate limit resets at (\S+)\)/);
  if (!match) return undefined;
  const parsed = Date.parse(match[1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Record the attempt (and merge any extra fields) so the daily tick throttles
// instead of re-running the update every minute.
async function recordNextctlUpdateAttempt(patch: Partial<NextctlUpdateState> = {}): Promise<void> {
  const state = await loadJson<NextctlUpdateState>(NEXTCTL_UPDATE_STATE_FILE, {});
  await saveJson(NEXTCTL_UPDATE_STATE_FILE, { ...state, lastAutoCheckAt: now(), ...patch });
}

/**
 * Reads the newly installed nextctl version from `nextctl update` output.
 * Supports the current `[nbc-update] Installed vX` line and the legacy
 * `nextctl updated: old > new` line. The command can exit non-zero because an
 * optional browser-runtime asset failed to download even though nextctl
 * itself was installed, so success must be detected from the output.
 */
function nextctlUpdatedVersion(text: string): string | undefined {
  const legacy = text.split("\n").find((line) => line.includes("nextctl updated:"));
  if (legacy) return legacy.split(">").pop()?.trim() || undefined;
  return text.match(/\[nbc-update\]\s+Installed\s+v?([0-9][^\s]*)/i)?.[1];
}

// The success notice is a brief confirmation, not a permanent state: the
// footer already shows the version, so "updated → X" must not linger.
const NEXTCTL_UPDATE_NOTICE_MS = 10_000;
let nextctlUpdateNoticeTimer: ReturnType<typeof setTimeout> | null = null;

function clearNextctlUpdateNotice(): void {
  if (!nextctlUpdateNoticeTimer) return;
  clearTimeout(nextctlUpdateNoticeTimer);
  nextctlUpdateNoticeTimer = null;
}

function showNextctlUpdateNotice(message: string): void {
  useStore.setState({ nextctlUpdateStatus: message });
  clearNextctlUpdateNotice();
  nextctlUpdateNoticeTimer = setTimeout(() => {
    nextctlUpdateNoticeTimer = null;
    if (useStore.getState().nextctlUpdateStatus === message) {
      useStore.setState({ nextctlUpdateStatus: undefined });
    }
  }, NEXTCTL_UPDATE_NOTICE_MS);
}

function nextBrowserInstallPrompt(agentAdapter: string): string {
  return `Nextbrowser needs to finish installing its local browser components before browser work can start.

Use the official nextctl release bootstrap, then install the browser runtime and this agent integration.

On macOS/Linux:

\`\`\`bash
case "$(uname -s):$(uname -m)" in
  Linux:x86_64|Linux:amd64) platform="linux-amd64" ;;
  Linux:arm64|Linux:aarch64) platform="linux-arm64" ;;
  Darwin:arm64) platform="macos-arm64" ;;
  *) echo "unsupported host: $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac
archive="nbc-\${platform}.tar.gz"
url="https://github.com/nextbrowser-oss/nbc_releases/releases/latest/download/\${archive}"
curl -fL --retry 3 --retry-delay 2 -o "$archive" "$url"
tar -xzf "$archive"
"./nbc-\${platform}/nbc" install --agent ${agentAdapter} --no-api-key-prompt --json
\`\`\`

On Windows PowerShell:

\`\`\`powershell
$archive = "nbc-win-amd64.zip"
$url = "https://github.com/nextbrowser-oss/nbc_releases/releases/latest/download/$archive"
Invoke-WebRequest -Uri $url -OutFile $archive
Remove-Item -Recurse -Force ".\\nbc-win-amd64" -ErrorAction SilentlyContinue
Expand-Archive -Force $archive .
$nextctl = ".\\nbc-win-amd64\\nbc.exe"
& $nextctl install --agent ${agentAdapter} --no-api-key-prompt --json
\`\`\`

If Windows asks for administrator approval, tell the user exactly that approval is needed. After install, run \`nextctl version\` and report the installed path. Do not invent backend API calls.`;
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

function pageReadyNote(openedHost?: string, directFallback = false): string {
  const direct = directFallback ? " Use the selected direct profile explicitly approved by the user; do not switch back to the failed proxy profile." : "";
  if (!openedHost) return direct;
  return ` The page ${openedHost} is already open in the active Nextbrowser profile — work there and don't navigate away unless the steps require it.${direct}`;
}

function skillAgentPrompt(
  title: string,
  target: string,
  md: string | undefined,
  slug: string | undefined,
  openedHost?: string,
  directFallback = false,
  task?: string,
  currentTab = false,
): string {
  const startHint = currentTab
    ? `${pageReadyNote(undefined, directFallback)} Keep the current browser tab active; do not open a different website unless the user explicitly asks.`
    : openedHost
    ? pageReadyNote(openedHost, directFallback)
    : ` Start by opening ${target} in the active Nextbrowser profile.${pageReadyNote(undefined, directFallback)}`;
  // The task is the app's own instruction for this run, so it precedes the
  // skill text: the workflow explains how, the task says what.
  const thisRun = task?.trim() ? `\n\nTask for this run:\n${task.trim()}` : "";
  if (md) {
    return `Use the "${title}" skill to work with ${target}.${startHint}${thisRun}\n\nFollow this SKILL.md exactly, step by step:\n\n${md}`;
  }
  if (slug) {
    return `Use the skill "${slug}" (${title}) to work with ${target}. It is installed in your skills directory — read its SKILL.md and follow it.${startHint}${thisRun}`;
  }
  return `Use the "${title}" skill you just installed to work with ${target}.${startHint}${thisRun}`;
}

function scriptAgentPrompt(
  title: string,
  where: string,
  md: string | undefined,
  slug: string | undefined,
  openedHost?: string,
  directFallback = false,
): string {
  const note = pageReadyNote(openedHost, directFallback);
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

async function pullCatalogInstructions(entry: SkillEntry, preferredAgentId: string): Promise<SkillRef> {
  const adapters = [
    nextctlAgentAdapter(preferredAgentId),
    "claude-code",
    "codex",
  ].filter((adapter, index, all) => all.indexOf(adapter) === index);
  for (const adapter of adapters) {
    try {
      const ref = await nextctlJson<SkillRef>([
        "skill",
        "check",
        ...selectorFlags(entry.selector),
        "--agent",
        adapter,
      ]);
      if (ref.found === true) return ref;
    } catch {
      /* Try the next supported agent adapter. */
    }
  }
  throw new Error(internalError(`We couldn't prepare "${entry.title}".`, "SKILL_PREPARE_FAILED"));
}

interface State {
  authed: boolean;
  accountEmail?: string;
  accountOwnerId?: string;
  checking: boolean;
  startupPhase: "local" | "account";
  startupError?: string;
  loginError?: string;
  isLoggingIn: boolean;
  proxy?: ProxyTraffic;
  proxyWarning?: string;
  trafficGatePromptOpen: boolean;
  /** Star reward for GitHub sign-ups; undefined until loaded, null when not offered. */
  githubStar?: GitHubStarStatus | null;
  githubStarPromptOpen: boolean;
  profiles: Profile[];
  pendingProfileCreateRequests: ProfileCreateRequest[];
  personalProxies: PersonalProxy[];
  proxyCountries: RotationCountry[];
  statuses: Record<string, string>;
  profileSessions: Record<string, SessionStatus>;
  profileIdentities: Record<string, ProxyIdentity>;
  profileChatOwners: Record<string, string>;
  selectedProfile?: string;
  defaultSession?: SessionStatus;
  profileSearch: string;
  isRefreshing: boolean;
  agentId: string;
  runtime: Record<string, AgentRuntime>;
  conversations: Conversation[];
  workspaces: Workspace[];
  activeWorkspaceId?: string;
  workspacesLoaded: boolean;
  workspaceSetupRequired: boolean;
  /**
   * Automatic first-run setup state. "pending" before the first attempt,
   * "running" while defaults are being created, "done" once complete, and
   * "failed" to fall back to the manual WorkspaceSetupGate.
   */
  workspaceSetupAuto: "pending" | "running" | "done" | "failed";
  activeConvId: Record<string, string>;
  tab: AppTab;
  skillState: Record<string, SkillApplyState | string>;
  scheduledRuns: ScheduledRun[];
  customScripts: CustomScript[];
  localSkills: BrowserWorkflowSkill[];
  localSkillSync: Record<string, ScriptSyncState>;
  privateCloudSkills: SkillEntry[];
  appliedScripts: SkillEntry[];
  scriptSync: Record<string, ScriptSyncState>;
  usageHistory: UsageSnapshot[];
  showOnboarding: boolean;
  onboardingStepIndex: number;
  onboardingReturnPending: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  chatListCollapsed: boolean;
  terminalChat: boolean;
  dashboardKeyPromptOpen: boolean;
  connectorPrompt?: ConnectorPrompt;
  accountPairing?: AccountPairingState;
  nextctlVersion: string;
  nextctlUpdating: boolean;
  nextctlUpdateStatus?: string;
  // The last failed update. The footer shows it only as the refresh button's
  // tooltip: a background check failing must not push a paragraph of text
  // into the sidebar.
  nextctlUpdateError?: string;
  nextctlSupportsSkill: boolean;
  nextctlAvailable: boolean;
  nextctlCompatibilityError?: string;
  startupAgentSuggestion?: string;
  skillCategories: SkillCategory[];
  watchedProfiles: WatchedProfile[];
  watchReports: Record<string, WatchedProfileReport>;
  watchPublishers: Record<string, WatchedPublisher>;
  watchlistRuns: WatchlistRun[];
  /** Which device each watchlist skill runs on, keyed by skill id. */
  watchlistTransports: Record<string, string>;
  /** Which browser profile each watchlist skill signs in and runs with. */
  watchlistProfiles: Record<string, string>;
  /** Which cloud phone each watchlist skill uses on its phone transport. */
  watchlistDevices: Record<string, MultiloginProfileSelection>;
  /** What the panel's own sign-in check last read, per skill. It is kept
   *  apart from watchPublishers because that map mirrors the agent's state
   *  file and is rewritten whenever the reports reload. */
  watchlistSignIns: Record<string, WatchedPublisher>;
  /** Skill id currently doing browser work from its panel, if any. */
  watchlistBusy?: string;
  watchlistStep?: string;
  xReplyState: XReplyState;
  xReplyBusy: boolean;
  xReplyStep?: string;
  /** Set when something the user pressed needs a signed-in profile. */
  xReplySignInNeeded: boolean;
  appActive: boolean;
  connectAnnounced: Set<string>;
  workingDir: string;
  projectRevisions: Record<string, number>;
  workspaceRevisions: Record<string, number>;
  projectsSyncing: boolean;
  // Background sync runs constantly and is not something the user needs to
  // see; logout is the one moment a sync becomes user-relevant, since it
  // blocks the account switch. The sync-status UI only shows while this is
  // true (see App.tsx), not whenever projectsSyncing/isRefreshing are true.
  loggingOut: boolean;

  bootstrap: () => Promise<void>;
  login: (key: string) => Promise<void>;
  startAccountPairing: () => Promise<void>;
  reopenAccountPairing: () => Promise<void>;
  pollAccountPairing: () => Promise<void>;
  cancelAccountPairing: () => void;
  logout: () => Promise<void>;
  refreshAll: () => Promise<void>;
  refreshProxyData: () => Promise<void>;
  setTrafficGatePromptOpen: (open: boolean) => void;
  loadGitHubStar: () => Promise<void>;
  verifyGitHubStar: () => Promise<GitHubStarStatus>;
  setGitHubStarPromptOpen: (open: boolean) => void;
  refreshSessions: () => Promise<void>;
  loadProxy: () => Promise<void>;
  loadProfiles: () => Promise<void>;
  pollProfileCreateRequests: () => Promise<void>;
  approveProfileCreateRequest: (id: string) => Promise<void>;
  rejectProfileCreateRequest: (id: string, reason?: string) => Promise<void>;
  loadProxyCountries: () => Promise<void>;
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
  createManagedProfile: (
    name: string,
    country: string,
    options?: NextctlRunOptions & { runtime?: BrowserToolset; direct?: boolean },
  ) => Promise<string>;
  createManualProxyProfile: (input: ManualProxyProfileInput) => Promise<void>;
  loadPersonalProxies: () => Promise<void>;
  savePersonalProxy: (input: ManualProxyProfileInput) => Promise<PersonalProxy>;
  savePersonalProxies: (inputs: ManualProxyProfileInput[]) => Promise<ManualProxyBatchSaveResult>;
  deletePersonalProxy: (id: string) => Promise<void>;
  testPersonalProxy: (id: string) => Promise<PersonalProxyTestResult>;
  createPersonalProxyProfile: (
    name: string,
    proxyId: string,
    options?: NextctlRunOptions & { runtime?: BrowserToolset },
  ) => Promise<string>;
  updateProfileConnection: (
    name: string,
    connection: "managed" | "direct" | "personal",
    options?: { country?: string; proxyId?: string },
  ) => Promise<void>;
  deleteProfile: (n: string) => Promise<void>;
  selectProfile: (n?: string) => void;
  switchAgent: (id: string) => void;
  authorizeAgent: (options?: AgentAuthorizationOptions) => Promise<void>;
  loginAgent: () => Promise<void>;
  logoutAgent: () => Promise<void>;
  recheckLogin: (agentId?: string) => Promise<void>;
  setTab: (t: AppTab) => void;
  setAppActive: (v: boolean) => void;
  setProfileSearch: (q: string) => void;
  setSidebarWidth: (w: number) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setChatListCollapsed: (v: boolean) => void;
  setTerminalChat: (v: boolean) => void;
  setDashboardKeyPromptOpen: (v: boolean) => void;
  openConnectorPrompt: (id: ConnectorPrompt["id"], resume?: ConnectorPrompt["resume"]) => void;
  clearConnectorPrompt: () => void;
  completeConnectorPrompt: () => void;
  setOnboardingStepIndex: (index: number) => void;
  suspendOnboardingForSetup: () => void;
  resumeOnboardingAfterSetup: () => void;
  finishOnboarding: () => void;
  showOnboardingAgain: () => void;
  checkNextctlUpdate: (retryAttempt?: number) => Promise<boolean>;
  syncProjects: () => Promise<void>;
  createWorkspace: (name: string) => Promise<string>;
  selectWorkspace: (id: string) => void;
  deleteWorkspace: (id: string) => Promise<void>;
  completeWorkspaceSetup: () => void;
  /** Create a default workspace, project, and one profile per toolset without
   *  showing the setup modal. Falls back to the gate only if it fails. */
  ensureDefaultWorkspaceSetup: () => Promise<void>;

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
  createProject: (name: string, mode: "chat" | "terminal", agentId?: string) => string;
  changeEmptyProjectAgent: (id: string, agentId: string) => boolean;
  assignProfileToProject: (profileName: string, toolset: BrowserToolset, projectId?: string, replaceToolset?: boolean, proxyId?: string) => Promise<void>;
  setProfileChatOwner: (profileName: string, conversationId?: string) => void;
  moveProfileToWorkspace: (profileName: string, workspaceId: string) => Promise<void>;
  reorderProfileInProject: (projectId: string, profileName: string, beforeProfileName: string) => Promise<void>;
  createNamedChat: (agentId: string, title: string) => string;
  selectConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  updateTerminalPreview: (id: string, preview?: string) => void;
  deleteConversation: (id: string) => Promise<void>;
  forkConversation: (atMessageId?: string) => void;
  clearChat: () => void;
  enqueue: (text: string, chip?: UserCommandChip, into?: string, attachments?: ChatAttachment[], agentPrompt?: string) => string | undefined;
  stopRunning: () => void;
  stopReply: (replyId: string) => void;
  cancelQueuedReply: (replyId: string) => boolean;
  editQueuedReply: (replyId: string, newText: string) => boolean;
  canManageQueuedReply: (replyId: string) => boolean;
  send: (text: string) => Promise<void>;
  tryGuidePrompt: (text: string, tab?: AppTab) => Promise<void>;
  sendVPSPrompt: (text: string, connectionLabel?: string) => Promise<void>;

  applySkill: (entry: SkillEntry) => Promise<SkillRef | undefined>;
  useSkillInChat: (entry: SkillEntry, task?: string, options?: SkillRunOptions) => Promise<void>;
  runScript: (entry: SkillEntry, host?: string) => Promise<void>;

  addWatchedProfile: (skillId: string, handle: string) => WatchedProfile | undefined;
  removeWatchedProfile: (id: string) => void;
  setWatchedProfileEnabled: (id: string, enabled: boolean) => void;
  watchedProfilesFor: (skillId: string) => WatchedProfile[];
  watchReportFor: (skillId: string, handle: string) => WatchedProfileReport | undefined;
  watchPublisherFor: (skillId: string) => WatchedPublisher | undefined;
  loadWatchReports: (entry: SkillEntry) => Promise<void>;
  subscribeWatchedProfile: (entry: SkillEntry, profileId: string) => Promise<void>;
  runWatchlistPass: (entry: SkillEntry, options?: SkillRunOptions) => Promise<void>;
  watchlistRunFor: (skillId: string) => WatchlistRun | undefined;
  watchlistTransportFor: (entry: SkillEntry) => SkillWatchlistTransport;
  setWatchlistTransport: (entry: SkillEntry, transportId: string) => void;
  watchlistProfileFor: (skillId: string) => string | undefined;
  setWatchlistProfile: (entry: SkillEntry, profileName?: string) => void;
  watchlistDeviceFor: (skillId: string) => MultiloginProfileSelection | undefined;
  setWatchlistDevice: (entry: SkillEntry, device?: MultiloginProfileSelection) => void;
  openWatchlistSite: (entry: SkillEntry) => Promise<void>;
  checkWatchlistSignIn: (entry: SkillEntry) => Promise<boolean>;
  startWatchlistRun: (entry: SkillEntry, intervalMinutes?: number) => Promise<void>;
  runXReplyPass: (entry: SkillEntry) => Promise<void>;
  openSkillSite: (entry: SkillEntry) => Promise<void>;
  checkXReplySignIn: (entry: SkillEntry) => Promise<boolean>;
  dismissXReplySignIn: () => void;
  subscribeXReplyHandle: (entry: SkillEntry, handle: string) => Promise<void>;
  updateXReplySettings: (patch: Partial<XReplyState>) => void;
  stopWatchlistRun: (skillId: string) => void;
  tickWatchlistRuns: () => Promise<void>;
  startRemoteStream: (target?: LiveStreamTarget) => Promise<RemoteStreamInfo>;

  addScheduledRun: (run: Omit<ScheduledRun, "id" | "agent" | "enabled">) => void;
  updateScheduledRun: (id: string, patch: Partial<ScheduledRun>) => void;
  deleteScheduledRun: (id: string) => void;
  setScheduledRunEnabled: (id: string, enabled: boolean) => void;
  scheduledRunChatTitle: (run: ScheduledRun) => string | undefined;

  saveCustomScript: (script: CustomScript) => Promise<void>;
  deleteCustomScript: (id: string) => Promise<void>;
  runCustomScript: (script: CustomScript) => Promise<void>;
  saveLocalSkill: (skill: BrowserWorkflowSkill) => Promise<void>;
  deleteLocalSkill: (id: string) => Promise<void>;
  runLocalSkill: (skill: BrowserWorkflowSkill, task?: string) => Promise<string | undefined>;
  runAutomationRecipe: (skill: BrowserWorkflowSkill, executionId: string, parameters?: Record<string, unknown>) => Promise<AutomationRecipeResult>;

  // Internal queue/runtime helpers
  reconcileQueues: () => void;
  startTimers: () => void;
  refreshProfileStatuses: () => Promise<void>;
  tickScheduledRuns: () => Promise<void>;
  startConsumer: (agentId: string) => void;
  dequeue: (agentId: string) => QueuedItem | null;
  processItem: (agentId: string, item: QueuedItem) => Promise<void>;
  setMessageStatus: (cid: string, mid: string, status: ChatMessage["status"], fallback?: string) => void;
  appendToMessage: (cid: string, mid: string, chunk: string) => void;
  makeStepMessage: (cid: string) => string;
  appendStep: (cid: string, mid: string, step: string) => void;
  failStep: (cid: string, mid: string, error: unknown) => void;
  startSessionPoll: () => void;
  tickNextctlDailyUpdate: () => Promise<void>;
  ensureConversation: (agentId: string) => void;
  announceConnect: (agentId: string, version: string, loggedIn: boolean | null) => void;
}

let proxyTimer: ReturnType<typeof setInterval> | null = null;
let profileStatusTimer: ReturnType<typeof setInterval> | null = null;
let profileStatusRefreshInFlight = false;
let scheduleTimer: ReturnType<typeof setInterval> | null = null;
let profileCreateRequestTimer: ReturnType<typeof setInterval> | null = null;
let profileCreateRequestPollInFlight = false;
let sessionPollTimer: ReturnType<typeof setInterval> | null = null;
let sessionPollInFlight = false;
let nextctlDailyUpdateTimer: ReturnType<typeof setInterval> | null = null;
let nextctlUpdateRetryTimer: ReturnType<typeof setTimeout> | null = null;
let vpsSetupReservations = 0;
let localNextctlOperations = 0;
let defaultSetupInFlight = false;

// One default profile per browser toolset for a brand-new account.
const DEFAULT_WORKSPACE_TOOLSETS: { runtime: BrowserToolset; name: string }[] = [
  { runtime: "clawbrowser", name: "Clawbrowser profile" },
  { runtime: "dasbrowser", name: "DasBrowser profile" },
  { runtime: "camoufox", name: "Camoufox profile" },
];
// Guard bootstrap against re-entry. React StrictMode invokes effects twice in
// dev, and without this each agent:* listener would be registered again, so a
// single agent reply would be appended once per registration (duplicate output).
// Mirrors AppState.didBootstrap in the Swift app.
let didBootstrap = false;
type AgentDone = { code: number; stderr: string; stdout: string };
interface NextctlUpdateState { lastAutoCheckAt?: number; rateLimitedUntil?: number }
interface APIKeyIdentity {
  valid: boolean;
  key_id?: string;
  owner_id?: string;
  email?: string;
}

const replyExecutionTargets = new Map<string, ExecutionTarget>();
const replyProfileBaselines = new Map<string, Set<string>>();
const profileOperationEpoch = new Map<string, number>();
const pendingProfileLaunches = new Map<string, number>();
const pendingProfileStarts = new Map<string, Promise<void>>();
const deletingProjectIds = new Set<string>();
const deletedProjectIds = new Set<string>();
const verifyingProfileStarts = new Set<string>();
const BOOTSTRAP_FOREGROUND_WAIT_MS = 12_000;
// Stamps which account's data the on-disk caches (workspaces.json and
// friends) belong to. A clean logout clears it along with the files; if it
// survives to the next bootstrap under a different account (crash, killed
// process, credential change outside logout()), that tells us the just-loaded
// caches are foreign and must not reach syncProjects(). See NB-25647DEA.
const CACHED_ACCOUNT_OWNER_KEY = "cachedAccountOwnerId";

function activeConversationStorageKey(agentId: string, workspaceId?: string): string {
  return `activeConversationId:${agentId}:${workspaceId || "none"}`;
}

function nextProfileOperation(profile: string): number {
  const next = (profileOperationEpoch.get(profile) ?? 0) + 1;
  profileOperationEpoch.set(profile, next);
  return next;
}

function runningTarget(state: State, target: ExecutionTarget): boolean {
  return Object.values(state.runtime).some((runtime) => {
    const replyId = runtime.runningReplyId;
    if (!replyId) return false;
    const conversation = state.conversations.find((candidate) =>
      candidate.messages.some((message) => message.id === replyId),
    );
    const executionTarget = replyExecutionTargets.get(replyId) ??
      executionTargetForTurn(conversation);
    return executionTarget === target;
  });
}

function queuedTarget(state: State, target: ExecutionTarget): boolean {
  return Object.values(state.runtime).some((runtime) =>
    runtime.queue.some((item) => item.executionTarget === target),
  );
}

function pendingTarget(state: State, target: ExecutionTarget): boolean {
  return (target === "vps" && vpsSetupReservations > 0) ||
    runningTarget(state, target) ||
    queuedTarget(state, target);
}

function localSkillCheckRunning(state: State): boolean {
  return Object.values(state.skillState).some((status) => status === "applying");
}

async function runLocalNextctlOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (pendingTarget(useStore.getState(), "vps")) {
    throw new Error("Local nextctl operations are paused while VPS work is queued or running.");
  }
  localNextctlOperations += 1;
  try {
    return await operation();
  } finally {
    localNextctlOperations = Math.max(0, localNextctlOperations - 1);
  }
}

async function nextctlRun(
  args: string[],
  extraEnv?: Record<string, string>,
  options?: NextctlRunOptions,
): Promise<RunResult> {
  return runLocalNextctlOperation(() => rawNextctlRun(args, extraEnv, options));
}

async function nextctlJson<T>(
  args: string[],
  extraEnv?: Record<string, string>,
): Promise<T> {
  return runLocalNextctlOperation(() => rawNextctlJson<T>(args, extraEnv));
}

async function nextctlEnvelope<T>(
  args: string[],
  extraEnv?: Record<string, string>,
) {
  return runLocalNextctlOperation(() => rawNextctlEnvelope<T>(args, extraEnv));
}

// Workspace changes must reach the desktop file. A localStorage fallback can
// otherwise appear successful but be shadowed by the old file after restart.
async function saveWorkspaces(workspaces: Workspace[]): Promise<void> {
  await invoke("app_data_write", { name: "workspaces.json", content: JSON.stringify(workspaces, null, 2) });
}

// Account-owned entities must never survive a successful account switch. The
// backend is the source of truth; these files are only the active account's
// working cache and must not be offered to the next account for sync.
async function clearAccountEntityCache(): Promise<void> {
  const emptyFiles: Record<string, string> = {
    "conversations.json": "[]",
    "workspaces.json": "[]",
    "scheduled-runs.json": "[]",
    "custom-scripts.json": "[]",
    "local-skills.json": "[]",
    "applied-scripts.json": "[]",
    "usage-history.json": "[]",
    "watched-profiles.json": "[]",
    "watchlist-runs.json": "[]",
    "watchlist-transports.json": "{}",
    "watchlist-profiles.json": "{}",
    "watchlist-devices.json": "{}",
    "watchlist-sign-ins.json": "{}",
    [X_REPLY_STATE_FILE]: "null",
  };
  await Promise.all(Object.entries(emptyFiles).map(([name, content]) =>
    invoke("app_data_write", { name, content }),
  ));
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index);
    if (key?.startsWith("activeConversationId:") || key === "activeWorkspaceId" || key === CACHED_ACCOUNT_OWNER_KEY) {
      localStorage.removeItem(key);
    }
  }
  // These live outside the JSON-file caches above, in raw localStorage/
  // sessionStorage, and are keyed by workspace id (backend-issued, globally
  // unique) rather than account — but a stray "Recorder is active" banner
  // surviving a same-session account switch is still worth clearing.
  clearActiveAutomationRecording();
}

// The in-memory mirror of the account-owned files above, matching the shape
// bootstrap() hydrates them into. Used when bootstrap finds the on-disk
// cache it just loaded belongs to a different account than the one that
// just authenticated — the files get wiped by clearAccountEntityCache, and
// this drops the same data from the state that was already set from them.
function emptyAccountOwnedCaches(): Partial<State> {
  return {
    conversations: [],
    workspaces: [],
    activeWorkspaceId: undefined,
    activeConvId: {},
    scheduledRuns: [],
    customScripts: [],
    localSkills: [],
    appliedScripts: [],
    // Account-scoped cloud skills must be dropped with the rest of the
    // account cache; otherwise the previous account's private skills stay
    // visible after logout or an account switch.
    privateCloudSkills: [],
    skillCategories: REPOSITORY_SKILL_CATEGORIES,
    usageHistory: [],
    watchedProfiles: [],
    watchlistRuns: [],
    watchlistTransports: {},
    watchlistProfiles: {},
    watchlistDevices: {},
    watchlistSignIns: {},
    // Per-handle watch state and the selected profile are account-scoped too;
    // a non-logout re-auth (token expiry -> sign in as another account) must
    // not leave the previous account's reports or "Runs in ..." selection.
    watchReports: {},
    watchPublishers: {},
    selectedProfile: undefined,
    xReplyState: normalizeXReplyState(null),
  };
}

// Drops the account-owned caches if they were stamped for a different
// account than the one that just authenticated (see CACHED_ACCOUNT_OWNER_KEY
// and emptyAccountOwnedCaches above). This must run before anything treats
// the session as authed — a workspace mutation or the queue reconciler can
// trigger syncProjects() as soon as `authed` flips true, which would push
// the stale cache at the backend under the new account's key. Runs both at
// boot (bootstrap(), after a crash/force-quit/non-logout credential change
// left a foreign cache on disk) and whenever a running session
// re-authenticates without restarting — a token can expire mid-session and
// reopen the sign-in modal for a different account without ever going
// through logout()'s cache wipe.
async function guardAgainstForeignAccountCache(): Promise<void> {
  const ownerId = useStore.getState().accountOwnerId;
  if (!ownerId) return;
  const cachedOwnerId = localStorage.getItem(CACHED_ACCOUNT_OWNER_KEY) || undefined;
  if (cachedOwnerId && cachedOwnerId !== ownerId) {
    accountEpoch += 1;
    profileRefreshGeneration += 1;
    trackEvent("foreign_account_cache_cleared");
    await clearAccountEntityCache().catch(() => {});
    useStore.setState(emptyAccountOwnedCaches());
  }
  localStorage.setItem(CACHED_ACCOUNT_OWNER_KEY, ownerId);
}

let workspaceMutationQueue: Promise<unknown> = Promise.resolve();
function persistWorkspaceMutation(transform: (workspaces: Workspace[]) => Workspace[]): Promise<void> {
  const pending = workspaceMutationQueue.then(async () => {
    const deadline = Date.now() + 30_000;
    while (useStore.getState().projectsSyncing && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const state = useStore.getState();
    if (!state.authed) throw new Error("Sign in before changing workspace data.");
    if (state.projectsSyncing) throw new Error("Cloud sync is in progress. Retry this workspace change when it finishes.");
    const previous = state.workspaces;
    const workspaces = transform(previous);
    useStore.setState({ workspaces });
    try {
      // The backend is authoritative. Do not leave a mutation only in the
      // local cache when its cloud write fails. syncProjects sees the
      // temporary state and confirms/merges it before we keep the file.
      await saveWorkspaces(workspaces);
      await useStore.getState().syncProjects();
    } catch (error) {
      const ownershipConflict = error instanceof Error && error.message.includes("belongs to another account");
      if (ownershipConflict) {
        // Foreign data was removed, but the requested assignment was not saved.
        // Preserve the cleaned cache and report the failure so callers can retry.
        throw error;
      }
      if (useStore.getState().workspaces === workspaces) {
        useStore.setState({ workspaces: previous });
        await saveWorkspaces(previous).catch(() => {});
      }
      throw error instanceof Error
        ? error
        : new Error("Cloud sync failed. Retry when your connection is restored.");
    }
  });
  workspaceMutationQueue = pending.catch(() => undefined);
  return pending;
}

async function prepareLocalSession(
  options: Parameters<typeof prepareSession>[0],
): ReturnType<typeof prepareSession> {
  if (options.selectedProfile && !options.verifyOnly) {
    const pending = pendingProfileStarts.get(options.selectedProfile);
    if (pending) {
      await pending;
      options = { ...options, statuses: useStore.getState().statuses };
    }
  }
  const selectedRuntime = options.selectedProfile
    ? runtimeForProfile(useStore.getState().workspaces, options.selectedProfile)
    : undefined;
  const result = await runLocalNextctlOperation(() => prepareSession({
    ...options,
    startupVerifies: true,
    runtime: options.runtime ?? selectedRuntime,
    proxyExpected: options.proxyExpected ?? (useStore.getState().profiles.find((p) => p.name === options.selectedProfile)?.proxy_mode !== "direct"),
    onVerificationFailure: options.onVerificationFailure ?? ((failure) => {
      // prepareSession has already confirmed stop before showing this dialog.
      if (options.selectedProfile) {
        pendingProfileLaunches.delete(options.selectedProfile);
        useStore.setState((state) => ({ statuses: { ...state.statuses, [options.selectedProfile!]: "stopped" } }));
      }
      return invoke<VerificationFailureChoice>("browser_verification_failure_choice", {
        failedSurfaces: failure.failedSurfaces,
        proxyExpected: failure.proxyExpected,
        attempts: failure.attempts,
      });
    }),
  }));
  if (result.directFallback) {
    const name = result.profileArgs[result.profileArgs.indexOf("--profile") + 1];
    await useStore.getState().assignProfileToProject(name, options.runtime ?? selectedRuntime ?? "clawbrowser");
    useStore.getState().selectProfile(name);
    await useStore.getState().loadProfiles();
  }
  return result;
}

async function waitForLocalNextctlIdle(getState: () => State): Promise<void> {
  const deadline = now() + 30_000;
  while ((getState().nextctlUpdating || localSkillCheckRunning(getState()) ||
    localNextctlOperations > 0 || runningTarget(getState(), "local")) && now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (getState().nextctlUpdating || localSkillCheckRunning(getState()) ||
      localNextctlOperations > 0 || runningTarget(getState(), "local")) {
    throw new Error("A local nextctl operation is still finishing. Wait a moment and try again.");
  }
}

let conversationWriteTail: Promise<void> = Promise.resolve();
let projectSyncTimer: ReturnType<typeof setTimeout> | undefined;
let applyingCloudProjects = false;
let profileRefreshGeneration = 0;
// Bumped on logout so an account-scoped load that started before sign-out
// cannot repopulate the cleared state afterwards.
let accountEpoch = 0;
const PROJECT_SYNC_DELAY_MS = 750;

function runScheduledProjectSync() {
  projectSyncTimer = undefined;
  const state = useStore.getState();
  if (applyingCloudProjects || !state.authed) return;
  if (state.projectsSyncing) {
    projectSyncTimer = setTimeout(runScheduledProjectSync, PROJECT_SYNC_DELAY_MS);
    return;
  }
  void state.syncProjects().catch(() => {});
}

function scheduleProjectSync() {
  if (applyingCloudProjects || !useStore.getState().authed) return;
  if (projectSyncTimer) clearTimeout(projectSyncTimer);
  projectSyncTimer = setTimeout(runScheduledProjectSync, PROJECT_SYNC_DELAY_MS);
}

function persistConvs(conversations: Conversation[]): Promise<void> {
  const snapshot = serializeConversations(conversations);
  conversationWriteTail = conversationWriteTail
    .catch(() => {
      // A failed write must not prevent newer state from being persisted.
    })
    .then(() => saveJson("conversations.json", snapshot));
  // Most state updates intentionally do not block on disk IO. Attach a handler
  // so those writes cannot create unhandled rejections; callers that need a
  // durability boundary can still await the original promise.
  void conversationWriteTail.catch(() => {});
  scheduleProjectSync();
  return conversationWriteTail;
}

function flushConversations(): Promise<void> {
  return conversationWriteTail;
}

function persistSchedules(runs: ScheduledRun[]) {
  void saveJson("scheduled-runs.json", serializeSchedules(runs));
}

function persistScripts(scripts: CustomScript[]) {
  void saveJson("custom-scripts.json", serializeScripts(scripts));
}

function persistLocalSkills(skills: BrowserWorkflowSkill[]) {
  void saveJson("local-skills.json", serializeWorkflowSkills(skills));
}

function persistAppliedScripts(scripts: SkillEntry[]) {
  void saveJson("applied-scripts.json", scripts);
}

function persistWatchedProfiles(profiles: WatchedProfile[]) {
  void saveJson("watched-profiles.json", profiles);
}

function persistWatchlistRuns(runs: WatchlistRun[]) {
  void saveJson("watchlist-runs.json", runs);
}

function persistWatchlistTransports(transports: Record<string, string>) {
  void saveJson("watchlist-transports.json", transports);
}

function persistWatchlistProfiles(profiles: Record<string, string>) {
  void saveJson("watchlist-profiles.json", profiles);
}

function persistWatchlistDevices(devices: Record<string, MultiloginProfileSelection>) {
  void saveJson("watchlist-devices.json", devices);
}

/// transportEntry runs the skill on the device the user picked. useSkillInChat
/// reads `runtime` to decide whether to prepare a browser profile at all, so
/// the choice has to reach it as the entry's own runtime rather than as another
/// argument threaded through every caller.
function transportEntry(entry: SkillEntry, transport: SkillWatchlistTransport): SkillEntry {
  return transport.runtime === entry.runtime ? entry : { ...entry, runtime: transport.runtime };
}

function normalizeWatchlistRuns(raw: WatchlistRun[]): WatchlistRun[] {
  const seen = new Set<string>();
  const runs: WatchlistRun[] = [];
  for (const item of raw) {
    const skillId = String(item?.skillId ?? "").trim();
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);
    runs.push({
      skillId,
      enabled: item.enabled === true,
      intervalMinutes: clampWatchlistInterval(Number(item.intervalMinutes)),
      conversationId: item.conversationId || undefined,
      lastRunAt: Number(item.lastRunAt) || undefined,
      // A loop that was running when the app closed is due immediately, so
      // reopening the app resumes it instead of waiting out a stale delay.
      nextRunAt: item.enabled === true ? now() : undefined,
    });
  }
  return runs;
}

/// normalizeWatchedProfiles drops records that can no longer address an
/// account, so a corrupted file degrades to a shorter list instead of rows the
/// panel cannot act on.
function normalizeWatchedProfiles(raw: WatchedProfile[]): WatchedProfile[] {
  const seen = new Set<string>();
  const profiles: WatchedProfile[] = [];
  for (const item of raw) {
    const handle = normalizeWatchHandle(String(item?.handle ?? ""));
    const skillId = String(item?.skillId ?? "").trim();
    if (!handle || !skillId) continue;
    const key = `${skillId}\n${handle.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    profiles.push({
      id: item.id || uid(),
      skillId,
      handle,
      enabled: item.enabled !== false,
      addedAt: Number(item.addedAt) || now(),
      subscribeQueuedAt: Number(item.subscribeQueuedAt) || undefined,
      lastRunAt: Number(item.lastRunAt) || undefined,
    });
  }
  return profiles;
}

function watchReportKey(skillId: string, handle: string): string {
  return `${skillId}\n${handle.toLowerCase()}`;
}

/// watchHandleMaxLength is the longest handle the skill's list accepts, which
/// the skill declares because the app cannot know what a handle is on that site.
function watchHandleMaxLength(state: State, skillId: string): number | undefined {
  return state.skillCategories.flatMap((category) => category.entries)
    .find((entry) => entry.id === skillId)?.watchlist?.handleMaxLength;
}

const X_REPLY_STATE_FILE = "x-reply-state.json";
/** The engine's own log, next to its state: every step, every CLI call and
 *  what each page looked like when a read went wrong. The panel keeps three
 *  reasons per pass; this is what explains them. Lines are appended in order,
 *  and the main process rotates the file once it outgrows its limit. */
export const X_REPLY_LOG_FILE = "x-reply-log.jsonl";
let xReplyLogQueue: Promise<void> = Promise.resolve();
setXReplyLogSink((entry) => {
  xReplyLogQueue = xReplyLogQueue
    .then(() => appendAppData(X_REPLY_LOG_FILE, `${JSON.stringify(entry)}\n`))
    .catch(() => undefined);
});
/** How long one draft may take before the agent is killed, ported from the Go
 *  service's DefaultCommandTimeout. A CLI that hangs otherwise holds the panel
 *  busy until the app restarts, and Stop cannot reach it. */
const X_REPLY_DRAFT_TIMEOUT_MS = 3 * 60_000;
/** How long a green browser verification stays trusted between passes. Every
 *  pass used to verify anew, and verification borrows the current tab for its
 *  own page, which is how the engine's profile filled up with orphaned tabs. */
const X_REPLY_VERIFY_EVERY_MS = 15 * 60_000;

/** Errors that mean the browser session behind the profile is gone. Ported from
 *  the Go client's SessionUnavailable: the cure is a fresh start, not a retry
 *  against the same dead endpoint. */
function sessionLost(message: string): boolean {
  return /SESSION_NOT_FOUND|CDP_UNREACHABLE|TAB_NOT_FOUND|connection refused|cdp targets/i.test(message);
}

function proxyTunnelLost(message: string): boolean {
  return /ERR_TUNNEL_CONNECTION_FAILED/i.test(message);
}

/** friendlyXReplyError keeps a CDP transcript out of the panel. */
function friendlyXReplyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (sessionLost(message)) return "The browser session was lost. Press Start again to reopen it.";
  if (/API_KEY|not authorized|unauthorized/i.test(message)) return "Nextbrowser could not authenticate. Reconnect your account.";
  return message.replace(/\s+/g, " ").trim().slice(0, 160);
}

// Nothing writes this file per keystroke any more, and a deferred write is a
// write that a crash can lose — the profile choice went missing exactly that
// way. Every change goes to disk at once.
function persistXReplyState(state: XReplyState) {
  void saveJson(X_REPLY_STATE_FILE, state);
}

/// Set while a pass should wind down. The engine checks it between steps, so
/// Stop ends the current pass instead of the app waiting it out.
let xReplyStopRequested = false;
/// The draft the engine is waiting on right now, so Stop can end the CLI
/// process instead of waiting for it to finish on its own.
let xReplyDraftReplyId: string | undefined;

/// prepareXReplySession opens the profile this skill runs in. A session the
/// runtime lost is restarted once: the app's cached status can say running long
/// after the browser is gone, and the first call then fails on a dead endpoint.
/** watchlistSignInFor resolves the sign-in for the device the panel is showing,
 *  falling back to the watchlist's own so a skill without transports keeps it. */
function watchlistSignInFor(state: State, entry: SkillEntry) {
  const transport = state.watchlistTransportFor(entry);
  return transport.signIn ?? entry.watchlist?.signIn;
}

/** watchlistBrowser binds the CLI to the profile this skill was given, so a
 *  panel action drives the same browser its passes will, not whichever profile
 *  happens to be selected in the sidebar. */
async function watchlistBrowser(entry: SkillEntry, onStep: (step: string) => void) {
  const state = useStore.getState();
  const { profileArgs } = await prepareLocalSession({
    host: selectorTargetHost(entry.selector),
    selectedProfile: state.watchlistProfiles[entry.id] ?? state.selectedProfile,
    statuses: state.statuses,
    defaultSession: state.defaultSession,
    onStep,
  });
  return cliBrowser(profileArgs);
}

async function prepareXReplySession(
  host: string | undefined,
  onStep: (step: string) => void,
): Promise<string[]> {
  const state = useStore.getState();
  const profile = state.xReplyState.profileName ?? state.selectedProfile;
  const prepare = async () => {
    const { profileArgs } = await prepareLocalSession({
      host,
      selectedProfile: profile,
      statuses: useStore.getState().statuses,
      defaultSession: useStore.getState().defaultSession,
      onStep,
      verifyEvery: X_REPLY_VERIFY_EVERY_MS,
    });
    // The engine navigates one tab. Pages verification or an earlier session
    // left behind are closed, so every nbc call stops dialing all of them.
    await tidyEngineTabs(profileArgs).catch(() => undefined);
    return profileArgs;
  };
  try {
    return await prepare();
  } catch (error) {
    if (!sessionLost(error instanceof Error ? error.message : String(error))) throw error;
    onStep("Reopening the browser session");
    await Promise.all([
      useStore.getState().loadProfiles().catch(() => {}),
      useStore.getState().loadDefaultSession().catch(() => {}),
    ]);
    return prepare();
  }
}

/// runDraftAgent runs the connected agent once, outside the chat queue. The
/// drafting call is not a conversation turn: it writes no message, holds no
/// chat slot, and its tools are switched off by draftInvocation. It runs plain
/// — no workspace instructions, no Clawbrowser MCP, a working directory of its
/// own — because the text it hands the model is a stranger's post. A call that
/// outlives the timeout is killed rather than left to hold the panel busy.
async function runDraftAgent(options: {
  agentId: string;
  binary: string;
  envVar: string;
  args: string[];
  stdinText?: string;
}): Promise<AgentDone> {
  const replyId = `xreply-${uid()}`;
  xReplyDraftReplyId = replyId;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void invoke("agent_terminate", { replyId }).catch(() => undefined);
  }, X_REPLY_DRAFT_TIMEOUT_MS);
  try {
    const result = await invoke<AgentDone>("agent_run", {
      replyId,
      agentId: options.agentId,
      binary: options.binary,
      envVar: options.envVar,
      args: options.args,
      stdinText: options.stdinText ?? null,
      workingDir: null,
      plain: true,
    });
    if (timedOut) {
      throw new Error(`The agent did not answer within ${Math.round(X_REPLY_DRAFT_TIMEOUT_MS / 60_000)} minutes.`);
    }
    return result;
  } finally {
    clearTimeout(timer);
    if (xReplyDraftReplyId === replyId) xReplyDraftReplyId = undefined;
  }
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
    const data = await nextctlJson<{ verify?: { checks?: VerifyCheck[]; visible_text?: string } }>(args);
    return proxyIdentityFromVerify(data.verify?.checks, data.verify?.visible_text);
  } catch {
    return undefined;
  }
}

async function refreshAnalyticsIdentity(): Promise<boolean> {
  const wrap = await nextctlJson<{ identity: APIKeyIdentity }>(["identity"]);
  const valid = wrap.identity?.valid === true;
  const ownerId = valid ? wrap.identity.owner_id?.trim() : undefined;
  const accountEmail = valid ? wrap.identity.email?.trim() : undefined;
  setAnalyticsUserId(ownerId || undefined);
  useStore.setState({ accountEmail: accountEmail || undefined, accountOwnerId: ownerId || undefined });
  trackEvent("analytics_identity_loaded", {
    valid,
    has_owner_id: !!ownerId,
    has_key_id: valid && !!wrap.identity.key_id,
  });
  return valid;
}

async function refreshLocalNextctlMetadata(): Promise<boolean> {
  if (pendingTarget(useStore.getState(), "vps")) return false;
  const nextctlPath = await runLocalNextctlOperation(() =>
    invoke<string | null>("nextctl_resolve").catch(() => null),
  );
  useStore.setState({ nextctlAvailable: !!nextctlPath });
  trackEvent("nextctl_resolve", { found: !!nextctlPath });
  try {
    const ver = await runLocalNextctlOperation(() => invoke<string>("nextctl_version"));
    const supportsSkill = await runLocalNextctlOperation(() => invoke<boolean>("nextctl_supports_skill"));
    useStore.setState({
      nextctlVersion: normalizeNextctlVersion(ver),
      nextctlSupportsSkill: supportsSkill,
      nextctlAvailable: true,
      nextctlCompatibilityError: undefined,
    });
    trackEvent("nextctl_detected", { supports_skill: supportsSkill });
    try {
      const valid = await refreshAnalyticsIdentity();
      if (!valid) {
        trackEvent("analytics_identity_unavailable", { phase: "bootstrap", reason: "invalid" });
      }
      return valid;
    } catch {
      setAnalyticsUserId(undefined);
      useStore.setState({ accountEmail: undefined, accountOwnerId: undefined });
      trackEvent("analytics_identity_unavailable", { phase: "bootstrap" });
      return false;
    }
  } catch (error) {
    setAnalyticsUserId(undefined);
    const incompatible = String(error).includes("VERIFY_REQUIRED");
    useStore.setState({
      accountEmail: undefined,
      accountOwnerId: undefined,
      nextctlVersion: incompatible ? "update required" : "not found",
      nextctlSupportsSkill: false,
      nextctlAvailable: false,
      nextctlCompatibilityError: incompatible
        ? "This nextctl version cannot enforce browser verification. Update nextctl to continue."
        : undefined,
    });
    trackEvent(incompatible ? "nextctl_incompatible" : "nextctl_missing");
    return false;
  }
}

async function finishAPIKeyLogin(apiKey: string): Promise<void> {
  await nextctlRunChecked(["config", "set", "--api-key", apiKey]);
  const valid = await refreshAnalyticsIdentity().catch(() => {
    trackEvent("analytics_identity_unavailable", { phase: "login" });
    return false;
  });
  if (!valid) throw new Error("The saved API key did not produce a valid account identity.");
}

async function refreshCompletedAccountPairing(
  method: "pairing" | "pairing_json",
  alreadyValidated = false,
): Promise<void> {
  // The api_key path already validated the key (config set + identity) inside
  // finishAPIKeyLogin, so don't block the modal on a second round-trip. Sign the
  // user in immediately and refresh local nextctl metadata (version/skill) in the
  // background. The pairing_json path has no prior validation, so verify first.
  if (alreadyValidated) {
    void refreshLocalNextctlMetadata();
  } else {
    const valid = await refreshLocalNextctlMetadata();
    if (!valid) {
      useStore.setState({ authed: false });
      throw new Error("Browser sign-in completed, but the account identity could not be verified.");
    }
  }
  await guardAgainstForeignAccountCache();
  useStore.setState({
    authed: true,
    nextctlAvailable: true,
    accountPairing: undefined,
    dashboardKeyPromptOpen: false,
    loginError: undefined,
  });
  useStore.getState().startTimers();
  void useStore.getState().refreshAll().catch(() => {});
  void useStore.getState().authorizeAgent();
  if (useStore.getState().onboardingReturnPending) {
    useStore.getState().resumeOnboardingAfterSetup();
  } else if (!hasCompletedCurrentOnboarding(localStorage)) {
    useStore.setState({ showOnboarding: true });
  }
  trackEvent("login", { method });
}

function isAccountRequiredError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const keyMissing = (lower.includes("api") || lower.includes("dashboard")) && lower.includes("key");
  return keyMissing || /unauthorized|forbidden|401|403|sign in|login required/i.test(message);
}

function preflightFailureMessage(error: unknown): string {
  console.error("[BROWSER_PREFLIGHT_FAILED]", error);
  const detail = userFacingBrowserError(error);
  return detail
    ? `Browser setup stopped. ${detail}`
    : "Browser setup stopped. Check the session and try again.";
}

async function nextctlRunChecked(
  args: string[],
  extraEnv?: Record<string, string>,
  options?: NextctlRunOptions,
): Promise<RunResult> {
  const result = await nextctlRun(args, extraEnv, options);
  let envelopeFailed = false;
  try {
    const envelope = JSON.parse(result.stdout) as { ok?: boolean; error?: unknown };
    envelopeFailed = envelope.ok === false || envelope.error != null;
  } catch {
    /* plain output is valid for older nextctl builds */
  }
  if (result.code !== 0 || envelopeFailed) throw new Error(nextctlErrorMessage(result));
  return result;
}

function createdProfileName(result: RunResult, fallback: string): string {
  try {
    const envelope = JSON.parse(result.stdout) as { data?: { profile?: { name?: string } } };
    return envelope.data?.profile?.name?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function requestAccountSignIn(setState: (state: Partial<State>) => void, error: unknown) {
  if (!isAccountRequiredError(error)) return;
  setState({
    dashboardKeyPromptOpen: true,
    loginError: "Sign in to use managed profiles, traffic, Remote Control, and skills.",
  });
  trackEvent("account_signin_required");
}

// A failed rotate must not leave the profile — or every profile's status poll,
// which pauses while any profile is "rotating" — stuck forever. Refresh the
// authoritative status; if the CLI is also unreachable, clear the transient
// marker so the user can retry.
async function settleRotateFailure(name: string): Promise<void> {
  await useStore.getState().loadProfiles();
  useStore.setState((s) =>
    s.statuses[name] === "rotating" ? { statuses: { ...s.statuses, [name]: "unknown" } } : {},
  );
}

// loadProfiles swallows its own errors, so a start/stop/rotate that succeeded
// but could not refresh keeps a transient marker forever (and that marker
// pauses status polling for every profile). Clear it when the refresh failed.
function settleTransientStatus(name: string, transient: string): void {
  useStore.setState((s) =>
    s.statuses[name] === transient ? { statuses: { ...s.statuses, [name]: "unknown" } } : {},
  );
}

export const useStore = create<State>((set, get) => {
  const enqueueWithTarget = (
    text: string,
    chip?: UserCommandChip,
    into?: string,
    attachments: ChatAttachment[] = [],
    privilegedTarget?: ExecutionTarget,
    agentPrompt?: string,
    profileSelection?: { name?: string },
  ) => {
    const prompt = text.trim();
    if (!prompt) return;
    const rawPrompt = (agentPrompt ?? text).trim();
    if (!rawPrompt) return;
    if (prompt === "/login" || prompt.startsWith("/login ")) {
      void get().loginAgent();
      return;
    }
    const cid = into ?? get().activeConversation()?.id ?? get().newChat();
    const targetConversation = get().conversations.find((conversation) => conversation.id === cid);
    // Queue under the conversation's agent, not whichever agent is currently
    // selected: a watchlist/skill pass can fire after the user switched agents,
    // and the reply must run as (and land in) the conversation's own agent.
    const agentId = targetConversation?.agent ?? get().agentId;
    const targetRuntime = get().runtime[agentId];
    if (!targetRuntime?.ready || targetRuntime.loggedIn === false) return;
    const executionTarget = privilegedTarget ?? executionTargetForTurn(targetConversation);
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
      execution_target: executionTarget,
      prompt_length_bucket: Math.min(5000, Math.ceil(prompt.length / 250) * 250),
    });
    trackEvent("chat_request_submitted", {
      agent: agentId,
      has_chip: !!chip,
      chip_kind: chip?.kind ?? "none",
      attachment_count: attachments.length,
      execution_target: executionTarget,
      prompt_length_bucket: Math.min(5000, Math.ceil(prompt.length / 250) * 250),
    });
    set((state) => {
      const conversations = state.conversations.map((conversation) =>
        conversation.id === cid
          ? { ...conversation, messages: [...conversation.messages, userMsg, reply], updatedAt: now() }
          : conversation,
      );
      const runtime = {
        ...state.runtime,
        [agentId]: {
          ...state.runtime[agentId],
          queue: [
            ...state.runtime[agentId].queue,
            {
              conversationId: cid,
              rawText: promptWithAttachments(rawPrompt, attachments),
              replyId,
              executionTarget,
              selectedProfile: profileSelection ? profileSelection.name : state.selectedProfile,
            },
          ],
        },
      };
      persistConvs(conversations);
      return { conversations, runtime };
    });
    get().startConsumer(agentId);
    return replyId;
  };

  const finishAgentRun = async (replyId: string, result: AgentDone) => {
    const owningConversation = get().conversations.find((conversation) =>
      conversation.messages.some((message) => message.id === replyId),
    );
    const activeMessage = owningConversation?.messages.find((message) => message.id === replyId);
    if (!owningConversation || !activeMessage || activeMessage.status !== "streaming") return;
    const owningConversationId = owningConversation.id;
    const agentId =
      Object.entries(get().runtime).find(([, runtime]) => runtime.runningReplyId === replyId)?.[0] ??
      owningConversation?.agent ??
      get().agentId;
    const executionTarget = replyExecutionTargets.get(replyId) ??
      executionTargetForTurn(owningConversation);
    replyProfileBaselines.delete(replyId);
    if (result.code !== 0) void get().recheckLogin(agentId);
    const stopped = get().runtime[agentId]?.pendingStop;
    set((s) => {
      const runtime = { ...s.runtime };
      if (runtime[agentId]) {
        runtime[agentId] = {
          ...runtime[agentId],
          runningReplyId: undefined,
          pendingStop: false,
        };
      }
      const completedAt = now();
      const conversations = s.conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => {
          if (message.id !== replyId || message.status !== "streaming") return message;
          let status: ChatMessage["status"] = "done";
          let text = message.text.trim() || capStreamText(result.stdout).trim();
          if (stopped) {
            status = "cancelled";
            text = text ? `${text}\n[stopped]` : "[stopped]";
          } else if (result.code !== 0) {
            status = "failed";
            const error = internalError(`${agentById(agentId).name} stopped unexpectedly.`, "AGENT_STOPPED_UNEXPECTEDLY");
            text = text ? `${text}\n${error}` : error;
          } else if (!text) {
            status = "failed";
            text = agentEmptyReplyMessage(agentId, agentById(agentId).name);
          }
          return { ...message, status, text, stalled: false };
        }),
        ...(conversation.id === owningConversationId ? { updatedAt: completedAt } : {}),
      }));
      persistConvs(conversations);
      return { conversations, runtime };
    });
    trackEvent(stopped ? "agent_turn_cancelled" : result.code === 0 ? "agent_turn_completed" : "agent_turn_failed", {
      agent: agentId,
      exit_code: result.code,
      execution_target: executionTarget,
    });
    try {
      if (executionTarget === "local" && !pendingTarget(get(), "vps")) await get().refreshAll();
    } finally {
      replyExecutionTargets.delete(replyId);
      if (executionTarget === "vps" && !pendingTarget(get(), "vps")) {
        void refreshLocalNextctlMetadata();
      }
      for (const [queuedAgentId, runtime] of Object.entries(get().runtime)) {
        if (runtime.ready && runtime.queue.length) get().startConsumer(queuedAgentId);
      }
    }
  };

  return {
  authed: false,
  accountEmail: undefined,
  accountOwnerId: undefined,
  checking: true,
  startupPhase: "local",
  startupError: undefined,
  isLoggingIn: false,
  profiles: [],
  pendingProfileCreateRequests: [],
  personalProxies: [],
  proxyCountries: [],
  statuses: {},
  profileSessions: {},
  profileIdentities: {},
  profileChatOwners: {},
  profileSearch: "",
  isRefreshing: false,
  agentId: localStorage.getItem("lastAgent") ?? "claude",
  runtime: initRuntimes(),
  conversations: [],
  workspaces: [],
  activeWorkspaceId: localStorage.getItem("activeWorkspaceId") ?? undefined,
  workspacesLoaded: false,
  workspaceSetupRequired: false,
  workspaceSetupAuto: "pending",
  activeConvId: {},
  tab: "chat",
  skillState: {},
  skillCategories: REPOSITORY_SKILL_CATEGORIES,
  watchedProfiles: [],
  watchReports: {},
  watchPublishers: {},
  watchlistRuns: [],
  watchlistTransports: {},
  watchlistProfiles: {},
  watchlistDevices: {},
  watchlistSignIns: {},
  xReplyState: emptyXReplyState(),
  xReplyBusy: false,
  xReplySignInNeeded: false,
  scheduledRuns: [],
  customScripts: [],
  localSkills: [],
  localSkillSync: {},
  privateCloudSkills: [],
  appliedScripts: [],
  scriptSync: {},
  usageHistory: [],
  showOnboarding: false,
  onboardingStepIndex: 0,
  onboardingReturnPending: false,
  sidebarWidth: Number(localStorage.getItem("sidebarWidth") ?? 300),
  sidebarCollapsed: localStorage.getItem("sidebarCollapsed") === "true",
  chatListCollapsed: localStorage.getItem("chatListCollapsed") === "true",
  terminalChat: localStorage.getItem("terminalChat") === "true",
  dashboardKeyPromptOpen: false,
  trafficGatePromptOpen: false,
  githubStarPromptOpen: false,
  accountPairing: undefined,
  nextctlVersion: "",
  nextctlUpdating: false,
  nextctlSupportsSkill: true,
  nextctlAvailable: true,
  appActive: true,
  connectAnnounced: new Set(),
  workingDir: "",
  projectRevisions: {},
  workspaceRevisions: {},
  projectsSyncing: false,
  loggingOut: false,

  conversationsForAgent: (agentId) =>
    get().conversations
      .filter((c) => {
        if (c.agent !== agentId) return false;
        const activeWorkspaceId = get().activeWorkspaceId;
        const hasActiveWorkspace = get().workspaces.some((workspace) => workspace.id === activeWorkspaceId);
        return !hasActiveWorkspace || c.workspaceId === activeWorkspaceId;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt),

  activeConversation: () => {
    const s = get();
    const id = s.activeConvId[s.agentId];
    if (id) {
      const selected = s.conversations.find((conversation) =>
        conversation.id === id && (!s.activeWorkspaceId || conversation.workspaceId === s.activeWorkspaceId),
      );
      if (selected?.agent === s.agentId) return selected;
    }
    return get().conversationsForAgent(s.agentId)[0];
  },

  agentReady: () => {
    const runtime = get().runtime[get().agentId];
    return !!runtime?.ready && runtime.loggedIn !== false;
  },
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
    if (get().appliedScripts.some((script) => script.id === entryId)) return "installed";
    const value = get().skillState[skillKey(get().agentId, entryId)];
    return value === "applying" || value === "installed" || value === "failed" ? value : "idle";
  },
  skillApplyError: (entryId) => get().skillState[skillKey(get().agentId, `${entryId}:error`)],

  bootstrap: async () => {
    if (didBootstrap) return;
    didBootstrap = true;
    const startedAt = performance.now();
    trackEvent("bootstrap_started");
    set({ checking: true, startupPhase: "local", startupError: undefined });
    // Cover the entire foreground startup, including disk reads and CLI
    // resolution. A timeout offers recovery, never a false signed-out state.
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<void>((resolve) => {
      startupTimer = setTimeout(() => {
        set({ checking: false, startupError: get().startupPhase === "local"
          ? "Loading saved projects is taking longer than expected. You can restart the check."
          : "Account verification is taking longer than expected. You can restart the check." });
        trackEvent("bootstrap_foreground_timeout", { phase: get().startupPhase });
        resolve();
      }, BOOTSTRAP_FOREGROUND_WAIT_MS);
    });
    const initialize = (async () => {
      const [rawConvs, rawWorkspaces, rawSchedules, rawScripts, rawLocalSkills, rawAppliedScripts, rawHistory, rawWatched, rawWatchlistRuns, rawWatchlistTransports, rawWatchlistProfiles, rawWatchlistDevices, rawXReply, wd] = await Promise.all([
        loadJson<Conversation[]>("conversations.json", []),
        loadJson<Workspace[]>("workspaces.json", []),
        loadJson<ScheduledRun[]>("scheduled-runs.json", []),
        loadJson<CustomScript[]>("custom-scripts.json", []),
        loadJson<BrowserWorkflowSkill[]>("local-skills.json", []),
        loadJson<SkillEntry[]>("applied-scripts.json", []),
        loadJson<UsageSnapshot[]>("usage-history.json", []),
        loadJson<WatchedProfile[]>("watched-profiles.json", []),
        loadJson<WatchlistRun[]>("watchlist-runs.json", []),
        loadJson<Record<string, string>>("watchlist-transports.json", {}),
        loadJson<Record<string, string>>("watchlist-profiles.json", {}),
        loadJson<Record<string, MultiloginProfileSelection>>("watchlist-devices.json", {}),
        loadJson<unknown>(X_REPLY_STATE_FILE, null),
        invoke<string>("working_directory").catch(() => ""),
      ]);
      const convs = rawConvs.map(normalizeConversation);
      const workspaces = rawWorkspaces.filter((item) => item?.id && item?.name).map((item) => ({
        ...item,
        profileNames: Array.isArray(item.profileNames) ? item.profileNames : [],
        profileToolsets: item.profileToolsets ?? {},
        profileProxyIds: item.profileProxyIds ?? {},
        createdAt: Number(item.createdAt) || now(),
        updatedAt: Number(item.updatedAt) || now(),
      }));
      let activeWorkspaceId = localStorage.getItem("activeWorkspaceId") ?? undefined;
      if (!workspaces.some((item) => item.id === activeWorkspaceId)) activeWorkspaceId = workspaces[0]?.id;
      const schedules = rawSchedules.map(normalizeSchedule);
      const scripts = rawScripts.map(normalizeScript);
      const history = rawHistory.map(normalizeUsage);
      const activeConvId: Record<string, string> = {};
      for (const a of AGENTS) {
        const stored = localStorage.getItem(activeConversationStorageKey(a.id, activeWorkspaceId));
        const candidates = convs
          .filter((conversation) => conversation.agent === a.id && (!activeWorkspaceId || conversation.workspaceId === activeWorkspaceId))
          .sort((left, right) => right.updatedAt - left.updatedAt);
        const selected = candidates.find((conversation) => conversation.id === stored) ?? candidates[0];
        if (selected) activeConvId[a.id] = selected.id;
      }
      set({
        conversations: convs,
        workspaces,
        activeWorkspaceId,
        activeConvId,
        scheduledRuns: schedules,
        customScripts: scripts,
        localSkills: rawLocalSkills.map(normalizeWorkflowSkill),
        appliedScripts: rawAppliedScripts.filter((entry) => entry?.selector?.kind === "script"),
        usageHistory: history,
        watchedProfiles: normalizeWatchedProfiles(rawWatched),
        watchlistRuns: normalizeWatchlistRuns(rawWatchlistRuns),
        watchlistTransports: rawWatchlistTransports ?? {},
        watchlistProfiles: rawWatchlistProfiles ?? {},
        watchlistDevices: rawWatchlistDevices ?? {},
        xReplyState: normalizeXReplyState(rawXReply),
        workingDir: wd,
      });
      get().reconcileQueues();
      set({ startupPhase: "account" });

      await listen<[string, string]>("project:host-created", (event) => {
        const [, workspaceId] = event.payload;
        if (get().authed && get().workspaces.some((workspace) => workspace.id === workspaceId)) {
          void (async () => {
            for (let attempt = 0; attempt < 30 && get().projectsSyncing; attempt += 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
            await get().syncProjects();
          })().catch((error) => console.warn("[AGENT_PROJECT_SYNC_FAILED]", error));
        }
      });

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
          // Persist on completion, not on every chunk — writing the
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
          // Persisted on completion, not per chunk — see agent:chunk.
          return { conversations };
        });
      });

      await listen<[string, number, string, string]>("agent:done", (e) => {
        const [replyId, code, stderr, stdout] = e.payload;
        void finishAgentRun(replyId, { code, stderr, stdout });
      });
      await listen<AuthDeepLinkPayload>("auth:deeplink", (event) => {
        const pairing = get().accountPairing;
        if (!pairing) return;
        if (event.payload.pairingId && event.payload.pairingId !== pairing.pairingId) return;
        trackEvent("account_pairing_deeplink", { status: event.payload.status || "unknown" });
        void get().pollAccountPairing();
      });

      const authenticated = !pendingTarget(get(), "vps")
        ? await refreshLocalNextctlMetadata()
        : false;

      // The caches loaded above were hydrated before identity was known
      // (a clean logout wipes them, but a crash or a credential change
      // outside logout() would not). If they were stamped for a different
      // account, drop them now — before anything treats this session as
      // authed: a workspace mutation or the queue reconciler can call
      // syncProjects() as soon as `authed` flips true, which would push the
      // stale cache at the backend under the new account's key.
      if (authenticated) await guardAgainstForeignAccountCache();
      set({ authed: authenticated, checking: false, startupError: undefined });
      get().startTimers();

      // These operations have their own status UI and cannot hold the splash.
      void get().authorizeAgent({ deferMissingNextctlPrompt: true, suggestInstalledAlternative: true });
      if (!hasCompletedCurrentOnboarding(localStorage)) set({ showOnboarding: true });
      void (async () => {
        if (authenticated && !pendingTarget(get(), "vps")) {
          await get().syncProjects().catch(() => {});
          await get().refreshAll();
        }
        get().reconcileQueues();
      })().catch(() => {
        trackEvent("bootstrap_sync_failed");
      }).finally(() => {
        // Discover running profiles before an automatic update replaces files.
        void get().tickNextctlDailyUpdate().catch(() => {});
      });
      trackTiming("bootstrap_completed", startedAt, {
        nextctl_available: get().nextctlAvailable,
        profile_count: get().profiles.length,
        conversation_count: get().conversations.length,
      });
    })().catch(() => {
      set({ checking: false, startupError: "Nextbrowser couldn't finish startup. Restart the check to try again." });
      trackTiming("bootstrap_failed", startedAt, { phase: get().startupPhase });
    }).finally(() => {
      if (startupTimer) clearTimeout(startupTimer);
    });
    await Promise.race([initialize, deadline]);
  },

  startTimers: () => {
    if (proxyTimer) clearInterval(proxyTimer);
    proxyTimer = setInterval(() => {
      if (!get().appActive || !get().authed || pendingTarget(get(), "vps")) return;
      get().loadProxy().catch(() => {});
      get().loadDefaultSession().catch(() => {});
    }, PROXY_REFRESH_MS);
    if (profileStatusTimer) clearInterval(profileStatusTimer);
    profileStatusTimer = setInterval(() => {
      void get().refreshProfileStatuses();
    }, PROFILE_STATUS_REFRESH_MS);
    if (scheduleTimer) clearInterval(scheduleTimer);
    scheduleTimer = setInterval(() => {
      void get().tickScheduledRuns();
      void get().tickWatchlistRuns();
    }, SCHEDULE_TICK_MS);
    if (nextctlDailyUpdateTimer) clearInterval(nextctlDailyUpdateTimer);
    nextctlDailyUpdateTimer = setInterval(
      () => void get().tickNextctlDailyUpdate(),
      NEXTCTL_DAILY_UPDATE_POLL_MS,
    );
    if (profileCreateRequestTimer) clearInterval(profileCreateRequestTimer);
    profileCreateRequestTimer = setInterval(
      () => void get().pollProfileCreateRequests(),
      PROFILE_CREATE_REQUEST_POLL_MS,
    );
    void get().pollProfileCreateRequests();
  },

  refreshProfileStatuses: async () => {
    if (!get().appActive || !get().authed || !get().nextctlAvailable || pendingTarget(get(), "vps")) return;
    if (profileStatusRefreshInFlight) return;
    if (Object.values(get().statuses).some((status) => ["starting", "stopping", "rotating"].includes(status))) return;
    profileStatusRefreshInFlight = true;
    try {
      await Promise.all([
        get().loadProfiles(),
        get().loadDefaultSession(),
      ]);
    } finally {
      profileStatusRefreshInFlight = false;
    }
  },

  tickNextctlDailyUpdate: async () => {
    // A development build may intentionally point at a locally compiled nbc.
    // Never replace that test binary with the latest published release while
    // the app is running under Vite/Electron development mode.
    if (import.meta.env.DEV) return;
    // An incompatible CLI reports nextctlAvailable=false but still needs a
    // reinstall, so let the tick through for that case.
    if (!get().nextctlAvailable && !get().nextctlCompatibilityError) return;
    if (get().nextctlUpdating) return;
    if (pendingTarget(get(), "vps")) return;
    // `nextctl update` also refreshes the browser runtime and agent assets. Do
    // not mutate either while a browser profile is running/transitioning or an
    // agent turn is using them; the one-minute poll will retry once idle.
    const browserSessionActive = [
      get().defaultSession?.status,
      ...Object.values(get().statuses),
    ].some((status) => status != null && !["stopped", "unknown"].includes(status));
    if (browserSessionActive || get().anyAgentRunning()) return;
    if (get().nextctlCompatibilityError) {
      // The old executable cannot run anything, so reinstall it now instead of
      // waiting for the daily window. Respect an already-scheduled retry.
      if (!nextctlUpdateRetryTimer) void get().checkNextctlUpdate();
      return;
    }
    const state = await loadJson<NextctlUpdateState>(NEXTCTL_UPDATE_STATE_FILE, {});
    if (pendingTarget(get(), "vps")) return;
    // Wait out a rate-limit backoff before trying again.
    if (Number(state.rateLimitedUntil ?? 0) > now()) return;
    const lastAutoCheckAt = Number(state.lastAutoCheckAt ?? 0);
    // A fresh install has just resolved or downloaded nextctl during bootstrap.
    // Treat that as the first successful check instead of immediately running
    // `nextctl update`, which can race with the user's first profile launch and
    // with Clawbrowser runtime installation (especially on Windows).
    if (lastAutoCheckAt <= 0) {
      await saveJson(NEXTCTL_UPDATE_STATE_FILE, { lastAutoCheckAt: now() });
      return;
    }
    if (now() - lastAutoCheckAt < NEXTCTL_DAILY_UPDATE_MS) return;
    // checkNextctlUpdate records the attempt (and any rate-limit backoff).
    await get().checkNextctlUpdate();
  },

  tickScheduledRuns: async () => {
    if (!get().authed) return;
    const d = new Date();
    const hour = d.getHours();
    const minute = d.getMinutes();
    for (const run of get().scheduledRuns) {
      if (!scheduleDue(run, d.getTime())) continue;
      const scheduledConversation = run.conversationId
        ? get().conversations.find((conversation) => conversation.id === run.conversationId)
        : undefined;
      const scheduledTarget = executionTargetForTurn(scheduledConversation);
      if ((scheduledTarget === "vps" && queuedTarget(get(), "local")) ||
          (scheduledTarget === "local" && pendingTarget(get(), "vps"))) continue;
      if (!run.intervalMinutes && run.lastFiredAt) {
        const last = new Date(run.lastFiredAt);
        if (
          last.toDateString() === d.toDateString() &&
          last.getHours() === hour &&
          last.getMinutes() === minute
        )
          continue;
      }
      const runs = get().scheduledRuns.map((r) =>
        r.id === run.id ? { ...r, lastFiredAt: now(), lastError: undefined } : r,
      );
      set({ scheduledRuns: runs });
      persistSchedules(runs);
      trackEvent("scheduled_run_fired", {
        agent: run.agent,
        has_conversation: !!run.conversationId,
      });
      const prev = get().agentId;
      const previousWorkspace = get().activeWorkspaceId;
      const previousActiveConversations = get().activeConvId;
      const previousProfile = get().selectedProfile;
      const previousTerminalChat = get().terminalChat;
      if (scheduledTarget === "vps") vpsSetupReservations += 1;
      try {
        const workspaceId = run.workspaceId ?? scheduledConversation?.workspaceId;
        const scheduledWorkspace = workspaceId ? get().workspaces.find((workspace) => workspace.id === workspaceId) : undefined;
        if (workspaceId && !scheduledWorkspace) throw new Error("The scheduled workspace no longer exists.");
        const scheduledProfile = resolveScheduledProfile(run, scheduledWorkspace?.profileNames ?? []);
        if (workspaceId) get().selectWorkspace(workspaceId);
        if (scheduledTarget === "vps") await waitForLocalNextctlIdle(get);
        get().switchAgent(run.agent);
        if (!get().agentReady()) {
          await get().authorizeAgent({ skipNextctlSetup: scheduledTarget === "vps" });
        }
        let cid = run.conversationId;
        if (!cid || !get().conversations.some((c) => c.id === cid && c.agent === run.agent)) {
          cid = get().newChat();
          const title = run.title || "Scheduled";
          get().renameConversation(cid, title);
        } else {
          get().selectConversation(cid);
        }
        if (scheduledTarget === "vps") {
          set((state) => {
            const conversations = state.conversations.map((conversation) =>
              conversation.id === cid
                ? {
                    ...conversation,
                    executionTarget: "vps" as const,
                    vpsConnectionInstructions: conversation.vpsConnectionInstructions ||
                      vpsConnectionInstructions(run.prompt) || undefined,
                    updatedAt: now(),
                  }
                : conversation,
            );
            persistConvs(conversations);
            return { conversations };
          });
        }
        enqueueWithTarget(run.prompt, undefined, cid, [], scheduledTarget, undefined, { name: scheduledProfile });
      } catch (error) {
        // One failing schedule must not abort the rest of this tick. The timer
        // calls this without awaiting, so swallow here instead of letting an
        // unhandled rejection surface as a global renderer error.
        console.warn("[SCHEDULED_RUN_FAILED]", run.id, error);
        const failedRuns = get().scheduledRuns.map((item) => item.id === run.id ? { ...item, lastError: error instanceof Error ? error.message : String(error) } : item);
        set({ scheduledRuns: failedRuns });
        persistSchedules(failedRuns);
      } finally {
        if (scheduledTarget === "vps") vpsSetupReservations = Math.max(0, vpsSetupReservations - 1);
        get().switchAgent(prev);
        if (previousWorkspace) get().selectWorkspace(previousWorkspace);
        set({ activeConvId: previousActiveConversations, selectedProfile: previousProfile, terminalChat: previousTerminalChat });
        if (!pendingTarget(get(), "vps")) {
          for (const [queuedAgentId, runtime] of Object.entries(get().runtime)) {
            if (runtime.ready && runtime.queue.length) get().startConsumer(queuedAgentId);
          }
        }
      }
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
        let conversationChanged = false;
        const msgs = conv.messages.map((m, i, arr) => {
          if (m.role !== "assistant") return m;
          if (m.status === "streaming" && r.runningReplyId !== m.id) {
            conversationChanged = true;
            const partial = m.text.trim();
            return {
              ...m,
              status: "cancelled" as const,
              text: partial ? `${partial}\n[stopped]` : "[stopped]",
              stalled: false,
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
                executionTarget: executionTargetForTurn(conv),
              });
              return m;
            }
            conversationChanged = true;
            return {
              ...m,
              status: "failed" as const,
              text: internalError("We couldn't restore this queued message.", "QUEUED_MESSAGE_RESTORE_FAILED"),
            };
          }
          return m;
        });
        return conversationChanged ? { ...conv, messages: msgs, updatedAt: now() } : { ...conv, messages: msgs };
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
    if (!rt?.ready || rt.loggedIn === false || rt.isConsuming || !rt.queue.length) return;
    const nextTarget = rt.queue[0]?.executionTarget;
    if (nextTarget === "vps" && (get().nextctlUpdating || runningTarget(get(), "local"))) return;
    if (nextTarget === "local" && pendingTarget(get(), "vps")) return;
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], isConsuming: true },
      },
    }));
    void (async () => {
      while (true) {
        if (!get().runtime[agentId]?.queue.length) break;
        await get().recheckLogin(agentId);
        if (get().runtime[agentId]?.loggedIn === false) break;
        const nextTarget = get().runtime[agentId]?.queue[0]?.executionTarget;
        if (nextTarget === "vps" && runningTarget(get(), "local")) break;
        if (nextTarget === "local" && pendingTarget(get(), "vps")) break;
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
      get().setMessageStatus(
        item.conversationId,
        item.replyId,
        "failed",
        "Connect the selected agent and try again.",
      );
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
    replyExecutionTargets.set(item.replyId, item.executionTarget);
    const itemConversation = get().conversations.find((conversation) => conversation.id === item.conversationId);
    const itemWorkspace = get().workspaces.find((workspace) => workspace.id === itemConversation?.workspaceId);
    const queuedProfileMissing = item.selectedProfile && !(itemWorkspace?.profileNames ?? []).includes(item.selectedProfile);
    replyProfileBaselines.set(item.replyId, new Set(
      (itemWorkspace?.profileNames ?? []).filter((profile) => get().statuses[profile] === "running"),
    ));
    get().setMessageStatus(item.conversationId, item.replyId, "streaming");
    let awaitingProfileStart = false;
    try {
      // Persist the dispatched state before spawning the agent. Otherwise an
      // app restart can restore the older queued snapshot and send the same
      // user prompt a second time.
      await flushConversations();
      if (item.executionTarget === "local") {
        if (queuedProfileMissing) throw new Error("The selected browser profile is no longer in this workspace.");
        const pendingNames = (itemWorkspace?.profileNames ?? []).filter((name) => pendingProfileStarts.has(name));
        awaitingProfileStart = pendingNames.length > 0;
        await Promise.all(pendingNames.map((name) => pendingProfileStarts.get(name)));
        if (pendingNames.some((name) => get().statuses[name] !== "running")) {
          throw new Error("Profile startup did not complete");
        }
      }
    } catch {
      const cancelled = get().runtime[agentId]?.pendingStop;
      replyExecutionTargets.delete(item.replyId);
      replyProfileBaselines.delete(item.replyId);
      get().setMessageStatus(
        item.conversationId,
        item.replyId,
        cancelled ? "cancelled" : "failed",
        cancelled ? "Request cancelled before the agent started." : queuedProfileMissing
          ? "The selected browser profile is no longer in this workspace. Choose a profile and retry."
          : awaitingProfileStart
          ? "The request was not sent because the browser profile did not pass its startup check. Fix the connection and start the profile again."
          : "The request was not sent because its state could not be saved.",
      );
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], runningReplyId: undefined, pendingStop: false },
        },
      }));
      return;
    }
    const currentRuntime = get().runtime[agentId];
    if (currentRuntime?.pendingStop || currentRuntime?.runningReplyId !== item.replyId) {
      replyExecutionTargets.delete(item.replyId);
      replyProfileBaselines.delete(item.replyId);
      get().setMessageStatus(item.conversationId, item.replyId, "cancelled", "Request cancelled before the agent started.");
      if (currentRuntime?.runningReplyId === item.replyId) {
        set((s) => ({ runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], runningReplyId: undefined, pendingStop: false } } }));
      }
      return;
    }
    trackEvent("agent_turn_started", {
      agent: agentId,
      has_profile: !!get().selectedProfile,
      queue_depth: get().runtime[agentId]?.queue.length ?? 0,
      execution_target: item.executionTarget,
    });
    const conversationWorkspaceId = itemConversation?.workspaceId;
    const multiloginSelection = multiloginSelectionForWorkspace(conversationWorkspaceId);
    const directMultiloginStart = item.executionTarget === "local"
      && !!multiloginSelection
      && isMultiloginStartRequest(item.rawText);
    if (item.executionTarget === "local" && !directMultiloginStart) get().startSessionPoll();

    if (directMultiloginStart && multiloginSelection) {
      const finish = (status: ChatMessage["status"], text: string) => {
        replyExecutionTargets.delete(item.replyId);
        replyProfileBaselines.delete(item.replyId);
        set((state) => {
          const runtime = {
            ...state.runtime,
            [agentId]: {
              ...state.runtime[agentId],
              runningReplyId: undefined,
              pendingStop: false,
            },
          };
          const completedAt = now();
          const conversations = state.conversations.map((conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) =>
              message.id === item.replyId
                ? { ...message, status, text, stalled: false }
                : message,
            ),
            ...(conversation.id === item.conversationId ? { updatedAt: completedAt } : {}),
          }));
          persistConvs(conversations);
          return { conversations, runtime };
        });
      };
      try {
        const command = multiloginSelection.kind === "mobile"
          ? ["--runtime", "multilogin", "mobile", "start", multiloginSelection.id, "--no-wait"]
          : [
            "--runtime", "multilogin",
            "--profile", multiloginSessionName(multiloginSelection),
            "--multilogin-profile-id", multiloginSelection.id,
            "start",
          ];
        if (multiloginSelection.folderId) {
          command.push("--multilogin-folder-id", multiloginSelection.folderId);
        }
        const status = await nextctlJson<{ status_name?: string }>(command);
        finish("done", multiloginStartReply(
          multiloginSelection.name,
          multiloginSelection.kind,
          status.status_name ?? "starting",
          /[А-Яа-яЁё]/.test(item.rawText),
        ));
        set({ tab: "live" });
        trackEvent("multilogin_profile_start_completed", { direct: true, kind: multiloginSelection.kind });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const reconnect = /MULTILOGIN_TOKEN|automation token|unauthorized|forbidden|\b40[13]\b/i.test(detail);
        const message = /[А-Яа-яЁё]/.test(item.rawText)
          ? reconnect
            ? "Не удалось запустить cloud phone. Переподключите Multilogin в Connectors и повторите."
            : `Не удалось запустить cloud phone: ${detail}`
          : reconnect
            ? "Could not start the cloud phone. Reconnect Multilogin in Connectors and try again."
            : `Could not start the cloud phone: ${detail}`;
        finish("failed", message);
        trackEvent("multilogin_profile_start_failed", { direct: true, kind: multiloginSelection.kind });
      }
      return;
    }

    const activeProfile = item.selectedProfile;
    const recording = activeAutomationRecording();
    const recorderContext = recording?.phase === "recording" && recording.workspaceId === conversationWorkspaceId
      ? `\n\nNextbrowser Recorder is active for this task. The final reusable dataset must come from a deterministic browser tool call, not from reading state and transforming it only in your reasoning. Prefer navigate_extract when the URL, row container, and fields are known because it combines navigation, readiness, and extraction in one recorded call. Otherwise, after using state once to discover the page, call extract or paginate_extract with the exact fields and limit. Do not use evaluate for selector or HTML diagnostics: state is the discovery tool. If the dynamic page cannot be represented by extraction tools, call evaluate once with a read-only expression that returns the exact structured dataset; it must not read cookies/storage, use network APIs, click/submit, or mutate the DOM. Select targets by stable content, attributes, or headers instead of a numeric querySelectorAll position, and make the expression throw unless the requested number of rows and requested fields are populated. If the final dataset comes from a public JSON endpoint, use its replayable GET form when available: open that exact API URL in the listed browser profile, then evaluate the JSON body. Never leave the final request hidden in curl, fetch, or an uncaptured shell action, because Recorder cannot replay it. If the user requested an Artifact Center file, pass that deterministic call's returned dataset to nextbrowser.save_artifact once. Do not finish with state as the only data-collection step.`
      : "";
    const browserContext = browserProfileContext(
      get().workspaces,
      conversationWorkspaceId,
      activeProfile,
      multiloginSelection,
      get().statuses,
      get().profileIdentities,
    ) + recorderContext;
    const browserProfiles = (itemWorkspace?.profileNames ?? []).map((name) => ({
      name,
      runtime: itemWorkspace?.profileToolsets[name] ?? "clawbrowser",
      running: get().statuses[name] === "running",
      selected: activeProfile === name,
      ownerConversationId: get().profileChatOwners[name],
    }));
    const prompt = composePrompt(
      get().conversations,
      item.conversationId,
      item.replyId,
      item.rawText
        + privateSkillContext(get().localSkills, item.rawText)
        + browserContext,
      activeProfile,
      { nextctlAvailable: get().nextctlAvailable, executionTarget: item.executionTarget },
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

    try {
      const result = await invoke<AgentDone>("agent_run", {
        replyId: item.replyId,
        agentId,
        binary: a.binary,
        envVar: a.envVar,
        args,
        stdinText: stdin ?? null,
        workingDir: get().workingDir || null,
        conversationId: item.conversationId,
        workspaceId: conversationWorkspaceId,
        browserContext,
        browserProfiles,
        multiloginSelection,
      });
      await finishAgentRun(item.replyId, result);
    } catch {
      replyExecutionTargets.delete(item.replyId);
      get().appendToMessage(
        item.conversationId,
        item.replyId,
        `\n${internalError("We couldn't start the agent.", "AGENT_START_FAILED")}`,
      );
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

  failStep: (cid: string, mid: string, error: unknown) => {
    const text = preflightFailureMessage(error);
    set((s) => {
      const conversations = s.conversations.map((conversation) =>
        conversation.id === cid
          ? {
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.id === mid ? { ...message, text, status: "failed" as const } : message,
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
    sessionPollTimer = setInterval(async () => {
      if (!runningTarget(get(), "local")) {
        if (sessionPollTimer) clearInterval(sessionPollTimer);
        sessionPollTimer = null;
        sessionPollInFlight = false;
        return;
      }
      if (pendingTarget(get(), "vps") || sessionPollInFlight) return;
      sessionPollInFlight = true;
      try {
        await Promise.all([
          get().loadProfiles().catch(() => {}),
          get().loadDefaultSession().catch(() => {}),
        ]);
      } finally {
        sessionPollInFlight = false;
      }
    }, 5000);
  },

  login: async (key) => {
    const startedAt = performance.now();
    const apiKey = key.trim();
    trackEvent("dashboard_key_save_started");
    if (!apiKey) {
      set({ loginError: "Use browser sign-in to connect your account.", isLoggingIn: false });
      trackTiming("dashboard_key_save_failed", startedAt, { reason: "empty_key" });
      return;
    }
    set({ loginError: undefined, isLoggingIn: true });
    try {
      await finishAPIKeyLogin(apiKey);
      // This can be a re-authentication mid-session (e.g. a token expired,
      // reopening the sign-in modal) rather than a fresh launch — the
      // caches already in memory may belong to whatever account was
      // previously signed in here.
      await guardAgainstForeignAccountCache();
      await get().loadProxy();
      set({ authed: true, nextctlAvailable: true, accountPairing: undefined });
      get().startTimers();
      await get().refreshAll();
      await get().authorizeAgent();
      if (!hasCompletedCurrentOnboarding(localStorage)) set({ showOnboarding: true });
      trackEvent("login", { method: "dashboard_key" });
      trackTiming("dashboard_key_save_succeeded", startedAt);
    } catch {
      set({ loginError: internalError("We couldn't connect your account.", "ACCOUNT_CONNECT_FAILED") });
      trackTiming("dashboard_key_save_failed", startedAt);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  startAccountPairing: async () => {
    const startedAt = performance.now();
    trackEvent("account_pairing_started");
    set({ loginError: undefined, isLoggingIn: true });
    try {
      const response = await invoke<PairingStartResponse>("pairing_start", {
        apiBaseUrl,
        version: __APP_VERSION__,
        displayName: "Nextbrowser Desktop",
      });
      const verificationUrl = accountLoginURL(response.verification_url);
      set({
        accountPairing: {
          pairingId: response.pairing_id,
          verificationUrl,
          pollToken: response.poll_token,
          status: response.status as PairingPollResponse["status"],
          expiresAt: response.expires_at,
        },
      });
      await invoke<null>("open_external", { url: verificationUrl });
      trackTiming("account_pairing_opened", startedAt);
    } catch {
      set({ loginError: internalError("We couldn't start browser sign-in.", "ACCOUNT_SIGN_IN_START_FAILED") });
      trackTiming("account_pairing_failed", startedAt);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  reopenAccountPairing: async () => {
    const pairing = get().accountPairing;
    if (!pairing?.verificationUrl) return;
    trackEvent("account_pairing_reopened");
    await invoke<null>("open_external", { url: pairing.verificationUrl });
  },

  pollAccountPairing: async () => {
    const pairing = get().accountPairing;
    if (!pairing || get().isLoggingIn) return;
    set({ isLoggingIn: true, loginError: undefined });
    try {
      const result = await invoke<PairingPollResponse>("pairing_poll", {
        apiBaseUrl,
        pairingId: pairing.pairingId,
        pollToken: pairing.pollToken,
      });
      // The pairing this poll started for may have been cancelled and
      // replaced by a new one (e.g. for a different account) while the
      // request was in flight — cancelAccountPairing() does not, and
      // cannot, abort it. Applying a stale result here would clobber the
      // newer pairing's state and, worse, sign the session into whichever
      // account this stale poll belongs to.
      if (get().accountPairing?.pairingId !== pairing.pairingId) return;
      set({
        accountPairing: {
          ...pairing,
          status: result.status,
          expiresAt: result.expires_at,
        },
      });
      if (result.api_key) {
        await finishAPIKeyLogin(result.api_key);
        await refreshCompletedAccountPairing("pairing", true);
      } else if (result.status === "completed") {
        await refreshCompletedAccountPairing("pairing_json");
      } else if (result.status === "expired" || result.status === "rejected") {
        set({ loginError: result.status === "expired" ? "The sign-in request expired. Start again." : "The sign-in request was rejected." });
      }
    } catch {
      set({ loginError: internalError("We couldn't finish browser sign-in.", "ACCOUNT_SIGN_IN_FINISH_FAILED") });
    } finally {
      set({ isLoggingIn: false });
    }
  },

  cancelAccountPairing: () => {
    trackEvent("account_pairing_cancelled", { has_pairing: !!get().accountPairing });
    set({ accountPairing: undefined, loginError: undefined, isLoggingIn: false });
  },

  logout: async () => {
    // Do not switch accounts while local mutations are still only local. A
    // successful logout is the ownership boundary: flush and confirm the
    // current account's cloud state before credentials are cleared.
    // loggingOut gates the sync-status UI (App.tsx): background sync is
    // silent the rest of the time, but a sync blocking the account switch
    // is worth surfacing.
    set({ loggingOut: true });
    try {
      await flushConversations();
      const syncDeadline = now() + 30_000;
      while (get().projectsSyncing && now() < syncDeadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (get().projectsSyncing) throw new Error("Cloud sync is still in progress. Wait for it to finish before switching accounts.");
      await get().syncProjects();
      await invoke<null>("account_logout");
      await clearAccountEntityCache();
      clearActiveAutomationExecution();
      trackEvent("dashboard_logout");
      setAnalyticsUserId(undefined);
      if (proxyTimer) clearInterval(proxyTimer);
      if (profileStatusTimer) clearInterval(profileStatusTimer);
      if (scheduleTimer) clearInterval(scheduleTimer);
      if (sessionPollTimer) clearInterval(sessionPollTimer);
      if (profileCreateRequestTimer) clearInterval(profileCreateRequestTimer);
      if (nextctlUpdateRetryTimer) clearTimeout(nextctlUpdateRetryTimer);
      if (nextctlDailyUpdateTimer) clearInterval(nextctlDailyUpdateTimer);
      nextctlUpdateRetryTimer = null;
      nextctlDailyUpdateTimer = null;
      // Invalidate any account-scoped load that started before sign-out so it
      // cannot repopulate the cleared state (profiles, proxy, skills) later.
      profileRefreshGeneration += 1;
      accountEpoch += 1;
      proxyTimer = profileStatusTimer = scheduleTimer = sessionPollTimer = profileCreateRequestTimer = null;
      // These are keyed by profile name, not account. Leaving a stale entry
      // behind would let the next account's operation on a same-named profile
      // (e.g. both accounts happen to have a "work" profile) piggyback on this
      // account's now-irrelevant in-flight promise/epoch instead of starting
      // its own.
      profileOperationEpoch.clear();
      pendingProfileLaunches.clear();
      pendingProfileStarts.clear();
      verifyingProfileStarts.clear();
      // Agent CLI sign-in belongs to the local machine, not the NextBrowser
      // account. Clear its work queue, but retain the connection result so
      // signing back into NextBrowser does not demand the same agent setup.
      const runtime = initRuntimes();
      for (const [id, previous] of Object.entries(get().runtime)) {
        if (!runtime[id]) continue;
        runtime[id] = {
          ...runtime[id], ready: previous.ready, version: previous.version,
          loggedIn: previous.loggedIn,
        };
      }
      set({
        authed: false,
        accountEmail: undefined,
        runtime,
        connectAnnounced: new Set(),
        proxy: undefined,
        proxyWarning: undefined,
        dashboardKeyPromptOpen: false,
        trafficGatePromptOpen: false,
        githubStar: undefined,
        githubStarPromptOpen: false,
        accountPairing: undefined,
        profiles: [],
        pendingProfileCreateRequests: [],
        statuses: {},
        profileSessions: {},
        profileIdentities: {},
        personalProxies: [],
        conversations: [],
        workspaces: [],
        activeWorkspaceId: undefined,
        activeConvId: {},
        scheduledRuns: [],
        customScripts: [],
        localSkills: [],
        localSkillSync: {},
        appliedScripts: [],
        scriptSync: {},
        privateCloudSkills: [],
        skillCategories: REPOSITORY_SKILL_CATEGORIES,
        usageHistory: [],
        watchedProfiles: [],
        watchReports: {},
        watchPublishers: {},
        watchlistRuns: [],
        watchlistTransports: {},
        watchlistProfiles: {},
        watchlistDevices: {},
        watchlistSignIns: {},
        xReplyState: normalizeXReplyState(null),
        projectRevisions: {},
        workspaceRevisions: {},
        workspaceSetupRequired: false,
        workspaceSetupAuto: "pending",
        selectedProfile: undefined,
        defaultSession: undefined,
        skillState: {},
        tab: "chat",
      });
    } finally {
      set({ loggingOut: false });
    }
  },

  refreshAll: async () => {
    const startedAt = performance.now();
    trackEvent("refresh_all_started");
    set({ isRefreshing: true });
    try {
      await Promise.all([
        get().loadProxy().catch(() => {}),
        get().loadGitHubStar().catch(() => {}),
        get().loadProxyCountries().catch(() => {}),
        get().loadProfiles(),
        get().loadDefaultSession(),
        get().loadSkillCatalog(),
        get().loadPersonalProxies().catch(() => {}),
      ]);
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
    } catch (error) {
      trackTiming("proxy_refresh_failed", startedAt);
      throw error;
    } finally {
      set({ isRefreshing: false });
    }
  },

  refreshSessions: async () => {
    const startedAt = performance.now();
    trackEvent("profiles_refresh_started");
    set({ isRefreshing: true });
    try {
      await get().loadProfiles();
      await get().loadDefaultSession();
    } finally {
      set({ isRefreshing: false });
      trackTiming("profiles_refresh_completed", startedAt, { profile_count: get().profiles.length });
    }
  },

  loadProxy: async () => {
    const epoch = accountEpoch;
    const wrap = await nextctlJson<{ proxy_traffic: ProxyTraffic }>(["proxy-traffic"]);
    if (epoch !== accountEpoch) return;
    const p = wrap.proxy_traffic;
    const proxyWarning = proxyTrafficWarning(p);
    // A gated account is shown the full free allowance, so it has no way to
    // see its real limit run out: the first symptom is a profile that refuses
    // to start. Raise the prompt on the edge into "blocked" -- on the refresh
    // timer as well as at sign-in -- and leave it down while the gate stays
    // closed, so dismissing it does not bring it back on the next tick.
    const gateJustClosed =
      trafficGateState(p) === "blocked" && trafficGateState(get().proxy) !== "blocked";
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
    if (gateJustClosed) {
      // A GitHub sign-up lifts its limit with a star, not a Discord message.
      if (get().githubStar?.required) get().setGitHubStarPromptOpen(true);
      else get().setTrafficGatePromptOpen(true);
    }
    trackEvent("proxy_loaded", {
      proxy_state: p.state,
      limited: p.limited,
      percent_used_bucket: p.percent_used == null ? "unknown" : Math.min(100, Math.floor(p.percent_used / 10) * 10),
      has_limit: p.limit_bytes != null,
      warning: proxyWarning != null,
    });
  },

  loadProfiles: async () => {
    const epoch = accountEpoch;
    const generation = ++profileRefreshGeneration;
    try {
      const list = await nextctlJson<{ profiles: Profile[] }>(["profiles", "ls"]);
      if (generation !== profileRefreshGeneration || epoch !== accountEpoch) return;
      // Render the inventory without waiting for every browser status command.
      set({ profiles: list.profiles });
      const statuses: Record<string, string> = {};
      const profileSessions: Record<string, SessionStatus> = {};
      const profileIdentities: Record<string, ProxyIdentity> = {};
      const defaultIdentity = get().profileIdentities.__default;
      if (defaultIdentity) profileIdentities.__default = defaultIdentity;
      trackEvent("profiles_loaded", {
        profile_count: list.profiles.length,
        country_count: new Set(list.profiles.map((p) => p.country).filter(Boolean)).size,
      });
      for (const p of list.profiles) {
        if (generation !== profileRefreshGeneration || epoch !== accountEpoch) return;
        try {
          const runtime = runtimeForProfile(get().workspaces, p.name);
          const st = await nextctlJson<SessionStatus>(["status", "--profile", p.name, "--runtime", runtime]);
          statuses[p.name] = st.status;
          profileSessions[p.name] = st;
          if (st.status === "running") {
            // Status refresh must never navigate the user's active browser.
            // The old implementation called `verify` for every running
            // Clawbrowser profile, which could replace a page the agent was
            // actively scraping with clawbrowser://verify. Reuse the identity
            // captured at an explicit lifecycle action and fall back to the
            // saved country label without touching the page.
            const identity = get().profileIdentities[p.name]
              ?? (p.country ? { country: p.country } : undefined);
            if (identity) profileIdentities[p.name] = identity;
          } else if (get().profileIdentities[p.name]) {
            profileIdentities[p.name] = get().profileIdentities[p.name];
          }
        } catch {
          statuses[p.name] = "unknown";
          if (get().profileIdentities[p.name]) profileIdentities[p.name] = get().profileIdentities[p.name];
        }
      }
      if (generation !== profileRefreshGeneration || epoch !== accountEpoch) return;
      // A poll can start before a launch and finish while that launch is still
      // preparing the browser. Do not turn Starting into a misleading Stopped
      // (or Unknown), or Running before verification settles. A newer stop/remove
      // operation takes precedence through the operation epoch.
      for (const name of Object.keys(statuses)) {
        const launch = pendingProfileLaunches.get(name);
        if (launch !== undefined && launch === profileOperationEpoch.get(name)) {
          statuses[name] = get().statuses[name] === "stopping" ? "stopping" : "starting";
          if (profileSessions[name]) profileSessions[name] = { ...profileSessions[name], status: statuses[name] };
        }
      }
      const owner = get().accountOwnerId;
      if (owner && get().workspaces.some((workspace) => workspace.profileNames.some((name) => statuses[name] === "running"))) {
        localStorage.setItem(`guide:session-started:${owner}`, "1");
      }
      set({ statuses, profileSessions, profileIdentities });
    } catch {
      /* non-fatal */
    }
  },

  // Agents cannot create profiles directly inside a Nextbrowser workspace
  // (nbc's mcp_workspace_scope.go refuses profiles_create there); instead an
  // agent files a batch request with profiles_create_request, and the person
  // using the app approves or declines it here. Polled on a timer from
  // startTimers so a pending request surfaces as a modal without the user
  // having to do anything first.
  pollProfileCreateRequests: async () => {
    // Agent work can finish while the window is backgrounded. Keep requests
    // current so the approval is already visible when the user returns.
    if (!get().authed || !get().nextctlAvailable) return;
    if (profileCreateRequestPollInFlight) return;
    profileCreateRequestPollInFlight = true;
    try {
      const result = await nextctlJson<{ requests: ProfileCreateRequest[] }>(["profiles", "requests", "list", "--status", "pending"]);
      const awaitingAssignment = get().pendingProfileCreateRequests.filter((request) => request.status === "completed");
      set({ pendingProfileCreateRequests: [...awaitingAssignment, ...(result.requests ?? []).filter((request) => !awaitingAssignment.some((item) => item.id === request.id))].filter((request) => !request.workspace_id || get().workspaces.some((workspace) => workspace.id === request.workspace_id)) });
    } catch {
      /* non-fatal; retry on the next tick */
    } finally {
      profileCreateRequestPollInFlight = false;
    }
  },

  approveProfileCreateRequest: async (id: string) => {
    trackEvent("profile_create_request_approved", { request_id: id });
    // Throw on a non-zero exit; otherwise a failed approve looked successful,
    // dismissed the request, and it reappeared on the next poll with no error.
    const request = get().pendingProfileCreateRequests.find((item) => item.id === id);
    const workspaceId = request?.workspace_id || get().activeWorkspaceId;
    if (!workspaceId || !get().workspaces.some((workspace) => workspace.id === workspaceId)) throw new Error("The requesting workspace no longer exists.");
    const result = request?.status === "completed" ? request : await nextctlJson<ProfileCreateRequest>(["profiles", "requests", "approve", id]);
    if (result.status !== "completed") throw new Error(result.error || "Profile creation failed.");
    set({ pendingProfileCreateRequests: get().pendingProfileCreateRequests.map((item) => item.id === id ? { ...item, ...result, workspace_id: workspaceId } : item) });
    for (const name of result.created_profiles ?? []) {
      const runtime = result.runtime ?? request?.runtime ?? "clawbrowser";
      await get().assignProfileToProject(name, runtime, workspaceId);
      await invoke("workspace_profile_created", { workspaceId, name, runtime });
    }
    set({ pendingProfileCreateRequests: get().pendingProfileCreateRequests.filter((r) => r.id !== id) });
    await get().loadProfiles();
    if (get().activeWorkspaceId === workspaceId && result.created_profiles?.length) {
      get().selectProfile(result.created_profiles[0]);
    }
  },

  rejectProfileCreateRequest: async (id: string, reason?: string) => {
    trackEvent("profile_create_request_rejected", { request_id: id });
    await nextctlRunChecked(["profiles", "requests", "reject", id, ...(reason ? ["--reason", reason] : [])]);
    set({ pendingProfileCreateRequests: get().pendingProfileCreateRequests.filter((r) => r.id !== id) });
  },

  loadProxyCountries: async () => {
    const response = await nextctlJson<{ countries: RotationCountry[] }>(["proxy", "countries"]);
    const countries = (response.countries ?? [])
      .filter((country) => /^[A-Za-z]{2}$/.test(country.code) && country.name?.trim())
      .map((country) => ({ code: country.code.toUpperCase(), name: country.name.trim() }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    if (countries.length) set({ proxyCountries: countries });
  },

  loadDefaultSession: async () => {
    const epoch = accountEpoch;
    try {
      const st = await nextctlJson<SessionStatus>(["status"]);
      if (epoch !== accountEpoch) return;
      set({ defaultSession: st });
      // A passive refresh must not navigate the default browser to its
      // verification page. Keep any identity captured by an explicit launch
      // or rotate action and otherwise leave it unknown.
      trackEvent("default_profile_loaded", { status: st.status, backend: st.backend ?? "unknown" });
    } catch {
      trackEvent("default_profile_unavailable");
    }
  },

  loadSkillCatalog: async () => {
    if (!get().nextctlSupportsSkill) {
      set({ skillCategories: REPOSITORY_SKILL_CATEGORIES });
      return;
    }
    const epoch = accountEpoch;
    try {
      const catalog = await nextctlJson<{ categories: Array<{ id: string; title: string; icon: string; order: number; skills: SkillRef[] }> }>(["skill", "list"]);
      if (epoch !== accountEpoch) return;
      const backendScripts: SkillEntry[] = [];
      const privateCloudSkills: SkillEntry[] = [];
      const skillCategories: SkillCategory[] = catalog.categories.map((category) => ({
          id: category.id, title: category.title, icon: category.icon,
          blurb: `Published ${category.title.toLowerCase()} available from the backend.`,
          entries: category.skills
            .filter((ref) => ref.slug && ref.title && ref.selector && (ref.kind === "domain" || ref.kind === "captcha"))
            .map((ref): SkillEntry => ({
              id: ref.slug!, title: ref.title!, subtitle: ref.selector!, description: ref.description,
              category: category.id, categoryTitle: category.title,
              categoryIcon: category.icon, categoryOrder: category.order,
              selector: { kind: ref.kind === "domain" && ref.selector!.endsWith(".script") ? "script" : ref.kind!, value: ref.selector! },
              source: "backend",
            }))
            .filter((entry) => {
              if (category.id === "my-skills") {
                privateCloudSkills.push(entry);
                return false;
              }
              if (entry.selector.kind !== "script") return true;
              backendScripts.push(entry);
              return false;
            }),
        })).filter((category) => category.id !== "my-skills");
      const localApplied = get().appliedScripts.filter((entry) => !entry.id.startsWith("catalog:"));
      set({
        skillCategories: mergeSkillCategories(skillCategories),
        privateCloudSkills,
        appliedScripts: [...localApplied, ...backendScripts.map((entry) => ({ ...entry, id: `catalog:${entry.id}` }))],
      });
      trackEvent("skill_catalog_loaded", {
        category_count: catalog.categories.length,
        skill_count: catalog.categories.reduce((total, category) => total + category.skills.length, 0),
      });
    } catch {
      if (epoch !== accountEpoch) return;
      set({ skillCategories: REPOSITORY_SKILL_CATEGORIES });
      trackEvent("skill_catalog_failed");
    }
  },

  startDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("profile_start_requested", { scope: "default" });
    try {
      await prepareLocalSession({ statuses: {}, verifyOnly: true });
      await get().loadDefaultSession();
      const identity = await verifyProxyIdentity();
      if (identity) set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: identity } }));
      await get().loadProfiles();
      trackTiming("profile_start_completed", startedAt, { scope: "default", status: get().defaultSession?.status ?? "unknown" });
    } catch (error) {
      requestAccountSignIn(set, error);
      throw error;
    }
  },

  stopDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("profile_stop_requested", { scope: "default" });
    await nextctlRunChecked(["stop", "--format", "json"]);
    await get().loadDefaultSession();
    trackTiming("profile_stop_completed", startedAt, { scope: "default", status: get().defaultSession?.status ?? "unknown" });
  },

  rotateDefaultSession: async () => {
    const startedAt = performance.now();
    trackEvent("proxy_ip_change_requested", { scope: "default_profile" });
    trackEvent("profile_rotate_requested", { scope: "default" });
    try {
      await nextctlRunChecked(["rotate", "--format", "json"]);
      await get().loadDefaultSession();
      await get().loadProxy().catch(() => {});
      const after = await verifyProxyIdentity();
      if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: after } }));
      trackTiming("proxy_ip_change_completed", startedAt, { scope: "default_profile" });
      trackTiming("profile_rotate_completed", startedAt, { scope: "default" });
    } catch (error) {
      requestAccountSignIn(set, error);
      throw error;
    }
  },

  rotateDefaultSessionCountry: async (country) => {
    const startedAt = performance.now();
    trackEvent("proxy_country_change_requested", { scope: "default_profile", country });
    trackEvent("profile_rotate_requested", { scope: "default", country });
    try {
      await nextctlRunChecked(["rotate", "--country", country, "--verify", "--format", "json"]);
      await get().loadDefaultSession();
      await get().loadProxy().catch(() => {});
      const after = await verifyProxyIdentity();
      const identity = after ?? { country };
      set((s) => ({ profileIdentities: { ...s.profileIdentities, __default: identity } }));
      trackTiming("proxy_country_change_completed", startedAt, { scope: "default_profile", country });
      trackTiming("profile_rotate_completed", startedAt, { scope: "default", country });
    } catch (error) {
      requestAccountSignIn(set, error);
      throw error;
    }
  },

  startProfile: (n) => {
    const existing = pendingProfileStarts.get(n);
    if (existing) return existing;
    verifyingProfileStarts.add(n);
    const pending = (async () => {
      const startedAt = performance.now();
      trackEvent("profile_start_requested", { scope: "named" });
      const operation = nextProfileOperation(n);
      const ownerId = get().activeConversation()?.id;
      set((s) => ({
        statuses: { ...s.statuses, [n]: "starting" },
        profileChatOwners: ownerId ? { ...s.profileChatOwners, [n]: ownerId } : s.profileChatOwners,
      }));
      try {
        const runtime = runtimeForProfile(get().workspaces, n);
        const profile = get().profiles.find((item) => item.name === n);
        pendingProfileLaunches.set(n, operation);
        await prepareLocalSession({
          selectedProfile: n, runtime, statuses: {}, verifyOnly: true,
          proxyExpected: profile?.proxy_mode !== "direct",
          shouldContinue: () => profileOperationEpoch.get(n) === operation,
        }).finally(() => {
          if (pendingProfileLaunches.get(n) === operation) pendingProfileLaunches.delete(n);
        });
        if (profileOperationEpoch.get(n) !== operation) return;
        verifyingProfileStarts.delete(n);
        if (get().accountOwnerId) localStorage.setItem(`guide:session-started:${get().accountOwnerId}`, "1");
        await get().loadProfiles();
        settleTransientStatus(n, "starting");
        trackTiming("profile_start_completed", startedAt, { scope: "named", status: get().statuses[n] ?? "unknown" });
      } catch (error) {
        if (profileOperationEpoch.get(n) !== operation) return;
        verifyingProfileStarts.delete(n);
        await get().loadProfiles().catch(() => undefined);
        // Never reinterpret a live process as a successful verification.
        set((s) => {
          const profileChatOwners = { ...s.profileChatOwners };
          delete profileChatOwners[n];
          return { statuses: { ...s.statuses, [n]: /could not stop/i.test(error instanceof Error ? error.message : String(error)) ? "unknown" : "stopped" }, profileChatOwners };
        });
        if (/command cancelled/i.test(error instanceof Error ? error.message : String(error))) return;
        requestAccountSignIn(set, error);
        // A launch refused for exhausted traffic means the gate just closed:
        // refresh the allocation so Proxy usage shows it as paused right away.
        if (isProxyTrafficExhaustedError(error)) {
          // The user just hit the closed gate head-on, so say why even when the
          // prompt was dismissed earlier in this session.
          void get().refreshProxyData()
            .then(() => {
              if (trafficGateState(get().proxy) === "blocked") get().setTrafficGatePromptOpen(true);
            })
            .catch(() => undefined);
        }
        throw error;
      }
    })();
    pendingProfileStarts.set(n, pending);
    const clear = () => {
      if (pendingProfileStarts.get(n) === pending) pendingProfileStarts.delete(n);
      verifyingProfileStarts.delete(n);
    };
    void pending.then(clear, clear);
    return pending;
  },

  stopProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("profile_stop_requested", { scope: "named" });
    const operation = nextProfileOperation(n);
    const pendingStart = pendingProfileStarts.get(n);
    set((s) => ({ statuses: { ...s.statuses, [n]: "stopping" } }));
    await invoke("nextctl_cancel", { requestId: `profile-start:${n}` }).catch(() => undefined);
    await pendingStart?.catch(() => undefined);
    const runtime = runtimeForProfile(get().workspaces, n);
    try {
      await nextctlRunChecked(["stop", "--profile", n, "--runtime", runtime, "--format", "json"]);
    } catch (error) {
      // A user may close the browser window directly. Refresh the authoritative
      // session state and treat stopping an already-closed profile as success.
      await get().loadProfiles().catch(() => undefined);
      if (get().statuses[n] !== "stopped") {
        // If the CLI could not confirm a status either, do not leave the
        // transient "stopping" marker, which pauses every profile's polling.
        set((s) => (s.statuses[n] === "stopping" ? { statuses: { ...s.statuses, [n]: "unknown" } } : {}));
        throw error;
      }
    }
    await get().loadProfiles();
    settleTransientStatus(n, "stopping");
    if (profileOperationEpoch.get(n) !== operation) return;
    set((s) => {
      const profileChatOwners = { ...s.profileChatOwners };
      delete profileChatOwners[n];
      return { profileChatOwners };
    });
    trackTiming("profile_stop_completed", startedAt, { scope: "named", status: get().statuses[n] ?? "unknown" });
  },

  rotateProfile: async (n) => {
    const startedAt = performance.now();
    trackEvent("proxy_ip_change_requested", { scope: "named_profile" });
    trackEvent("profile_rotate_requested", { scope: "named" });
    set((s) => ({ statuses: { ...s.statuses, [n]: "rotating" } }));
    try {
      const runtime = runtimeForProfile(get().workspaces, n);
      const profile = get().profiles.find((item) => item.name === n);
      await nextctlRunChecked([
        "rotate",
        "--profile",
        n,
        "--runtime",
        runtime,
        ...(runtime === "camoufox" && profile?.country ? ["--verify"] : []),
        "--format",
        "json",
      ]);
      await get().loadProfiles();
      settleTransientStatus(n, "rotating");
      await get().loadProxy().catch(() => {});
      const after = runtime === "clawbrowser"
        ? await verifyProxyIdentity(n)
        : (profile?.country ? { country: profile.country } : undefined);
      if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, [n]: after } }));
      trackTiming("proxy_ip_change_completed", startedAt, { scope: "named_profile", status: get().statuses[n] ?? "unknown" });
      trackTiming("profile_rotate_completed", startedAt, { scope: "named", status: get().statuses[n] ?? "unknown" });
    } catch (error) {
      requestAccountSignIn(set, error);
      await settleRotateFailure(n);
      throw error;
    }
  },

  rotateProfileCountry: async (n, country) => {
    const startedAt = performance.now();
    trackEvent("proxy_country_change_requested", { scope: "named_profile", country });
    trackEvent("profile_rotate_requested", { scope: "named", country });
    set((s) => ({ statuses: { ...s.statuses, [n]: "rotating" } }));
    try {
      const runtime = runtimeForProfile(get().workspaces, n);
      await nextctlRunChecked([
        "rotate",
        "--profile",
        n,
        "--runtime",
        runtime,
        "--country",
        country,
        ...(runtime === "dasbrowser" ? [] : ["--verify"]),
        "--format",
        "json",
      ]);
      await get().loadProfiles();
      settleTransientStatus(n, "rotating");
      await get().loadProxy().catch(() => {});
      const after = runtime === "clawbrowser" ? await verifyProxyIdentity(n) : { country };
      if (after) set((s) => ({ profileIdentities: { ...s.profileIdentities, [n]: after } }));
      trackTiming("proxy_country_change_completed", startedAt, { scope: "named_profile", country, status: get().statuses[n] ?? "unknown" });
      trackTiming("profile_rotate_completed", startedAt, { scope: "named", country, status: get().statuses[n] ?? "unknown" });
    } catch (error) {
      requestAccountSignIn(set, error);
      await settleRotateFailure(n);
      throw error;
    }
  },

  createManagedProfile: async (rawName, rawCountry, options) => {
    const startedAt = performance.now();
    const name = validateEntityName("profile", rawName);
    const country = rawCountry.trim().toUpperCase();
    const direct = options?.direct === true;
    if (!direct && !/^[A-Z]{2}$/.test(country)) throw new Error("Choose a valid proxy country.");
    trackEvent("profile_create_requested", { kind: direct ? "direct" : "managed", country });
    try {
      const { runtime = "clawbrowser", direct: _direct, ...runOptions } = options ?? {};
      const result = await nextctlRunChecked(
        ["profiles", "create", name, ...(direct ? ["--no-proxy"] : ["--country", country]), "--runtime", runtime, "--format", "json"],
        undefined,
        runOptions,
      );
      const identity = createdProfileName(result, name);
      await get().loadProfiles();
      get().selectProfile(identity);
      trackTiming("profile_create_completed", startedAt, { kind: direct ? "direct" : "managed", country });
      return identity;
    } catch (error) {
      requestAccountSignIn(set, error);
      throw error;
    }
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
    await nextctlRunChecked(
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
      input.password ? { NBC_PROXY_PASSWORD: input.password } : undefined,
    );
    await get().loadProfiles();
    trackTiming("profile_manual_proxy_create_completed", startedAt, {
      profile_count: get().profiles.length,
    });
  },

  loadPersonalProxies: async () => {
    const personalProxies = await invoke<PersonalProxy[]>("manual_proxies_list");
    set({ personalProxies });
  },

  savePersonalProxy: async (input) => {
    const saved = await invoke<PersonalProxy>("manual_proxy_save", { proxy: input });
    await get().loadPersonalProxies();
    return saved;
  },

  savePersonalProxies: async (inputs) => {
    const saved: ManualProxyBatchSaveResult["saved"] = [];
    const failed: ManualProxyBatchSaveResult["failed"] = [];
    const concurrency = 6;
    for (let offset = 0; offset < inputs.length; offset += concurrency) {
      const chunk = inputs.slice(offset, offset + concurrency);
      const results = await Promise.allSettled(
        chunk.map((proxy) => invoke<PersonalProxy>("manual_proxy_save", { proxy })),
      );
      results.forEach((result, chunkIndex) => {
        const index = offset + chunkIndex;
        if (result.status === "fulfilled") saved.push({ index, proxy: result.value });
        else failed.push({
          index,
          message: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      });
    }
    await get().loadPersonalProxies();
    return { saved, failed };
  },

  deletePersonalProxy: async (id) => {
    await invoke<void>("manual_proxy_delete", { id });
    try {
      const previousWorkspaces = get().workspaces;
      const workspaces = previousWorkspaces.map((workspace) => {
        const current = workspace.profileProxyIds ?? {};
        const profileProxyIds = Object.fromEntries(
          Object.entries(current).filter(([, proxyId]) => proxyId !== id),
        );
        return Object.keys(profileProxyIds).length === Object.keys(current).length
          ? workspace
          : { ...workspace, profileProxyIds, updatedAt: now() };
      });
      if (workspaces.some((workspace, index) => workspace !== previousWorkspaces[index])) {
        await saveWorkspaces(workspaces);
        set({ workspaces });
        await get().syncProjects().catch(() => {});
      }
    } finally {
      // Always refresh: the proxy is already deleted on the backend, so the list
      // must not keep showing it even if the workspace write failed.
      await get().loadPersonalProxies().catch(() => undefined);
    }
  },

  testPersonalProxy: async (id) => invoke<PersonalProxyTestResult>("manual_proxy_test", { id }),

  createPersonalProxyProfile: async (rawName, proxyId, options) => {
    const startedAt = performance.now();
    const name = rawName.trim();
    if (!name) throw new Error("Profile name is required.");
    if (!proxyId.trim()) throw new Error("Choose a personal proxy.");
    const { runtime = "clawbrowser", ...runOptions } = options ?? {};
    trackEvent("profile_create_requested", { kind: "personal_proxy", runtime });
    const result = await invoke<RunResult>("manual_proxy_profile_create", {
      profileName: name,
      proxyId,
      runtime,
      requestId: runOptions.requestId,
      timeoutMs: runOptions.timeoutMs ?? 60_000,
    });
    let envelopeFailed = false;
    try {
      const envelope = JSON.parse(result.stdout) as { ok?: boolean; error?: unknown };
      envelopeFailed = envelope.ok === false || envelope.error != null;
    } catch {
      /* plain output is valid for older nextctl builds */
    }
    if (result.code !== 0 || envelopeFailed) throw new Error(nextctlErrorMessage(result));
    const identity = createdProfileName(result, name);
    await get().loadProfiles();
    get().selectProfile(identity);
    trackTiming("profile_create_completed", startedAt, { kind: "personal_proxy", runtime });
    return identity;
  },

  updateProfileConnection: async (rawName, connection, options) => {
    const name = rawName.trim();
    if (!name) throw new Error("Profile name is required.");
    const status = get().statuses[name] ?? "stopped";
    // A transient status-fetch failure leaves statuses[name] as "unknown" while
    // profileSessions may still report the profile running. Never mutate a live
    // session's proxy/identity, so consult the last known session too.
    const sessionRunning = get().profileSessions[name]?.status === "running";
    if (sessionRunning || ["running", "starting", "stopping", "rotating"].includes(status)) {
      throw new Error("Stop the profile before changing its connection.");
    }
    if (connection === "direct" && get().profiles.find((p) => p.name === name)?.proxy_mode !== "direct") {
      throw new Error("A proxy profile cannot be changed to direct. Create a new profile without a proxy instead.");
    }
    const runtime = runtimeForProfile(get().workspaces, name);
    if (connection === "personal") {
      const proxyId = options?.proxyId?.trim();
      if (!proxyId) throw new Error("Choose a personal proxy.");
      const result = await invoke<RunResult>("manual_proxy_profile_update", { profileName: name, proxyId, runtime, timeoutMs: 60_000 });
      let envelopeFailed = false;
      try {
        const envelope = JSON.parse(result.stdout) as { ok?: boolean; error?: unknown };
        envelopeFailed = envelope.ok === false || envelope.error != null;
      } catch {
        /* plain output is valid for older nextctl builds */
      }
      if (result.code !== 0 || envelopeFailed) throw new Error(nextctlErrorMessage(result));
    } else {
      const country = options?.country?.trim().toUpperCase() ?? "";
      if (connection === "managed" && !/^[A-Z]{2}$/.test(country)) throw new Error("Choose a valid proxy country.");
      await nextctlRunChecked([
        "profiles", "set-proxy", name,
        ...(connection === "direct" ? ["--no-proxy"] : ["--country", country]),
        "--runtime", runtime,
        "--format", "json",
      ]);
    }
    await get().loadProfiles();
    await get().loadProxy().catch(() => undefined);
    const workspaces = get().workspaces.map((workspace) => {
      if (!workspace.profileNames.includes(name)) return workspace;
      const profileProxyIds = { ...(workspace.profileProxyIds ?? {}) };
      if (connection === "personal" && options?.proxyId) profileProxyIds[name] = options.proxyId;
      else delete profileProxyIds[name];
      return { ...workspace, profileProxyIds, updatedAt: now() };
    });
    await saveWorkspaces(workspaces);
    set((state) => ({
      workspaces,
      profileIdentities: connection === "managed"
        ? { ...state.profileIdentities, [name]: { country: options?.country?.toUpperCase() } }
        : Object.fromEntries(Object.entries(state.profileIdentities).filter(([profileName]) => profileName !== name)),
    }));
    await get().syncProjects().catch(() => undefined);
    trackEvent("profile_connection_changed", { connection, runtime });
  },

  deleteProfile: async (n) => {
    const startedAt = performance.now();
    const runtime = runtimeForProfile(get().workspaces, n);
    const previousStatus = get().statuses[n] ?? "unknown";
    trackEvent("profile_delete_requested", { was_running: previousStatus === "running", runtime });

    // Deleting can race an in-flight launch. Invalidate that operation, ask
    // the host to cancel it, and — like stopProfile — wait for the launch's
    // own async work to actually settle before stopping/removing the
    // profile. Cancellation isn't instantaneous: without this wait, `rm` can
    // run while nextctl is still mid-launch, at best racing a spurious
    // SESSION_ACTIVE error and at worst orphaning a browser process for a
    // profile record that's already gone.
    nextProfileOperation(n);
    const pendingStart = pendingProfileStarts.get(n);
    await invoke<boolean>("nextctl_cancel", { requestId: `profile-start:${n}` }).catch(() => false);
    await pendingStart?.catch(() => undefined);

    const stopForDelete = async () => {
      set((s) => ({ statuses: { ...s.statuses, [n]: "stopping" } }));
      try {
        await nextctlRunChecked(["stop", "--profile", n, "--runtime", runtime, "--format", "json"]);
      } catch (error) {
        // Closing the browser window can leave the renderer one refresh behind.
        // Only suppress the stop error when nextctl confirms the session is gone.
        await get().loadProfiles().catch(() => undefined);
        if (get().statuses[n] !== "stopped") {
          set((s) => (s.statuses[n] === "stopping" ? { statuses: { ...s.statuses, [n]: "unknown" } } : {}));
          throw error;
        }
      }
    };

    // A failed removal must not leave the transient "stopping" marker: it
    // pauses status polling for every profile and disables this row's controls.
    const settleDeleteFailure = async () => {
      await get().loadProfiles().catch(() => undefined);
      set((s) => (s.statuses[n] === "stopping" ? { statuses: { ...s.statuses, [n]: "unknown" } } : {}));
    };

    if (previousStatus !== "stopped") {
      await stopForDelete();
    }

    try {
      await nextctlRunChecked(["profiles", "rm", n, "--format", "json"]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // The UI status may have been stale while an external browser session was
      // still alive. Stop it with the saved runtime, then retry removal once.
      if (/PROFILE_NOT_FOUND/.test(message)) {
        // Another client already removed it; finish clearing this workspace's reference.
      } else if (!/SESSION_ACTIVE|active browser session/i.test(message)) {
        await settleDeleteFailure();
        throw error;
      } else try {
        await stopForDelete();
        await nextctlRunChecked(["profiles", "rm", n, "--format", "json"]);
      } catch (retryError) {
        await settleDeleteFailure();
        throw retryError;
      }
    }
    if (get().selectedProfile === n) set({ selectedProfile: undefined });
    const statuses = { ...get().statuses };
    delete statuses[n];
    const profileChatOwners = { ...get().profileChatOwners };
    delete profileChatOwners[n];
    set({ statuses, profileChatOwners });
    try {
      await persistWorkspaceMutation((previous) => previous.map((workspace) => {
        const profileToolsets = { ...workspace.profileToolsets };
        const profileProxyIds = { ...(workspace.profileProxyIds ?? {}) };
        delete profileToolsets[n];
        delete profileProxyIds[n];
        return { ...workspace, profileNames: workspace.profileNames.filter((name) => name !== n), profileToolsets, profileProxyIds, updatedAt: Math.max(now(), workspace.updatedAt + 1) };
      }));
    } catch (error) {
      await get().loadProfiles();
      throw new Error(`The profile was removed, but its workspace could not be saved. ${error instanceof Error ? error.message : String(error)}`);
    }
    await get().loadProfiles();
    trackTiming("profile_delete_completed", startedAt);
  },

  selectProfile: (n) => {
    trackEvent("profile_selected", { selected: !!n });
    if (n) clearMultiloginSelection(get().activeWorkspaceId);
    set({ selectedProfile: n });
  },

  switchAgent: (id) => {
    if (id === get().agentId) return;
    trackEvent("agent_switched", { from_agent: get().agentId, to_agent: id });
    localStorage.setItem("lastAgent", id);
    set({ agentId: id, startupAgentSuggestion: undefined });
    get().ensureConversation(id);
    get().reconcileQueues();
    get().startConsumer(id);
    void get().recheckLogin(id);
  },

  ensureConversation: (agentId: string) => {
    const convs = get().conversationsForAgent(agentId);
    if (!convs.length) {
      get().newChat();
    } else if (!convs.some((conversation) => conversation.id === get().activeConvId[agentId])) {
      const stored = localStorage.getItem(activeConversationStorageKey(agentId, get().activeWorkspaceId));
      const selected = convs.find((conversation) => conversation.id === stored) ?? convs[0];
      set((s) => ({
        activeConvId: { ...s.activeConvId, [agentId]: selected.id },
      }));
    }
    // Keep the terminal/chat mode in step with whichever conversation became
    // active. Only selectConversation used to do this, so switching agents or
    // workspaces could leave the previous project's mode applied.
    const active = get().conversations.find((conversation) => conversation.id === get().activeConvId[agentId]);
    if (active) set({ terminalChat: active.chatMode === "terminal" });
  },

  authorizeAgent: async (options = {}) => {
    if (!options.suggestInstalledAlternative) set({ startupAgentSuggestion: undefined });
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
      const [version, loggedIn] = await Promise.all([
        invoke<string>("agent_authorize", {
          binary: a.binary,
          envVar: a.envVar,
        }),
        invoke<boolean | null>("agent_check_login", {
          binary: a.binary,
          envVar: a.envVar,
          statusArgs: a.statusArgs ?? [],
        }),
      ]);
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
      // Reconnecting an installed agent on startup must not create a project
      // in an intentionally empty workspace.
      if (get().conversationsForAgent(agentId).length) get().ensureConversation(agentId);
      get().announceConnect(agentId, version, loggedIn);
      trackTiming("agent_connect_succeeded", startedAt, {
        agent: agentId,
        logged_in: loggedIn === true,
        nextctl_available: get().nextctlAvailable,
      });
      get().reconcileQueues();
      get().startConsumer(agentId);
      if (options.skipNextctlSetup || pendingTarget(get(), "vps")) {
        trackEvent("agent_connect_remote_only", { agent: agentId });
        return;
      }
      const adapter = nextctlAgentAdapter(agentId);
      if (!get().nextctlAvailable) {
        if (options.deferMissingNextctlPrompt) {
          trackEvent("install_prompt_deferred", { agent: agentId, adapter });
          return;
        }
        const conv = get().activeConversation();
        const alreadyQueued = conv?.messages.some((message) =>
          message.text.includes("Nextbrowser needs to finish installing its local browser components"),
        );
        if (!alreadyQueued) get().enqueue(nextBrowserInstallPrompt(adapter));
        trackEvent("install_prompt_sent", { agent: agentId, adapter });
        return;
      }
      // Installation is idempotent. Keep connection fast and refresh the
      // agent's bundled nextctl skill/integration in the background.
      void nextctlRun(["install", "--agent", adapter, "--no-api-key-prompt"]).then((result) => {
        if (result.code !== 0) {
          console.warn(`Could not install nextctl skill for ${adapter}: ${nextctlErrorMessage(result)}`);
        }
      }).catch((error) => console.warn(`Could not install nextctl skill for ${adapter}:`, error));
    } catch (error) {
      trackTiming("agent_connect_failed", startedAt, { agent: agentId });
      const missingInstall = missingAgentInstallError(error, a);
      if (missingInstall && agentId === "claude" && options.suggestInstalledAlternative) {
        const codex = agentById("codex");
        try {
          const version = await invoke<string>("agent_authorize", { binary: codex.binary, envVar: codex.envVar });
          const loggedIn = await invoke<boolean | null>("agent_check_login", {
            binary: codex.binary, envVar: codex.envVar, statusArgs: codex.statusArgs ?? [],
          }).catch(() => null);
          // Discovery must not connect an agent, run queued work, or change an
          // existing conversation. The gate offers the installed alternative.
          if (version && get().agentId === agentId) {
            set((s) => ({
              startupAgentSuggestion: "codex",
              runtime: {
                ...s.runtime,
                claude: { ...s.runtime.claude, ready: false, authorizing: false, error: undefined },
                codex: { ...s.runtime.codex, version, loggedIn },
              },
            }));
            return;
          }
        } catch { /* Neither agent is installed: retain the actionable error. */ }
      }
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: {
            ...s.runtime[agentId],
            ready: false,
            authorizing: false,
            error: missingInstall ?? internalError(`We couldn't connect ${a.name}.`, "AGENT_CONNECT_FAILED"),
          },
        },
      }));
    }
  },

  announceConnect: (agentId: string, _version: string, loggedIn: boolean | null) => {
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
      text: `${prefix}.${note}`,
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
    // Ignore re-entry: without this, repeated clicks open several sign-in
    // terminals and start several 2-minute polls.
    if (get().runtime[agentId]?.authorizing) return;
    trackEvent("agent_login_started", { agent: agentId });
    set((s) => ({
      runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], authorizing: true, error: undefined } },
    }));
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
          get().startConsumer(agentId);
          trackEvent("agent_login_succeeded", { agent: agentId });
          return;
        }
      }
      trackEvent("agent_login_timeout", { agent: agentId });
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], error: internalError(`${a.name} sign-in was not detected. Try again.`, "AGENT_SIGN_IN_TIMEOUT") },
        },
      }));
    } catch {
      trackEvent("agent_login_failed", { agent: agentId });
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], error: internalError(`We couldn't open ${a.name} sign-in.`, "AGENT_SIGN_IN_OPEN_FAILED") },
        },
      }));
    } finally {
      set((s) => ({
        runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], authorizing: false } },
      }));
    }
  },

  // Switch the signed-in account for an agent that owns its own auth (Claude
  // Code, Codex). The installed agent runtime manages its credentials, so the
  // reliable way to change accounts is to run its logout command in a real
  // terminal. Afterwards we poll login status so the UI flips back to "Log in".
  logoutAgent: async () => {
    const agentId = get().agentId;
    const a = agentById(agentId);
    if (!a.logoutArgs.length) return;
    // Ignore re-entry: repeated clicks open several sign-out terminals and
    // start several poll loops.
    if (get().runtime[agentId]?.authorizing) return;
    trackEvent("agent_logout_started", { agent: agentId });
    set((s) => ({ runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], authorizing: true, error: undefined } } }));
    let signOutOpened = false;
    try {
      await invoke("open_terminal_login", {
        binary: a.binary,
        envVar: a.envVar,
        loginArgs: a.logoutArgs,
      });
      signOutOpened = true;
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
        if (loggedIn === false) {
          set((s) => ({
            runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], loggedIn } },
          }));
          trackEvent("agent_logout_succeeded", { agent: agentId, login_state: loggedIn === false ? "logged_out" : "unknown" });
          return;
        }
      }
      trackEvent("agent_logout_timeout", { agent: agentId });
      set((s) => ({ runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId],
        error: internalError(`Sign-out from ${a.name} could not be confirmed. Finish sign-out in Terminal, then check login status again.`, "AGENT_SIGN_OUT_UNCONFIRMED"),
      } } }));
    } catch {
      trackEvent("agent_logout_failed", { agent: agentId });
      set((s) => ({
        runtime: {
          ...s.runtime,
          [agentId]: { ...s.runtime[agentId], error: internalError(signOutOpened ? `We couldn't confirm ${a.name} sign-out. Check Terminal and try again.` : `We couldn't open ${a.name} sign-out.`, signOutOpened ? "AGENT_SIGN_OUT_CHECK_FAILED" : "AGENT_SIGN_OUT_OPEN_FAILED") },
        },
      }));
    } finally {
      set((s) => ({ runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], authorizing: false } } }));
    }
  },

  recheckLogin: async (selectedAgentId) => {
    const agentId = selectedAgentId ?? get().agentId;
    const a = agentById(agentId);
    const runtime = get().runtime[agentId];
    if (!runtime?.ready || runtime.authorizing || !a.statusArgs?.length) return;
    try {
      const loggedIn = await invoke<boolean | null>("agent_check_login", {
        binary: a.binary, envVar: a.envVar, statusArgs: a.statusArgs,
      });
      // An inconclusive check must never turn a confirmed logout into ready.
      if (typeof loggedIn !== "boolean") return;
      set((s) => ({ runtime: { ...s.runtime, [agentId]: { ...s.runtime[agentId], loggedIn } } }));
      if (loggedIn) get().startConsumer(agentId);
    } catch { /* A failed status command is not evidence of a login. */ }
  },

  setTab: (t) => {
    const previousTab = get().tab;
    if (previousTab === t) return;
    trackEvent("tab_opened", { tab: t, previous_tab: previousTab });
    trackScreenView(t, { source: "tab_opened", previous_tab: previousTab });
    set({ tab: t });
  },
  setAppActive: (v) => {
    const wasActive = get().appActive;
    set({ appActive: v });
    if (v && !wasActive) {
      void get().refreshProfileStatuses();
      void get().pollProfileCreateRequests();
    }
  },
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
  setTerminalChat: (v) => {
    localStorage.setItem("terminalChat", String(v));
    set((state) => {
      const activeId = state.activeConvId[state.agentId];
      const conversations = state.conversations.map((conversation) =>
        conversation.id === activeId ? { ...conversation, chatMode: v ? "terminal" as const : "chat" as const, updatedAt: now() } : conversation,
      );
      persistConvs(conversations);
      return { terminalChat: v, conversations };
    });
  },
  loadGitHubStar: async () => {
    const epoch = accountEpoch;
    const status = await invoke<GitHubStarStatus | null>("github_star_status");
    if (epoch !== accountEpoch) return;
    set({ githubStar: status });
  },

  verifyGitHubStar: async () => {
    const epoch = accountEpoch;
    const status = await invoke<GitHubStarStatus>("github_star_verify");
    if (epoch !== accountEpoch) return status;
    set({ githubStar: status, githubStarPromptOpen: false, trafficGatePromptOpen: false });
    trackEvent("github_star_reward_claimed", { reward_bytes: status.rewardBytes });
    await get().loadProxy().catch(() => undefined);
    return status;
  },

  setGitHubStarPromptOpen: (open) => {
    if (get().githubStarPromptOpen === open) return;
    if (open) trackEvent("github_star_prompt_shown");
    set({ githubStarPromptOpen: open });
  },

  setTrafficGatePromptOpen: (open) => {
    if (get().trafficGatePromptOpen === open) return;
    trackEvent(open ? "proxy_traffic_gate_prompt_opened" : "proxy_traffic_gate_prompt_closed", {
      used_bytes_bucket: (() => {
        const proxy = get().proxy;
        return proxy ? Math.floor(proxy.used_bytes / (10 * 1024 * 1024)) * 10 : "unknown";
      })(),
    });
    set({ trafficGatePromptOpen: open });
  },
  setDashboardKeyPromptOpen: (v) => {
    trackEvent(v ? "dashboard_key_prompt_opened" : "dashboard_key_prompt_closed");
    set({ dashboardKeyPromptOpen: v, loginError: v ? undefined : get().loginError });
  },
  openConnectorPrompt: (id, resume) => {
    const returnTab = get().tab;
    trackEvent("connector_prompt_opened", { connector: id, resume: resume ?? "none" });
    set({ tab: "connectors", connectorPrompt: { id, returnTab, resume } });
  },
  clearConnectorPrompt: () => set({ connectorPrompt: undefined }),
  completeConnectorPrompt: () => {
    const prompt = get().connectorPrompt;
    set({ connectorPrompt: undefined });
    if (!prompt?.resume) return;
    // Hand the person back to the flow that sent them to the connector so a
    // one-time setup never costs them the profile they were creating.
    set({ tab: prompt.returnTab ?? "chat" });
    window.dispatchEvent(new CustomEvent(CONNECTOR_PROMPT_RESUMED_EVENT, {
      detail: { connector: prompt.id, resume: prompt.resume },
    }));
  },
  setOnboardingStepIndex: (index) => set({ onboardingStepIndex: index }),
  suspendOnboardingForSetup: () => set({
    showOnboarding: false,
    onboardingReturnPending: true,
  }),
  resumeOnboardingAfterSetup: () => {
    if (!get().onboardingReturnPending) return;
    set({
      showOnboarding: true,
      onboardingReturnPending: false,
    });
  },
  finishOnboarding: () => {
    saveOnboardingCompletion(localStorage);
    set({
      showOnboarding: false,
      onboardingStepIndex: 0,
      onboardingReturnPending: false,
    });
  },
  showOnboardingAgain: () => set({
    showOnboarding: true,
    onboardingStepIndex: 0,
    onboardingReturnPending: false,
  }),

  checkNextctlUpdate: async (retryAttempt = 0) => {
    const scheduleRetry = (attempt: number) => {
      if (attempt > NEXTCTL_UPDATE_MAX_RETRIES) return;
      if (nextctlUpdateRetryTimer) clearTimeout(nextctlUpdateRetryTimer);
      nextctlUpdateRetryTimer = setTimeout(() => {
        nextctlUpdateRetryTimer = null;
        void get().checkNextctlUpdate(attempt);
      }, nextctlUpdateRetryDelay(attempt));
    };
    // Only the exhausted-retries failure is shown to the user; every attempt
    // up to and including this one stays silent in the background.
    const willRetry = retryAttempt < NEXTCTL_UPDATE_MAX_RETRIES;
    if (retryAttempt === 0 && nextctlUpdateRetryTimer) {
      clearTimeout(nextctlUpdateRetryTimer);
      nextctlUpdateRetryTimer = null;
    }
    if (pendingTarget(get(), "vps") || get().nextctlUpdating) {
      if (retryAttempt > 0) scheduleRetry(retryAttempt);
      return false;
    }
    const startedAt = performance.now();
    trackEvent("nextctl_update_started");
    set({ nextctlUpdating: true, nextctlUpdateStatus: undefined, nextctlUpdateError: undefined });
    try {
      if (pendingTarget(get(), "vps")) return false;
      if (get().nextctlCompatibilityError) {
        // The old executable cannot run even update under mandatory verify.
        // The host installs and validates a release without launching browsers.
        await invoke("nextctl_reinstall");
        const authed = await refreshLocalNextctlMetadata();
        set({ authed });
        await recordNextctlUpdateAttempt({ rateLimitedUntil: 0 });
        return get().nextctlAvailable;
      }
      // Updating also refreshes Clawbrowser and agent assets. On slower or
      // filtered networks that can legitimately take longer than the normal
      // one-minute command timeout.
      const res = await nextctlRun(["update"], undefined, { timeoutMs: 10 * 60_000 });
      const text = res.stdout + res.stderr;
      const to = nextctlUpdatedVersion(text);
      if (to) {
        // nextctl installed successfully. The command can still exit non-zero
        // because an optional browser-runtime asset failed to download (for
        // example a missing macOS Clawbrowser archive), which must not be
        // reported as a failed nextctl update. Show a brief confirmation.
        showNextctlUpdateNotice(`updated → ${normalizeNextctlVersion(to)}`);
        trackEvent("nextctl_update_available", { updated: true });
      } else if (res.code === 0) {
        // Already current — keep the footer on one line; show nothing.
        clearNextctlUpdateNotice();
        set({ nextctlUpdateStatus: undefined });
        trackEvent("nextctl_update_not_available");
      } else {
        clearNextctlUpdateNotice();
        const reason = nextctlErrorMessage(res);
        trackEvent("nextctl_update_failed", { exit_code: res.code });
        if (isNextctlRateLimit(reason)) {
          // Once retries are exhausted, back off until GitHub's own reset
          // time when nextctl reported one; otherwise guess a full window so
          // the daily background check doesn't hit it again right away.
          const resetAt = nextctlRateLimitResetAt(reason);
          await recordNextctlUpdateAttempt({ rateLimitedUntil: resetAt ?? now() + NEXTCTL_UPDATE_RATE_LIMIT_MS });
        } else {
          await recordNextctlUpdateAttempt();
        }
        if (willRetry) {
          scheduleRetry(retryAttempt + 1);
        } else {
          set({ nextctlUpdateError: nextctlUpdateErrorMessage(reason) });
        }
        return false;
      }
      if (pendingTarget(get(), "vps")) return true;
      // The update already succeeded; refreshing metadata is best-effort and
      // must not turn it into a reported failure (a transient IPC error or a
      // briefly locked just-replaced binary used to do exactly that).
      try {
        const ver = await invoke<string>("nextctl_version");
        if (pendingTarget(get(), "vps")) return true;
        const supportsSkill = await invoke<boolean>("nextctl_supports_skill");
        if (pendingTarget(get(), "vps")) return true;
        set({ nextctlVersion: normalizeNextctlVersion(ver), nextctlSupportsSkill: supportsSkill, nextctlAvailable: true, nextctlCompatibilityError: undefined });
      } catch (metadataError) {
        console.warn("[NEXTCTL_METADATA_REFRESH_FAILED]", metadataError);
      }
      // A successful check clears any rate-limit backoff.
      await recordNextctlUpdateAttempt({ rateLimitedUntil: 0 });
      trackTiming("nextctl_update_completed", startedAt, { supports_skill: get().nextctlSupportsSkill });
      return true;
    } catch (error) {
      console.error("[NEXTCTL_UPDATE_FAILED] nextctl update failed:", error);
      clearNextctlUpdateNotice();
      const reason = error instanceof Error ? error.message : String(error);
      set({ nextctlAvailable: false });
      trackTiming("nextctl_update_failed", startedAt);
      if (isNextctlRateLimit(reason)) {
        const resetAt = nextctlRateLimitResetAt(reason);
        await recordNextctlUpdateAttempt({ rateLimitedUntil: resetAt ?? now() + NEXTCTL_UPDATE_RATE_LIMIT_MS });
      } else {
        await recordNextctlUpdateAttempt();
      }
      if (willRetry) {
        scheduleRetry(retryAttempt + 1);
      } else {
        set({ nextctlUpdateError: nextctlUpdateErrorMessage(reason) });
      }
      return false;
    } finally {
      set({ nextctlUpdating: false });
      for (const [agentId, runtime] of Object.entries(get().runtime)) {
        if (runtime.ready && runtime.queue.length) get().startConsumer(agentId);
      }
    }
  },

  syncProjects: async () => {
    if (!get().authed || get().projectsSyncing) return;
    const epoch = accountEpoch;
    set({ projectsSyncing: true });
    const initialWorkspaces = get().workspaces;
    const initialConversations = get().conversations;
    const initialProjectRevisions = { ...get().projectRevisions };
    let retryWorkspaceSync = false;
    try {
      const workspaceResponse = await invoke<{ workspaces?: Array<{
        id: string; name: string; document: Partial<Workspace>; revision: number; updated_at: string; created_at: string;
      }> }>("workspaces_list");
      const remoteWorkspaces = workspaceResponse?.workspaces ?? [];
      if (epoch !== accountEpoch || !get().authed) return;
      const remoteWorkspaceById = new Map(remoteWorkspaces.map((workspace) => [workspace.id, workspace]));
      const workspaceRevisions = { ...get().workspaceRevisions };
      let workspaces = [...get().workspaces];
      let conversations = [...get().conversations];
      const unownedWorkspaceIds: string[] = [];
      const unownedWorkspaces: string[] = [];
      const unownedChatIds: string[] = [];
      const unownedChats: string[] = [];
      for (const cloud of remoteWorkspaces) {
        workspaceRevisions[cloud.id] = cloud.revision;
        const normalized: Workspace = {
          id: cloud.id,
          name: cloud.name,
          profileNames: Array.isArray(cloud.document?.profileNames) ? cloud.document.profileNames : [],
          profileToolsets: cloud.document?.profileToolsets ?? {},
          profileProxyIds: cloud.document?.profileProxyIds ?? {},
          createdAt: Date.parse(cloud.created_at),
          updatedAt: Date.parse(cloud.updated_at),
        };
        const index = workspaces.findIndex((workspace) => workspace.id === cloud.id);
        if (index < 0) workspaces.push(normalized);
        else if (normalized.updatedAt >= workspaces[index].updatedAt) workspaces[index] = normalized;
      }
      for (const workspace of workspaces) {
        if (epoch !== accountEpoch || !get().authed) return;
        const cloud = remoteWorkspaceById.get(workspace.id);
        if (cloud && workspace.updatedAt <= Date.parse(cloud.updated_at)) continue;
        const saveWorkspace = (candidate: Workspace, baseRevision: number) => invoke<{ revision: number }>("workspace_put", {
          id: candidate.id,
          workspace: {
            name: candidate.name,
            document: {
              profileNames: candidate.profileNames,
              profileToolsets: candidate.profileToolsets,
              profileProxyIds: candidate.profileProxyIds ?? {},
            },
            base_revision: baseRevision,
          },
        });
        let candidate = workspace;
        let saved: { revision: number } | undefined;
        try {
          saved = await saveWorkspace(candidate, workspaceRevisions[workspace.id] ?? 0);
        } catch (error) {
          // A 404 means the backend has no such workspace for this account.
          // Handle it like a revision conflict (refresh, then retry as a
          // create) instead of failing the user's profile action.
          if (!isWorkspaceRevisionConflict(error) && !isWorkspaceNotFound(error)) throw error;
          // A second device changed the same workspace after our initial list.
          // Refresh once, merge profile associations, and retry against its
          // revision instead of surfacing a background 409 to the user.
          const refreshed = await invoke<{ workspaces?: Array<{
            id: string; name: string; document: Partial<Workspace>; revision: number; updated_at: string; created_at: string;
          }> }>("workspaces_list");
          const latest = refreshed.workspaces?.find((item) => item.id === workspace.id);
          if (!latest) {
            // The backend already uses this id, but not for this account: the
            // primary key is global, so no revision can ever match and the
            // workspace cannot be created here. Retry once as a create, then
            // keep it on this device. Aborting instead used to fail every
            // profile action with a cloud-sync error.
            try {
              saved = await saveWorkspace(workspace, 0);
            } catch (retryError) {
              if (!isWorkspaceRevisionConflict(retryError) && !isWorkspaceNotFound(retryError)) throw retryError;
              unownedWorkspaceIds.push(workspace.id);
              unownedWorkspaces.push(workspace.name);
              continue;
            }
          } else {
            const remote: Workspace = {
              id: latest.id,
              name: latest.name,
              profileNames: Array.isArray(latest.document?.profileNames) ? latest.document.profileNames : [],
              profileToolsets: latest.document?.profileToolsets ?? {},
              profileProxyIds: latest.document?.profileProxyIds ?? {},
              createdAt: Date.parse(latest.created_at),
              updatedAt: Date.parse(latest.updated_at),
            };
            candidate = mergeWorkspaceAfterRevisionConflict(workspace, remote);
            const index = workspaces.findIndex((item) => item.id === candidate.id);
            if (index >= 0) workspaces[index] = candidate;
            saved = await saveWorkspace(candidate, latest.revision);
          }
        }
        if (saved) workspaceRevisions[workspace.id] = saved.revision;
      }
      if (unownedWorkspaces.length) {
        // A foreign account's entity must never remain in the active cache.
        // Keeping it locally would make the next mutation try to upload it
        // again and would recreate the cross-account 409 loop.
        workspaces = workspaces.filter((workspace) => !unownedWorkspaceIds.includes(workspace.id));
        conversations = conversations.filter((conversation) => !conversation.workspaceId || !unownedWorkspaceIds.includes(conversation.workspaceId));
        console.warn(`[workspace_sync] removed ${unownedWorkspaces.length} workspace(s) owned by another Nextbrowser account: ${unownedWorkspaces.join(", ")}`);
      }
      const response = await invoke<{ projects?: Array<{
        id: string; title: string; agent: string; chat_mode: "chat" | "terminal";
        workspace_id: string; document: Conversation; revision: number; updated_at: string;
      }> }>("projects_list");
      const remote = response?.projects ?? [];
      if (epoch !== accountEpoch || !get().authed) return;
      const remoteById = new Map(remote.map((project) => [project.id, project]));
      // A previously synced entity missing from the authoritative list was
      // deleted on another client. Never upload it again from the local cache.
      conversations = conversations.filter((item) => !deletedProjectIds.has(item.id)
        && (!initialProjectRevisions[item.id] || remoteById.has(item.id)));
      const revisions = { ...get().projectRevisions };
      for (const cloud of remote) {
        if (deletedProjectIds.has(cloud.id)) continue;
        revisions[cloud.id] = cloud.revision;
        const index = conversations.findIndex((conversation) => conversation.id === cloud.id);
        const normalized = normalizeConversation({
          ...cloud.document,
          id: cloud.id,
          title: cloud.title,
          agent: cloud.agent,
          chatMode: cloud.chat_mode,
          workspaceId: cloud.workspace_id,
        });
        if (index < 0) conversations.push(normalized);
        else if (shouldApplyRemoteConversation(
          conversations[index],
          normalized,
          Date.parse(cloud.updated_at),
        )) conversations[index] = normalized;
      }

      // Profile creation can change workspace membership while the network
      // requests above are pending. Never replace those edits with our snapshot.
      const currentWorkspaces = get().workspaces;
      if (currentWorkspaces !== initialWorkspaces) {
        retryWorkspaceSync = true;
        const initialById = new Map(initialWorkspaces.map((workspace) => [workspace.id, workspace]));
        const syncedById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
        workspaces = currentWorkspaces.map((workspace) => {
          const synced = syncedById.get(workspace.id);
          if (workspace === initialById.get(workspace.id)) return synced ?? workspace;
          return { ...workspace, updatedAt: Math.max(workspace.updatedAt, (synced?.updatedAt ?? 0) + 1) };
        });
        for (const workspace of syncedById.values()) {
          if (!initialById.has(workspace.id) && !workspaces.some((item) => item.id === workspace.id)) workspaces.push(workspace);
        }
      }
      // Network replies must not discard edits/new messages or resurrect
      // chats removed while this sync was waiting on the backend.
      const initialConversationById = new Map(initialConversations.map((item) => [item.id, item]));
      const currentConversationById = new Map(get().conversations.map((item) => [item.id, item]));
      conversations = conversations.filter((item) => !deletedProjectIds.has(item.id)
        && (!initialConversationById.has(item.id) || currentConversationById.has(item.id)));
      for (const current of currentConversationById.values()) {
        if (deletedProjectIds.has(current.id) || current === initialConversationById.get(current.id)) continue;
        const index = conversations.findIndex((item) => item.id === current.id);
        if (index < 0) conversations.push(current);
        else conversations[index] = current;
      }
      let activeWorkspaceId = get().activeWorkspaceId;
      if (!workspaces.some((workspace) => workspace.id === activeWorkspaceId)) activeWorkspaceId = workspaces[0]?.id;
      if (activeWorkspaceId) localStorage.setItem("activeWorkspaceId", activeWorkspaceId);
      else localStorage.removeItem("activeWorkspaceId");
      applyingCloudProjects = true;
      set({
        conversations,
        workspaces,
        activeWorkspaceId,
        projectRevisions: revisions,
        workspaceRevisions,
      });
      await saveWorkspaces(workspaces);
      await persistConvs(conversations);
      applyingCloudProjects = false;

      set({
        workspacesLoaded: true,
        workspaceSetupRequired: requiresWorkspaceSetup(workspaces, conversations, activeWorkspaceId),
      });

      for (const conversation of conversations) {
        if (epoch !== accountEpoch || !get().authed) return;
        if (deletingProjectIds.has(conversation.id) || deletedProjectIds.has(conversation.id)) continue;
        if (!conversation.workspaceId) continue;
        const cloud = remoteById.get(conversation.id);
        if (cloud && conversation.updatedAt <= Date.parse(cloud.updated_at)) continue;
        const putProject = (baseRevision: number) => invoke<{ revision: number }>("project_put", {
          id: conversation.id,
          project: {
            title: conversation.title,
            agent: conversation.agent,
            chat_mode: conversation.chatMode === "terminal" ? "terminal" : "chat",
            workspace_id: conversation.workspaceId,
            document: serializeConversations([conversation])[0],
            base_revision: baseRevision,
          },
        });
        let saved: { revision: number } | undefined;
        try {
          saved = await putProject(revisions[conversation.id] ?? 0);
        } catch (error) {
          if (!isProjectRevisionConflict(error)) throw error;
          // Another device may have advanced the chat, or its id may belong to a
          // different Nextbrowser account, where no revision can ever match.
          // Retry against the refreshed revision or as a create, and keep the
          // chat on this device instead of failing the whole sync.
          const refreshed = await invoke<{ projects?: Array<{
            id: string; title: string; agent: string; chat_mode: "chat" | "terminal";
            workspace_id: string; document: Conversation; revision: number; updated_at: string;
          }> }>("projects_list");
          const latest = refreshed.projects?.find((item) => item.id === conversation.id);
          try {
            saved = await putProject(latest?.revision ?? 0);
          } catch (retryError) {
            if (!isProjectRevisionConflict(retryError)) throw retryError;
            unownedChatIds.push(conversation.id);
            unownedChats.push(conversation.title);
            continue;
          }
        }
        if (saved) revisions[conversation.id] = saved.revision;
      }
      if (unownedChats.length) {
        conversations = conversations.filter((conversation) => !unownedChatIds.includes(conversation.id));
        console.warn(`[project_sync] removed ${unownedChats.length} chat(s) owned by another Nextbrowser account`);
      }
      if (unownedWorkspaces.length || unownedChats.length) {
        conversations = conversations.filter((conversation) =>
          !conversation.workspaceId || !unownedWorkspaceIds.includes(conversation.workspaceId),
        );
        await saveWorkspaces(workspaces);
        await persistConvs(conversations);
        set({ workspaces, conversations, projectRevisions: revisions, workspaceRevisions });
        throw new Error("Some local workspace data belongs to another account. Sign in to its original account before switching accounts.");
      }
      set({ projectRevisions: revisions, workspaceRevisions });
      trackEvent("projects_synced", { project_count: conversations.length });
    } finally {
      applyingCloudProjects = false;
      const state = get();
      set({
        projectsSyncing: false,
        workspacesLoaded: true,
        workspaceSetupRequired: requiresWorkspaceSetup(
          state.workspaces,
          state.conversations,
          state.activeWorkspaceId,
        ),
      });
      if (retryWorkspaceSync) void get().syncProjects().catch(() => {});
    }
  },

  createWorkspace: async (rawName) => {
    const name = validateEntityName("workspace", rawName);
    const state = get();
    const workspaceId = uid();
    // The machine-wide inventory can contain another account's profiles.
    // A new workspace never adopts it. First-account defaults are explicit.
    const profileNames: string[] = [];
    const profileToolsets: Record<string, BrowserToolset> = {};
    const workspace: Workspace = {
      id: workspaceId,
      name,
      profileNames,
      profileToolsets,
      profileProxyIds: {},
      createdAt: now(),
      updatedAt: now(),
    };
    const saved = await invoke<{ revision: number }>("workspace_put", {
      id: workspace.id,
      workspace: { name, document: { profileNames, profileToolsets, profileProxyIds: {} }, base_revision: 0 },
    });
    const conversations = get().conversations;
    const workspaces = [...get().workspaces, workspace];
    await Promise.all([saveWorkspaces(workspaces), persistConvs(conversations)]);
    set({
      workspaces,
      conversations,
      activeWorkspaceId: workspace.id,
      workspaceRevisions: { ...state.workspaceRevisions, [workspace.id]: saved.revision },
      workspaceSetupRequired: requiresWorkspaceSetup(workspaces, conversations, workspace.id),
    });
    get().selectWorkspace(workspace.id);
    return workspace.id;
  },

  selectWorkspace: (id) => {
    if (!get().workspaces.some((workspace) => workspace.id === id)) return;
    localStorage.setItem("activeWorkspaceId", id);
    const agentId = get().agentId;
    const stored = localStorage.getItem(activeConversationStorageKey(agentId, id));
    const candidates = get().conversations
      .filter((conversation) => conversation.workspaceId === id && conversation.agent === agentId)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const selected = candidates.find((conversation) => conversation.id === stored) ?? candidates[0];
    const activeConvId = Object.fromEntries(Object.entries(get().activeConvId)
      .filter(([, conversationId]) => get().conversations.some((c) => c.id === conversationId && c.workspaceId === id)));
    if (selected) activeConvId[agentId] = selected.id;
    else delete activeConvId[agentId];
    set({ activeWorkspaceId: id, activeConvId, selectedProfile: undefined,
      workspaceSetupRequired: requiresWorkspaceSetup(get().workspaces, get().conversations, id),
      terminalChat: selected?.chatMode === "terminal",
    });
  },

  deleteWorkspace: async (id) => {
    await invoke("workspace_delete", { id });
    const workspaces = get().workspaces.filter((workspace) => workspace.id !== id);
    const conversations = get().conversations.filter((conversation) => conversation.workspaceId !== id);
    const previousActive = get().activeWorkspaceId;
    const activeWorkspaceId = workspaces.some((workspace) => workspace.id === previousActive)
      ? previousActive : workspaces[0]?.id;
    await Promise.all([saveWorkspaces(workspaces), persistConvs(conversations)]);
    const activeConvId = Object.fromEntries(Object.entries(get().activeConvId)
      .filter(([, conversationId]) => conversations.some((c) => c.id === conversationId && c.workspaceId === activeWorkspaceId)));
    set({ workspaces, conversations, activeWorkspaceId, activeConvId,
      workspaceSetupRequired: requiresWorkspaceSetup(workspaces, conversations, activeWorkspaceId),
    });
    if (activeWorkspaceId !== previousActive) {
      if (activeWorkspaceId) get().selectWorkspace(activeWorkspaceId);
      else {
        localStorage.removeItem("activeWorkspaceId");
        set({ selectedProfile: undefined, activeConvId: {} });
      }
    }
  },

  completeWorkspaceSetup: () => {
    localStorage.setItem("workspaceSetupComplete", "true");
    set({ workspaceSetupRequired: false });
  },

  // New users used to hit a three-step "Create your workspace" modal before
  // they could do anything. Create the defaults silently instead: a workspace,
  // a first project, and one profile per browser toolset. The manual gate is
  // kept only as a fallback when this cannot complete.
  ensureDefaultWorkspaceSetup: async () => {
    if (!get().authed || !get().nextctlAvailable || pendingTarget(get(), "vps")) return;
    if (defaultSetupInFlight) return;
    // Defaults belong to first-account setup only. Empty workspaces and
    // deleted defaults are intentional and must never be repopulated.
    if (get().workspaces.length > 0) {
      set({ workspaceSetupRequired: false, workspaceSetupAuto: "done" });
      return;
    }
    if (!get().workspaceSetupRequired) {
      set({ workspaceSetupAuto: "done" });
      return;
    }
    defaultSetupInFlight = true;
    set({ workspaceSetupAuto: "running" });
    try {
      // A workspace mutation is rejected while a cloud sync is in flight.
      const deadline = now() + 30_000;
      while (get().projectsSyncing && now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      let workspace = get().workspaces.find((item) => item.id === get().activeWorkspaceId) ?? get().workspaces[0];
      if (!workspace) {
        await get().createWorkspace("My workspace");
        workspace = get().workspaces.find((item) => item.id === get().activeWorkspaceId) ?? get().workspaces[0];
      }
      if (!workspace) throw new Error("Could not create a default workspace.");
      const workspaceId = workspace.id;
      if (!get().conversations.some((conversation) => conversation.workspaceId === workspaceId)) {
        const projectId = get().createProject("First project", "chat");
        if (projectId && typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("nextbrowser:project-created", { detail: { id: projectId } }));
        }
      }
      for (const { runtime, name: defaultName } of DEFAULT_WORKSPACE_TOOLSETS) {
        const current = get().workspaces.find((item) => item.id === workspaceId);
        const alreadyAssigned = Object.values(current?.profileToolsets ?? {}).includes(runtime);
        if (alreadyAssigned) continue;
        try {
          // Machine-wide inventory can belong to another account. Never adopt it.
          let name = defaultName;
          for (let suffix = 2; get().profiles.some((profile) => profile.name === name); suffix += 1) name = `${defaultName} ${suffix}`;
          name = await get().createManagedProfile(name, "US", { runtime });
          await get().assignProfileToProject(name, runtime, workspaceId);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("nextbrowser:profile-created", { detail: { name } }));
          }
        } catch (error) {
          console.warn("[AUTO_SETUP_PROFILE_FAILED]", runtime, error);
        }
      }
      await get().loadProfiles();
      const state = get();
      const stillRequired = requiresWorkspaceSetup(state.workspaces, state.conversations, state.activeWorkspaceId);
      set({ workspaceSetupRequired: stillRequired, workspaceSetupAuto: stillRequired ? "failed" : "done" });
    } catch (error) {
      console.error("[AUTO_SETUP_FAILED]", error);
      set({ workspaceSetupAuto: "failed" });
    } finally {
      defaultSetupInFlight = false;
    }
  },

  newChat: () => {
    const agentId = get().agentId;
    const workspaceId = get().activeWorkspaceId;
    const n = get().conversationsForAgent(agentId).length + 1;
    const c: Conversation = {
      id: uid(),
      title: `Chat ${n}`,
      agent: agentId,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
      executionTarget: "local",
      chatMode: "chat",
      workspaceId,
    };
    const conversations = [...get().conversations, c];
    persistConvs(conversations);
    localStorage.setItem(activeConversationStorageKey(agentId, workspaceId), c.id);
    set({
      conversations,
      activeConvId: { ...get().activeConvId, [agentId]: c.id },
      // A new chat is always chat-mode; without this the previous project's
      // terminal mode leaks into it.
      terminalChat: false,
    });
    trackEvent("chat_created", { agent: agentId, conversation_count: conversations.length });
    return c.id;
  },

  createProject: (name, mode, selectedAgentId) => {
    const agentId = selectedAgentId ?? get().agentId;
    if (!AGENTS.some((agent) => agent.id === agentId)) return "";
    const workspaceId = get().activeWorkspaceId;
    if (!workspaceId) return "";
    const cleanName = validateEntityName("project", name);
    const c: Conversation = {
      id: uid(),
      title: cleanName || `Project ${get().conversationsForAgent(agentId).length + 1}`,
      agent: agentId,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
      executionTarget: "local",
      chatMode: mode,
      profileNames: [],
      profileToolsets: {},
      workspaceId,
    };
    const conversations = [...get().conversations, c];
    persistConvs(conversations);
    localStorage.setItem(activeConversationStorageKey(agentId, workspaceId), c.id);
    localStorage.setItem("terminalChat", String(mode === "terminal"));
    set({
      conversations,
      activeConvId: { ...get().activeConvId, [agentId]: c.id },
      terminalChat: mode === "terminal",
      tab: "chat",
    });
    get().selectConversation(c.id);
    trackEvent("project_created", { agent: agentId, mode });
    return c.id;
  },

  assignProfileToProject: (profileName, toolset, projectId, replaceToolset = false, proxyId) => {
    const targetId = projectId ?? get().activeWorkspaceId;
    if (!targetId) return Promise.reject(new Error("Choose a workspace first."));
    return persistWorkspaceMutation((previous) => {
      if (!previous.some((workspace) => workspace.id === targetId)) throw new Error("Workspace no longer exists.");
      const existingToolset = previous.find((workspace) =>
        workspace.profileNames.includes(profileName)
      )?.profileToolsets?.[profileName];
      // A profile's runtime stays fixed while the profile exists, but a newly
      // created profile may reuse a deleted profile's name. Creation must
      // therefore replace stale workspace/cloud runtime metadata explicitly.
      const fixedToolset = replaceToolset ? toolset : existingToolset ?? toolset;
      const existingProxyId = previous.find((workspace) =>
        workspace.profileNames.includes(profileName)
      )?.profileProxyIds?.[profileName];
      const fixedProxyId = replaceToolset ? proxyId : existingProxyId ?? proxyId;
      const workspaces = previous.map((workspace) => {
        if (workspace.id === targetId && workspace.profileNames.includes(profileName)) {
          const profileProxyIds = { ...(workspace.profileProxyIds ?? {}) };
          if (fixedProxyId) profileProxyIds[profileName] = fixedProxyId;
          else delete profileProxyIds[profileName];
          return {
            ...workspace,
            profileToolsets: { ...workspace.profileToolsets, [profileName]: fixedToolset },
            profileProxyIds,
            updatedAt: now(),
          };
        }
        const withoutProfile = workspace.profileNames.filter((name) => name !== profileName);
        const toolsets = { ...workspace.profileToolsets };
        const profileProxyIds = { ...(workspace.profileProxyIds ?? {}) };
        delete toolsets[profileName];
        delete profileProxyIds[profileName];
        if (workspace.id !== targetId) {
          return { ...workspace, profileNames: withoutProfile, profileToolsets: toolsets, profileProxyIds,
            updatedAt: withoutProfile.length !== workspace.profileNames.length ? Math.max(now(), workspace.updatedAt + 1) : workspace.updatedAt };
        }
        if (fixedProxyId) profileProxyIds[profileName] = fixedProxyId;
        return {
          ...workspace,
          profileNames: [...withoutProfile, profileName],
          profileToolsets: { ...toolsets, [profileName]: fixedToolset },
          profileProxyIds,
          updatedAt: now(),
        };
      });
      return workspaces;
    });
  },

  setProfileChatOwner: (profileName, conversationId) => set((state) => {
    const profileChatOwners = { ...state.profileChatOwners };
    if (conversationId) profileChatOwners[profileName] = conversationId;
    else delete profileChatOwners[profileName];
    return { profileChatOwners };
  }),

  moveProfileToWorkspace: async (profileName, workspaceId) => {
    const state = get();
    if (state.projectsSyncing) throw new Error("Workspace sync is still in progress.");
    const status = state.statuses[profileName] ?? state.profileSessions[profileName]?.status ?? "stopped";
    if (["running", "starting", "stopping", "rotating"].includes(status)) {
      throw new Error("Stop the profile before moving it to another workspace.");
    }
    const previous = state.workspaces;
    const workspaces = moveProfileBetweenWorkspaces(previous, profileName, workspaceId, now());
    if (workspaces === previous) return;
    await saveWorkspaces(workspaces);
    set({ workspaces });
    try {
      await get().syncProjects();
      trackEvent("profile_workspace_changed", { profile: profileName, workspace_id: workspaceId });
    } catch (error) {
      await saveWorkspaces(previous);
      set({ workspaces: previous });
      throw error;
    }
  },

  reorderProfileInProject: (projectId, profileName, beforeProfileName) => {
    if (profileName === beforeProfileName) return Promise.resolve();
    return persistWorkspaceMutation((previous) => {
      const target = previous.find((workspace) => workspace.id === projectId);
      if (!target?.profileNames.includes(profileName) || !target.profileNames.includes(beforeProfileName)) throw new Error("Profile is no longer in this workspace.");
      const workspaces = previous.map((workspace) => {
        if (workspace.id !== projectId) return workspace;
        const names = workspace.profileNames.filter((name) => name !== profileName);
        const targetIndex = names.indexOf(beforeProfileName);
        if (targetIndex < 0) names.push(profileName);
        else names.splice(targetIndex, 0, profileName);
        return { ...workspace, profileNames: names, updatedAt: now() };
      });
      return workspaces;
    });
  },

  // Create a titled chat bound to a specific agent (used by scheduled runs to
  // spin up a dedicated chat for a task right from the editor). Does not change
  // the active chat/agent selection.
  createNamedChat: (agentId, title) => {
    const workspaceId = get().activeWorkspaceId;
    const clean = title.trim();
    const c: Conversation = {
      id: uid(),
      title: clean || `Chat ${get().conversationsForAgent(agentId).length + 1}`,
      agent: agentId,
      messages: [],
      createdAt: now(),
      updatedAt: now(),
      executionTarget: "local",
      workspaceId,
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

  changeEmptyProjectAgent: (id, agentId) => {
    const project = get().conversations.find((item) => item.id === id);
    if (!project || project.messages.length || project.chatMode === "terminal" || project.terminalPreview
      || project.executionTarget === "vps" || !AGENTS.some((agent) => agent.id === agentId)) return false;
    const conversations = get().conversations.map((item) => item.id === id ? { ...item, agent: agentId, updatedAt: now() } : item);
    const activeConvId = { ...get().activeConvId };
    if (activeConvId[project.agent] === id) {
      delete activeConvId[project.agent];
      localStorage.removeItem(activeConversationStorageKey(project.agent, project.workspaceId));
    }
    persistConvs(conversations);
    set({ conversations, activeConvId });
    get().selectConversation(id);
    return true;
  },

  selectConversation: (id) => {
    const project = get().conversations.find((conversation) => conversation.id === id);
    if (!project) return;
    const agentId = project.agent;
    trackEvent("chat_selected", { agent: agentId });
    const terminalChat = project.chatMode === "terminal";
    localStorage.setItem(activeConversationStorageKey(agentId, project.workspaceId), id);
    localStorage.setItem("lastAgent", agentId);
    localStorage.setItem("terminalChat", String(terminalChat));
    if (project.workspaceId) localStorage.setItem("activeWorkspaceId", project.workspaceId);
    set({ agentId, activeWorkspaceId: project.workspaceId ?? get().activeWorkspaceId,
      activeConvId: { ...get().activeConvId, [agentId]: id }, terminalChat });
    get().reconcileQueues();
    get().startConsumer(agentId);
    void get().recheckLogin(agentId);
  },

  renameConversation: (id, title) => {
    const t = title.trim();
    if (!t) return;
    set((s) => {
      const conversations = s.conversations.map((c) =>
        c.id === id ? { ...c, title: t, updatedAt: now() } : c,
      );
      persistConvs(conversations);
      trackEvent("chat_renamed", { agent: get().agentId });
      return { conversations };
    });
  },

  updateTerminalPreview: (id, preview) => {
    const clean = preview?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || undefined;
    const current = get().conversations.find((conversation) => conversation.id === id);
    if (!current || current.terminalPreview === clean) return;
    set((state) => {
      const conversations = state.conversations.map((conversation) =>
        conversation.id === id ? { ...conversation, terminalPreview: clean, updatedAt: now() } : conversation,
      );
      persistConvs(conversations);
      return { conversations };
    });
  },

  deleteConversation: async (id) => {
    if (deletingProjectIds.has(id) || deletedProjectIds.has(id)) return;
    deletingProjectIds.add(id);
    try {
      await invoke("project_delete", { id });
    } catch (error) {
      deletingProjectIds.delete(id);
      throw error;
    }
    deletingProjectIds.delete(id);
    deletedProjectIds.add(id);
    const removed = get().conversations.find((item) => item.id === id);
    const agentId = removed?.agent ?? get().agentId;
    // A streaming reply keeps its process alive after its conversation is
    // gone. finishAgentRun cannot clear it then (the owning message no longer
    // exists), which would leave the composer stuck on Stop for the rest of
    // the session. Terminate the run and clear its runtime marker here.
    const removedReplyIds = new Set(
      (removed?.messages ?? [])
        .filter((message) => message.status === "streaming")
        .map((message) => message.id),
    );
    for (const replyId of removedReplyIds) void invoke("agent_terminate", { replyId }).catch(() => {});
    const conversations = get().conversations.filter((c) => c.id !== id);
    const activeConvId = { ...get().activeConvId };
    if (activeConvId[agentId] === id) {
      activeConvId[agentId] = get()
        .conversationsForAgent(agentId)
        .filter((c) => c.id !== id)[0]?.id;
      const replacement = activeConvId[agentId];
      if (replacement) localStorage.setItem(activeConversationStorageKey(agentId, get().activeWorkspaceId), replacement);
      else localStorage.removeItem(activeConversationStorageKey(agentId, get().activeWorkspaceId));
    }
    persistConvs(conversations);
    const projectRevisions = { ...get().projectRevisions };
    delete projectRevisions[id];
    set((s) => {
      const runtime = { ...s.runtime };
      const removedQueueReplyIds = new Set<string>();
      for (const [key, value] of Object.entries(runtime)) {
        // Drop queued replies for the deleted chat too. If one is dequeued
        // later it sets runningReplyId, and finishAgentRun cannot clear it once
        // the owning conversation is gone — leaving the composer stuck on Stop.
        const queue = value.queue.filter((item) => {
          if (item.conversationId === id) {
            removedQueueReplyIds.add(item.replyId);
            return false;
          }
          return true;
        });
        const runningRemoved = !!value.runningReplyId
          && (removedReplyIds.has(value.runningReplyId) || removedQueueReplyIds.has(value.runningReplyId));
        if (queue.length !== value.queue.length || runningRemoved) {
          runtime[key] = {
            ...value,
            queue,
            ...(runningRemoved ? { runningReplyId: undefined, pendingStop: false } : {}),
          };
        }
      }
      // Drop profile ownership that pointed at the deleted chat, or a later
      // same-named profile advertises "In use · <old chat>".
      const profileChatOwners = { ...s.profileChatOwners };
      for (const [profileName, ownerConversationId] of Object.entries(profileChatOwners)) {
        if (ownerConversationId === id) delete profileChatOwners[profileName];
      }
      return { conversations, activeConvId, projectRevisions, runtime, profileChatOwners };
    });
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
      executionTarget: conv.executionTarget,
      vpsConnectionInstructions: conv.vpsConnectionInstructions,
      vpsConnectionLabel: conv.vpsConnectionLabel,
      // Without these the fork is invisible in the workspace-filtered chat pane
      // and loses terminal mode.
      workspaceId: conv.workspaceId,
      chatMode: conv.chatMode,
      profileNames: conv.profileNames,
      profileToolsets: conv.profileToolsets,
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
        c.id === cid
          ? { ...c, messages: [], executionTarget: "local" as const, vpsConnectionInstructions: undefined, vpsConnectionLabel: undefined, updatedAt: now() }
          : c,
      );
      persistConvs(conversations);
      trackEvent("chat_cleared", { agent: get().agentId });
      // Drop queued replies for the cleared chat: an orphaned item would run
      // later, set runningReplyId, and stick the composer on Stop.
      const runtime = { ...s.runtime };
      for (const [key, value] of Object.entries(runtime)) {
        const queue = value.queue.filter((item) => item.conversationId !== cid);
        if (queue.length !== value.queue.length) runtime[key] = { ...value, queue };
      }
      return { conversations, runtime };
    });
  },

  enqueue: (text, chip, into, attachments = [], agentPrompt) => {
    if (hasVPSPromptMarker(text)) return;
    return enqueueWithTarget(text, chip, into, attachments, undefined, agentPrompt);
  },

  stopRunning: () => {
    const agentId = get().agentId;
    const replyId = get().runtime[agentId]?.runningReplyId;
    if (!replyId) return;
    get().stopReply(replyId);
  },

  stopReply: (replyId) => {
    const agentId = Object.entries(get().runtime).find(([, runtime]) => runtime.runningReplyId === replyId)?.[0];
    if (!agentId) return;
    trackEvent("agent_turn_stop_requested", { agent: agentId });
    set((s) => ({
      runtime: {
        ...s.runtime,
        [agentId]: { ...s.runtime[agentId], pendingStop: true },
      },
    }));
    const conversation = get().conversations.find((candidate) =>
      candidate.messages.some((message) => message.id === replyId),
    );
    const conversationId = conversation?.id;
    const ownedProfiles = conversationId
      ? Object.entries(get().profileChatOwners)
        .filter(([, owner]) => owner === conversationId)
        .map(([profile]) => profile)
      : [];
    const baseline = replyProfileBaselines.get(replyId) ?? new Set<string>();
    const workspaceProfiles = get().workspaces.find((workspace) => workspace.id === conversation?.workspaceId)?.profileNames ?? [];
    void invoke("agent_terminate", { replyId }).finally(() => {
      void get().loadProfiles().catch(() => undefined).finally(() => {
        const newlyStarted = workspaceProfiles.filter((profile) => get().statuses[profile] === "running" && !baseline.has(profile));
        const targets = [...new Set([...ownedProfiles, ...newlyStarted])];
        void Promise.all(targets.map((profile) => get().stopProfile(profile).catch(() => undefined)));
      });
    });
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
    const cancelledItem = get().runtime[agentId]?.queue.find((item) => item.replyId === replyId);
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
        const resetVPS = cancelledItem?.executionTarget === "vps" &&
          !msgs.some((message) => message.role !== "system");
        return resetVPS
          ? {
              ...c,
              title: "Chat",
              messages: msgs,
              executionTarget: "local" as const,
              vpsConnectionInstructions: undefined,
              vpsConnectionLabel: undefined,
              updatedAt: now(),
            }
          : { ...c, messages: msgs, updatedAt: now() };
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
    const queuedItem = get().runtime[agentId]?.queue.find((item) => item.replyId === replyId);
    if (queuedItem?.executionTarget === "local" && hasVPSPromptMarker(text)) return false;
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

  sendVPSPrompt: async (text, connectionLabel) => {
    if (!hasVPSPromptMarker(text)) throw new Error("Invalid VPS prompt.");
    if (queuedTarget(get(), "local")) {
      throw new Error("Finish or cancel queued local work before starting a VPS task.");
    }
    vpsSetupReservations += 1;
    try {
      await waitForLocalNextctlIdle(get);
      if (queuedTarget(get(), "local")) {
        throw new Error("Finish or cancel queued local work before starting a VPS task.");
      }
      trackEvent("vps_prompt_used", { tab: "chat" });
      set({ tab: "chat" });
      if (!get().agentReady()) {
        if (get().runtime[get().agentId]?.authorizing) {
          throw new Error("The agent is still connecting. Wait a moment and try again.");
        }
        await get().authorizeAgent({ skipNextctlSetup: true });
      }
      if (!get().agentReady()) {
        throw new Error(get().agentError() || "The selected agent could not connect.");
      }
      const activeConversation = get().activeConversation();
      const conversationId = activeConversation && activeConversation.messages.length === 0
        ? activeConversation.id
        : get().newChat();
      const label = connectionLabel?.trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160);
      const title = label ? `VPS · ${label.slice(0, 48)}` : "VPS";
      set((state) => {
        const conversations = state.conversations.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                title,
                executionTarget: "vps" as const,
                vpsConnectionInstructions: vpsConnectionInstructions(text),
                vpsConnectionLabel: label || undefined,
                updatedAt: now(),
              }
            : conversation,
        );
        persistConvs(conversations);
        return {
          conversations,
          activeConvId: { ...state.activeConvId, [state.agentId]: conversationId },
        };
      });
      enqueueWithTarget(text, undefined, conversationId, [], "vps");
    } finally {
      vpsSetupReservations = Math.max(0, vpsSetupReservations - 1);
      if (!pendingTarget(get(), "vps")) {
        for (const [queuedAgentId, runtime] of Object.entries(get().runtime)) {
          if (runtime.ready && runtime.queue.length) get().startConsumer(queuedAgentId);
        }
      }
    }
  },

  applySkill: async (entry) => {
    if (AGENTS.some((agent) => get().skillState[skillKey(agent.id, entry.id)] === "applying")) {
      throw new Error("This skill is already being applied.");
    }
    if (entry.selector.kind !== "script" && pendingTarget(get(), "vps")) {
      throw new Error("Local skill checks are paused while VPS work is queued or running.");
    }
    const startedAt = performance.now();
    trackEvent("skill_apply_started", {
      category: entry.category,
      selector_kind: entry.selector.kind,
    });
    if (entry.source === "repository" && entry.instructions) {
      set((s) => ({
        skillState: {
          ...s.skillState,
          [skillKey(s.agentId, entry.id)]: "installed",
        },
      }));
      trackTiming("skill_apply_completed", startedAt, {
        category: entry.category,
        source: "repository",
      });
      return {
        found: true,
        slug: entry.id.replace(/^repository:/, ""),
        title: entry.title,
        kind: "domain",
        selector: entry.selector.value,
      };
    }
    if (entry.selector.kind === "script") {
      const existing = get().appliedScripts.some((script) => script.id === entry.id);
      const appliedScripts = existing ? get().appliedScripts : [...get().appliedScripts, entry];
      persistAppliedScripts(appliedScripts);
      set((s) => ({
        appliedScripts,
        skillState: {
          ...s.skillState,
          [skillKey(s.agentId, entry.id)]: "installed",
        },
      }));
      trackTiming("script_apply_completed", startedAt, {
        category: entry.category,
        existing,
      });
      return {
        found: true,
        slug: entry.id,
        title: entry.title,
        kind: "domain",
        selector: entry.selector.value,
      };
    }
    const targets = AGENTS.map((agent) => ({
      id: agent.id,
      adapter: nextctlAgentAdapter(agent.id),
    }));
    set((s) => {
      const skillState = { ...s.skillState };
      for (const target of targets) skillState[skillKey(target.id, entry.id)] = "applying";
      delete skillState[skillKey(get().agentId, `${entry.id}:error`)];
      return { skillState };
    });
    if (!get().nextctlSupportsSkill) {
      set((s) => {
        const skillState = { ...s.skillState };
        for (const target of targets) skillState[skillKey(target.id, entry.id)] = "failed";
        return { skillState };
      });
      trackTiming("skill_apply_failed", startedAt, {
        category: entry.category,
        reason: "unsupported_nextctl",
      });
      set((s) => ({
        skillState: {
          ...s.skillState,
          [skillKey(get().agentId, `${entry.id}:error`)]: internalError("We couldn't prepare skills.", "SKILLS_PREPARE_FAILED"),
        },
      }));
      return undefined;
    }
    let activeRef: SkillRef | undefined;
    let anyRef: SkillRef | undefined;
    let failures = 0;
    for (const target of targets) {
      const key = skillKey(target.id, entry.id);
      try {
        const ref = await nextctlJson<SkillRef>([
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
        requestAccountSignIn(set, error);
        failures += 1;
        set((s) => ({ skillState: { ...s.skillState, [key]: "failed" } }));
      }
    }
    if (!activeRef && !anyRef && failures > 0) {
      const message = internalError("We couldn't install this skill.", "SKILL_INSTALL_FAILED");
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
    if (!activeRef && anyRef) {
      set((s) => ({
        skillState: (() => {
          const skillState = { ...s.skillState };
          skillState[skillKey(get().agentId, entry.id)] = "installed";
          delete skillState[skillKey(get().agentId, `${entry.id}:error`)];
          return skillState;
        })(),
      }));
      trackEvent("skill_apply_active_agent_fallback", {
        category: entry.category,
        selector_kind: entry.selector.kind,
        active_agent: get().agentId,
        installed_slug: anyRef.slug ?? "unknown",
      });
    }
    trackTiming("skill_apply_completed", startedAt, {
      category: entry.category,
      selector_kind: entry.selector.kind,
      installed: !!(activeRef ?? anyRef),
    });
    return activeRef ?? anyRef;
  },

  useSkillInChat: async (entry, task, options) => {
    if (!get().agentReady()) return;
    trackEvent("skill_used_in_chat", {
      category: entry.category,
      selector_kind: entry.selector.kind,
      has_task: !!task?.trim(),
      background: !!options?.background,
    });
    if (!options?.background) set({ tab: "chat" });
    const target = entry.selector.kind === "current_tab" ? "the current tab" : entry.selector.value;
    const requested = options?.conversationId;
    const cid = (requested && get().conversations.some((conversation) => conversation.id === requested) ? requested : undefined)
      ?? get().activeConversation()?.id
      ?? get().newChat();
    const remoteOnly = get().conversations.find((conversation) => conversation.id === cid)?.executionTarget === "vps";
    if (remoteOnly) {
      const chip: UserCommandChip = { kind: "skill", title: entry.title, detail: target };
      const thisRun = task?.trim() ? `\n\nTask for this run:\n${task.trim()}` : "";
      const prompt = entry.instructions
        ? `Use the "${entry.title}" repository skill for ${target} on the selected VPS only. Do not prepare, open, inspect, or change any local Nextbrowser session.${thisRun}\n\nFollow this SKILL.md exactly:\n\n${entry.instructions}`
        : `Use the "${entry.title}" skill for ${target} on the selected VPS only. Do not prepare, open, inspect, or change any local Nextbrowser session. Use only skill instructions and browser tooling that are already available on the VPS; if the skill is missing there, report that without installing it.${entry.description ? `\n\nSkill description: ${entry.description}` : ""}${thisRun}`;
      get().enqueue(prompt, chip, cid);
      return;
    }

    let ref: SkillRef | undefined;
    try {
      ref = await get().applySkill(entry);
    } catch {
      const cidForError = get().activeConversation()?.id ?? get().newChat();
      const errMsg: ChatMessage = {
        id: uid(),
        role: "system",
        text: internalError(`We couldn't apply "${entry.title}".`, "SKILL_APPLY_FAILED"),
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
    if (entry.runtime === "cloud-phone") {
      // The site is driven in its Android app on a Multilogin cloud phone, so
      // no browser profile is prepared: the phone comes from the workspace's
      // Multilogin selection, and the skill text says how to reach it.
      const workspaceId = get().conversations.find((conversation) => conversation.id === cid)?.workspaceId;
      // A watchlist skill picks its phone in its own panel, so that choice wins
      // over the workspace's; a skill without one still follows the workspace.
      const phone = cloudPhoneFromSelection(
        get().watchlistDevices[entry.id] ?? multiloginSelectionForWorkspace(workspaceId),
      );
      const stepId = get().makeStepMessage(cid);
      get().appendStep(cid, stepId, phone ? `Cloud phone “${phone.name}”` : "No cloud phone selected");
      const md = entry.instructions ?? await installedSkillMarkdown(ref) ?? "";
      const chip: UserCommandChip = { kind: "skill", title: entry.title, detail: phone?.name ?? target };
      get().enqueue(cloudPhoneSkillPrompt(entry.title, target, md, phone, task), chip, cid);
      return;
    }
    const stepId = get().makeStepMessage(cid);
    let prep;
    try {
      prep = await prepareLocalSession({
        host: selectorTargetHost(entry.selector),
        // A watchlist skill signs in with its own profile in the panel, so its
        // passes have to run in that one rather than the sidebar's selection.
        selectedProfile: get().watchlistProfiles[entry.id] ?? get().selectedProfile,
        statuses: get().statuses,
        defaultSession: get().defaultSession,
        onStep: (step) => get().appendStep(cid, stepId, step),
      });
    } catch (error) {
      get().failStep(cid, stepId, error);
      trackEvent("session_preflight_failed", { source: "skill" });
      return;
    }

    const md = entry.instructions ?? await installedSkillMarkdown(ref);

    const chip: UserCommandChip = { kind: "skill", title: entry.title, detail: target };
    const prompt = skillAgentPrompt(
      entry.title,
      target,
      md,
      ref?.slug ?? ref?.title,
      prep.host,
      prep.directFallback,
      task,
      entry.selector.kind === "current_tab",
    );
    get().enqueue(prompt, chip, cid);
    await get().loadDefaultSession();
  },

  addWatchedProfile: (skillId, rawHandle) => {
    const handle = normalizeWatchHandle(rawHandle, { maxLength: watchHandleMaxLength(get(), skillId) });
    if (!handle || !skillId) return undefined;
    const existing = get().watchedProfiles.find(
      (item) => item.skillId === skillId && sameWatchHandle(item.handle, handle),
    );
    if (existing) return existing;
    const profile: WatchedProfile = { id: uid(), skillId, handle, enabled: true, addedAt: now() };
    const watchedProfiles = [...get().watchedProfiles, profile];
    persistWatchedProfiles(watchedProfiles);
    set({ watchedProfiles });
    trackEvent("watched_profile_added", { skill: skillId, watched_count: watchedProfiles.length });
    return profile;
  },

  removeWatchedProfile: (id) => {
    const profile = get().watchedProfiles.find((item) => item.id === id);
    const watchedProfiles = get().watchedProfiles.filter((item) => item.id !== id);
    persistWatchedProfiles(watchedProfiles);
    set({ watchedProfiles });
    if (profile) trackEvent("watched_profile_removed", { skill: profile.skillId, watched_count: watchedProfiles.length });
  },

  setWatchedProfileEnabled: (id, enabled) => {
    const watchedProfiles = get().watchedProfiles.map((item) => (item.id === id ? { ...item, enabled } : item));
    persistWatchedProfiles(watchedProfiles);
    set({ watchedProfiles });
  },

  watchedProfilesFor: (skillId) =>
    get().watchedProfiles.filter((item) => item.skillId === skillId),

  watchReportFor: (skillId, handle) =>
    get().watchReports[watchReportKey(skillId, handle)],

  watchPublisherFor: (skillId) => get().watchPublishers[skillId],

  // The state file belongs to the agent, so the app only ever reads it. A
  // missing or malformed file leaves the panel showing what the user added,
  // without agent-side detail.
  loadWatchReports: async (entry) => {
    const name = entry.watchlist?.stateFile;
    if (!name) return;
    let raw: string | null = null;
    try {
      raw = await invoke<string | null>("workspace_file_read", { name });
    } catch {
      raw = null;
    }
    const parsed = parseWatchState(raw, { maxLength: entry.watchlist?.handleMaxLength });
    set((state) => {
      const watchReports = { ...state.watchReports };
      for (const key of Object.keys(watchReports)) {
        if (key.startsWith(`${entry.id}\n`)) delete watchReports[key];
      }
      for (const report of Object.values(parsed.reports)) {
        watchReports[watchReportKey(entry.id, report.handle)] = report;
      }
      const watchPublishers = { ...state.watchPublishers };
      if (parsed.publisher) watchPublishers[entry.id] = parsed.publisher;
      else delete watchPublishers[entry.id];
      return { watchReports, watchPublishers };
    });
  },

  subscribeWatchedProfile: async (entry, profileId) => {
    const profile = get().watchedProfiles.find((item) => item.id === profileId);
    if (!entry.watchlist || !profile) return;
    const watchedProfiles = get().watchedProfiles.map((item) =>
      item.id === profileId ? { ...item, subscribeQueuedAt: now() } : item,
    );
    persistWatchedProfiles(watchedProfiles);
    set({ watchedProfiles });
    trackEvent("watched_profile_subscribe_queued", { skill: entry.id });
    const transport = get().watchlistTransportFor(entry);
    await get().useSkillInChat(
      transportEntry(entry, transport),
      fillTemplate(transport.subscribeTask, { handle: profile.handle }),
    );
  },

  runWatchlistPass: async (entry, options) => {
    const watchlist = entry.watchlist;
    if (!watchlist) return;
    // A skill with an engine runs in app code. The chat path below is the
    // fallback for skills that only ship instructions.
    if (watchlist.engine === "x-reply") {
      await get().runXReplyPass(entry);
      return;
    }
    const prefix = watchlist.prefix ?? "";
    const transport = get().watchlistTransportFor(entry);
    const runOn = transportEntry(entry, transport);
    const active = get().watchedProfilesFor(entry.id).filter((item) => item.enabled);
    if (!active.length) {
      await get().useSkillInChat(runOn, undefined, options);
      return;
    }
    const startedAt = now();
    const watchedProfiles = get().watchedProfiles.map((item) =>
      active.some((candidate) => candidate.id === item.id) ? { ...item, lastRunAt: startedAt } : item,
    );
    persistWatchedProfiles(watchedProfiles);
    set({ watchedProfiles });
    trackEvent("watchlist_pass_queued", { skill: entry.id, watched_count: active.length });
    const handles = active.map((item) => `${prefix}${item.handle}`).join(", ");
    await get().useSkillInChat(runOn, fillTemplate(transport.checkTask, { handles }), options);
  },

  // The engine, not the agent, performs a pass: detection, the publish gates,
  // watermarks and limits are code, and the agent is called once per post only
  // to write the reply itself.
  runXReplyPass: async (entry) => {
    if (get().xReplyBusy) return;
    if (!get().agentReady()) return;
    if (pendingTarget(get(), "vps")) return;
    const handles = get().watchedProfilesFor(entry.id).filter((item) => item.enabled).map((item) => item.handle);
    if (!handles.length) return;

    xReplyStopRequested = false;
    set({ xReplyBusy: true, xReplyStep: "Preparing the browser session", xReplySignInNeeded: false });
    xlog("run.start", { profile: get().xReplyState.profileName ?? get().selectedProfile, handles, app: __APP_VERSION__ });
    try {
      const profileArgs = await prepareXReplySession(undefined, (step) => set({ xReplyStep: step }));
      xlog("run.session", { profileArgs });
      const { state, summary } = await runPass({
        browser: cliBrowser(profileArgs),
        agentId: get().agentId,
        runAgent: runDraftAgent,
        handles,
        state: get().xReplyState,
        now,
        newId: uid,
        onStep: (step) => set({ xReplyStep: step }),
        shouldStop: () => xReplyStopRequested,
      });
      persistXReplyState(state);
      // A pass that found the profile signed out asks for a sign-in rather than
      // leaving the panel to guess why nothing happened.
      set({ xReplyState: state, xReplySignInNeeded: summary.loginRequired });
      trackEvent("x_reply_pass_finished", { watched_count: handles.length, sent: summary.sent });
    } catch (error) {
      xlog("run.error", { error: xReplyErrorText(error) });
      const state: XReplyState = {
        ...get().xReplyState,
        lastPassAt: now(),
        lastPassSummary: friendlyXReplyError(error),
        lastPassNotes: undefined,
      };
      persistXReplyState(state);
      set({ xReplyState: state });
      trackEvent("x_reply_pass_failed", {});
    } finally {
      set({ xReplyBusy: false, xReplyStep: undefined });
    }
  },

  // Opening the site is how a user signs in: the app prepares the profile and
  // puts x.com on screen, and the person types their own credentials there.
  openSkillSite: async (entry) => {
    const host = selectorTargetHost(entry.selector);
    if (!host || get().xReplyBusy) return;
    set({ xReplyBusy: true, xReplyStep: `Opening ${host}` });
    try {
      const profileArgs = await prepareXReplySession(undefined, (step) => set({ xReplyStep: step }));
      await openNotifications(cliBrowser(profileArgs));
    } catch (error) {
      set({ xReplyState: { ...get().xReplyState, lastPassSummary: friendlyXReplyError(error) } });
    } finally {
      set({ xReplyBusy: false, xReplyStep: undefined });
    }
  },

  // Reading who is signed in is the first step of the panel's flow: the list
  // only makes sense once x.com knows the user.
  checkXReplySignIn: async (_entry) => {
    if (get().xReplyBusy) return get().xReplyState.publisher?.signedIn === true;
    set({ xReplyBusy: true, xReplyStep: "Checking the signed-in account" });
    try {
      const profileArgs = await prepareXReplySession(undefined, (step) => set({ xReplyStep: step }));
      const browser = cliBrowser(profileArgs);
      // Identity lives in the page chrome, so the check happens on the feed —
      // which is also where a signed-in user wants to end up.
      await openNotifications(browser);
      const publisher = await readPublisher(browser);
      const xReplyState: XReplyState = { ...get().xReplyState, publisher: { ...publisher, checkedAt: now() } };
      persistXReplyState(xReplyState);
      set({ xReplyState, xReplySignInNeeded: !publisher.signedIn });
      trackEvent("x_reply_sign_in_checked", { signed_in: publisher.signedIn });
      return publisher.signedIn;
    } catch (error) {
      set({ xReplyState: { ...get().xReplyState, lastPassSummary: friendlyXReplyError(error) } });
      return false;
    } finally {
      set({ xReplyBusy: false, xReplyStep: undefined });
    }
  },

  dismissXReplySignIn: () => set({ xReplySignInNeeded: false }),

  // Adding an account subscribes it right away: the bell goes on and the
  // account's current position is recorded, so the first pass answers what
  // comes next instead of the whole visible timeline.
  subscribeXReplyHandle: async (_entry, handle) => {
    if (get().xReplyBusy) return;
    set({ xReplyBusy: true, xReplyStep: `Subscribing to @${handle}`, xReplySignInNeeded: false });
    xlog("run.start", { profile: get().xReplyState.profileName ?? get().selectedProfile, subscribe: handle, app: __APP_VERSION__ });
    try {
      const profileArgs = await prepareXReplySession(undefined, (step) => set({ xReplyStep: step }));
      const result = await subscribeHandle({
        browser: cliBrowser(profileArgs),
        handle,
        state: get().xReplyState,
        now,
        onStep: (step) => set({ xReplyStep: step }),
      });
      persistXReplyState(result.state);
      set({ xReplyState: result.state, xReplySignInNeeded: !result.signedIn });
      trackEvent("x_reply_handle_subscribed", { signed_in: result.signedIn, noted: !!result.note });
    } catch (error) {
      xlog("run.error", { error: xReplyErrorText(error) });
      const xReplyState = { ...get().xReplyState, lastPassSummary: friendlyXReplyError(error) };
      persistXReplyState(xReplyState);
      set({ xReplyState });
    } finally {
      set({ xReplyBusy: false, xReplyStep: undefined });
    }
  },

  updateXReplySettings: (patch) => {
    const xReplyState = normalizeXReplyState({ ...get().xReplyState, ...patch });
    persistXReplyState(xReplyState);
    set({ xReplyState });
  },

  watchlistRunFor: (skillId) => get().watchlistRuns.find((run) => run.skillId === skillId),

  watchlistTransportFor: (entry) =>
    resolveWatchlistTransport(entry.watchlist!, get().watchlistTransports[entry.id], entry.runtime),

  watchlistProfileFor: (skillId) => get().watchlistProfiles[skillId],

  watchlistDeviceFor: (skillId) => get().watchlistDevices[skillId],

  setWatchlistDevice: (entry, device) => {
    const watchlistDevices = { ...get().watchlistDevices };
    if (device) watchlistDevices[entry.id] = device;
    else delete watchlistDevices[entry.id];
    persistWatchlistDevices(watchlistDevices);
    // Another phone is another Reddit install with its own session.
    const watchlistSignIns = { ...get().watchlistSignIns };
    delete watchlistSignIns[entry.id];
    set({ watchlistDevices, watchlistSignIns });
  },

  setWatchlistProfile: (entry, profileName) => {
    const watchlistProfiles = { ...get().watchlistProfiles };
    if (profileName) watchlistProfiles[entry.id] = profileName;
    else delete watchlistProfiles[entry.id];
    persistWatchlistProfiles(watchlistProfiles);
    // A different profile is a different browser with its own cookies, so who
    // was signed in no longer says anything about this one.
    const watchlistSignIns = { ...get().watchlistSignIns };
    delete watchlistSignIns[entry.id];
    set({ watchlistProfiles, watchlistSignIns });
  },

  /** openWatchlistSite puts the skill's own profile on the page that names the
   *  signed-in account, which is where a user signs in by hand. The app never
   *  types the credentials: it opens the window and gets out of the way. */
  openWatchlistSite: async (entry) => {
    const signIn = watchlistSignInFor(get(), entry);
    if (!signIn || get().watchlistBusy) return;
    const device = get().watchlistDevices[entry.id];
    if (signInIsForDevice(signIn)) {
      // A phone has no page to open: the way in is the screen itself, so this
      // starts Live View and the user signs in on the phone with their hands.
      if (!device) {
        set({ watchlistStep: "Pick a cloud phone first" });
        setTimeout(() => set({ watchlistStep: undefined }), 4000);
        return;
      }
      set({ watchlistBusy: entry.id, watchlistStep: `Opening ${device.name}` });
      try {
        await get().startRemoteStream({ runtime: "multilogin", selection: device });
      } catch (error) {
        set({ watchlistStep: friendlyXReplyError(error) });
      } finally {
        set({ watchlistBusy: undefined });
        setTimeout(() => set({ watchlistStep: undefined }), 4000);
      }
      return;
    }
    set({ watchlistBusy: entry.id, watchlistStep: `Opening ${selectorTargetHost(entry.selector) || signIn.url}` });
    try {
      const browser = await watchlistBrowser(entry, (step) => set({ watchlistStep: step }));
      await browser.open(signIn.url);
    } catch (error) {
      set({ watchlistStep: friendlyXReplyError(error) });
      return;
    } finally {
      set({ watchlistBusy: undefined });
      setTimeout(() => set({ watchlistStep: undefined }), 4000);
    }
    await get().checkWatchlistSignIn(entry);
  },

  /** checkWatchlistSignIn reads the account off the site itself rather than
   *  trusting what a previous pass recorded, because the usual reason a pass
   *  does nothing is that the profile quietly signed out since. */
  checkWatchlistSignIn: async (entry) => {
    const signIn = watchlistSignInFor(get(), entry);
    if (!signIn) return true;
    if (get().watchlistBusy) return get().watchlistSignIns[entry.id]?.signedIn === true;
    const device = get().watchlistDevices[entry.id];
    if (signInIsForDevice(signIn) && !device) {
      set({ watchlistStep: "Pick a cloud phone first" });
      setTimeout(() => set({ watchlistStep: undefined }), 4000);
      return false;
    }
    set({ watchlistBusy: entry.id, watchlistStep: "Checking the signed-in account" });
    try {
      let probed: { signed_in?: boolean; handle?: string };
      if (signInIsForDevice(signIn)) {
        const args = signIn.command.map((arg) => arg.replace("{device}", device!.name));
        const data = await nextctlJson<unknown>(args);
        const handle = signIn.handlePath ? readPath(data, signIn.handlePath) : undefined;
        probed = {
          signed_in: readPath(data, signIn.signedInPath) === true,
          handle: typeof handle === "string" ? handle : undefined,
        };
      } else {
        const browser = await watchlistBrowser(entry, (step) => set({ watchlistStep: step }));
        await browser.open(signIn.url);
        probed = await browser.evaluate<{ signed_in?: boolean; handle?: string }>(signIn.probe);
      }
      const publisher: WatchedPublisher = {
        handle: probed?.handle || undefined,
        signedIn: probed?.signed_in === true,
        checkedAt: now(),
      };
      set({ watchlistSignIns: { ...get().watchlistSignIns, [entry.id]: publisher } });
      trackEvent("watchlist_sign_in_checked", { skill: entry.id, signed_in: publisher.signedIn === true });
      return publisher.signedIn === true;
    } catch (error) {
      set({ watchlistStep: friendlyXReplyError(error) });
      return false;
    } finally {
      set({ watchlistBusy: undefined });
      setTimeout(() => set({ watchlistStep: undefined }), 4000);
    }
  },

  setWatchlistTransport: (entry, transportId) => {
    if (!entry.watchlist) return;
    // Switching device mid-loop would run the next pass somewhere the user did
    // not choose it, so the loop stops and they start it again deliberately.
    if (get().watchlistRunFor(entry.id)?.enabled) get().stopWatchlistRun(entry.id);
    const watchlistTransports = { ...get().watchlistTransports, [entry.id]: transportId };
    persistWatchlistTransports(watchlistTransports);
    set({ watchlistTransports });
    trackEvent("watchlist_transport_selected", { skill: entry.id, transport: transportId });
  },

  startWatchlistRun: async (entry, intervalMinutes) => {
    if (!entry.watchlist) return;
    const existing = get().watchlistRunFor(entry.id);
    const interval = clampWatchlistInterval(intervalMinutes ?? existing?.intervalMinutes ?? DEFAULT_WATCHLIST_INTERVAL_MINUTES);
    let conversationId = existing?.conversationId;
    if (!entry.watchlist.engine
      && (!conversationId || !get().conversations.some((conversation) => conversation.id === conversationId))) {
      conversationId = get().newChat();
      get().renameConversation(conversationId, entry.title);
    }
    const run: WatchlistRun = {
      skillId: entry.id,
      enabled: true,
      intervalMinutes: interval,
      conversationId,
      lastRunAt: existing?.lastRunAt,
      nextRunAt: now(),
    };
    const watchlistRuns = [...get().watchlistRuns.filter((item) => item.skillId !== entry.id), run];
    persistWatchlistRuns(watchlistRuns);
    set({ watchlistRuns });
    trackEvent("watchlist_run_started", { skill: entry.id, interval_minutes: interval });
    // Start means start: the first pass goes out now rather than one interval
    // from now, so switching the loop on visibly does something.
    await get().tickWatchlistRuns();
  },

  stopWatchlistRun: (skillId) => {
    const run = get().watchlistRunFor(skillId);
    if (!run) return;
    const watchlistRuns = get().watchlistRuns.map((item) =>
      item.skillId === skillId ? { ...item, enabled: false, nextRunAt: undefined } : item,
    );
    persistWatchlistRuns(watchlistRuns);
    set({ watchlistRuns });
    trackEvent("watchlist_run_stopped", { skill: skillId });
    // An engine pass checks this between steps and stops there. A draft in
    // flight is a CLI process the pass is awaiting, which the flag alone cannot
    // interrupt, so it is ended here.
    xReplyStopRequested = true;
    if (xReplyDraftReplyId) void invoke("agent_terminate", { replyId: xReplyDraftReplyId }).catch(() => undefined);

    // Stop also ends the pass that is already out: a loop the user switched off
    // must not keep driving the browser for another few minutes.
    const conversation = get().conversations.find((item) => item.id === run.conversationId);
    if (!conversation) return;
    for (const message of conversation.messages) {
      if (message.role !== "assistant") continue;
      if (message.status === "queued") get().cancelQueuedReply(message.id);
      else if (message.status === "streaming" && get().runtime[get().agentId]?.runningReplyId === message.id) {
        get().stopRunning();
      }
    }
  },

  tickWatchlistRuns: async () => {
    const due = get().watchlistRuns.filter((run) => run.enabled && (run.nextRunAt ?? 0) <= now());
    if (!due.length) return;
    // A pass drives the local browser profile, so it never runs against a
    // conversation pinned to a VPS and never overlaps VPS setup.
    if (pendingTarget(get(), "vps")) return;
    if (!get().agentReady()) return;

    for (const run of due) {
      const entry = get().skillCategories
        .flatMap((category) => category.entries)
        .find((candidate) => candidate.id === run.skillId);
      if (!entry?.watchlist) continue;
      const conversation = get().conversations.find((item) => item.id === run.conversationId);
      // A pass still running holds the next one back instead of stacking two
      // runs onto one browser profile.
      const busy = entry.watchlist.engine
        ? get().xReplyBusy
        : conversation?.messages.some(
          (message) => message.role === "assistant" && (message.status === "queued" || message.status === "streaming"),
        );
      if (busy) continue;
      const startedAt = now();
      const watchlistRuns = get().watchlistRuns.map((item) =>
        item.skillId === run.skillId
          ? { ...item, lastRunAt: startedAt, nextRunAt: startedAt + item.intervalMinutes * 60_000 }
          : item,
      );
      persistWatchlistRuns(watchlistRuns);
      set({ watchlistRuns });
      trackEvent("watchlist_run_fired", { skill: run.skillId, interval_minutes: run.intervalMinutes });
      await get().runWatchlistPass(entry, { conversationId: run.conversationId, background: true });
    }
  },

  runScript: async (entry, host = "") => {
    const onHost = host.trim();
    const scriptJS = entry.js || publicScriptJavaScript(entry.selector.value);
    trackEvent("script_run_started", {
      script_type: scriptJS ? "local_eval" : "agent_skill",
      has_host: !!onHost,
      category: entry.category,
    });
    const activeConversation = get().activeConversation();
    if (activeConversation?.executionTarget === "vps") {
      set({ tab: "chat" });
      const where = onHost ? `on ${onHost}` : "in the remote browser session";
      const scriptBody = scriptJS
        ? `Run this JavaScript through the already-installed remote nextctl browser evaluation command:\n\n\`\`\`javascript\n${scriptJS}\n\`\`\``
        : `Use the already-available remote script or skill identified by ${entry.selector.value}. If it is missing on the VPS, report that without installing it.`;
      const prompt = `Run "${entry.title}" ${where} on the selected VPS only. Do not prepare, open, inspect, evaluate, or change any local Nextbrowser session. ${scriptBody}`;
      get().enqueue(prompt, {
        kind: "script",
        title: entry.title,
        detail: onHost || "VPS",
      }, activeConversation.id);
      trackEvent("script_run_queued", { script_type: scriptJS ? "remote_eval" : "remote_agent_skill", has_host: !!onHost });
      return;
    }
    if (scriptJS) {
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
      let prep;
      try {
        prep = await prepareLocalSession({
          host: onHost || undefined,
          selectedProfile: get().selectedProfile,
          statuses: get().statuses,
          defaultSession: get().defaultSession,
          onStep: (step) => get().appendStep(cid, stepId, step),
        });
      } catch (error) {
        get().failStep(cid, stepId, error);
        trackEvent("session_preflight_failed", { source: "local_script" });
        return;
      }
      try {
        const { env, res } = await nextctlEnvelope<unknown>([
          ...prep.profileArgs,
          "eval",
          scriptJS,
        ]);
        let result: string;
        if (res.code === 0 && env.ok !== false) {
          get().appendStep(cid, stepId, "Done");
          const on = prep.host ?? get().currentSessionDisplayName();
          result = `✓ Ran "${entry.title}" on ${on}.`;
          trackEvent("script_run_completed", { script_type: "local_eval", has_host: !!onHost });
        } else {
          result = internalError(`We couldn't run "${entry.title}".`, "SCRIPT_RUN_FAILED");
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
      } catch {
        trackEvent("script_run_failed", { script_type: "local_eval" });
        const errMsg: ChatMessage = {
          id: uid(),
          role: "system",
          text: internalError(`We couldn't run "${entry.title}".`, "SCRIPT_RUN_FAILED"),
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
      ref = entry.selector.kind === "script"
        ? await pullCatalogInstructions(entry, get().agentId)
        : await get().applySkill(entry);
    } catch {
      set({ tab: "chat" });
      const cid = get().activeConversation()?.id ?? get().newChat();
      const errMsg: ChatMessage = {
        id: uid(),
        role: "system",
        text: internalError(`We couldn't prepare "${entry.title}".`, "SKILL_PREPARE_FAILED"),
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
    let prep;
    try {
      prep = await prepareLocalSession({
        host: onHost || undefined,
        selectedProfile: get().selectedProfile,
        statuses: get().statuses,
        defaultSession: get().defaultSession,
        onStep: (step) => get().appendStep(cid, stepId, step),
      });
    } catch (error) {
      get().failStep(cid, stepId, error);
      trackEvent("session_preflight_failed", { source: "agent_script" });
      return;
    }
    const where = onHost
      ? `on ${onHost}`
      : `in the active Nextbrowser session (${get().currentSessionDisplayName()})`;
    const md = await installedSkillMarkdown(ref);
    const prompt = scriptAgentPrompt(
      entry.title,
      where,
      md,
      ref?.slug ?? ref?.title,
      prep.host,
      prep.directFallback,
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
      workspaceId: get().activeWorkspaceId,
      profileName: partial.profileName,
      intervalMinutes: partial.intervalMinutes,
      createdAt: now(),
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
      const { env, res } = await nextctlEnvelope<SkillRef>([
        "skill", "add", "--domain", selector, "--private", "--slug", slug,
        "--title", updated.title || slug, "--description", description, "--file", tempPath,
      ]);
      if (res.code !== 0 || env.ok === false) throw new Error(nextctlErrorMessage(res));
      const synced = { ...updated, serverSlug: env.data?.slug ?? slug, submittedAt: now() };
      const final = scripts.map((s) => s.id === script.id ? synced : s);
      persistScripts(final);
      set({ customScripts: final, scriptSync: { ...get().scriptSync, [script.id]: "synced" } });
      trackTiming("custom_script_save_completed", startedAt, { existing: !!existing, has_domain: !!script.domain.trim() });
    } catch {
      set((s) => ({ scriptSync: { ...s.scriptSync, [script.id]: "failed" } }));
      trackTiming("custom_script_save_failed", startedAt, { existing: !!existing, has_domain: !!script.domain.trim() });
    } finally {
      if (tempPath) void invoke("remove_temp_file", { path: tempPath });
    }
  },

  deleteCustomScript: async (id) => {
    const script = get().customScripts.find((item) => item.id === id);
    if (script?.serverSlug) {
      // The script was published as a private cloud skill. Remove that copy too,
      // or it reappears under My skills / Scripts on the next catalog load.
      const { res } = await nextctlEnvelope(["skill", "delete", script.serverSlug]);
      if (res.code !== 0) throw new Error(nextctlErrorMessage(res));
    }
    const customScripts = get().customScripts.filter((s) => s.id !== id);
    await invoke("app_data_write", { name: "custom-scripts.json", content: JSON.stringify(serializeScripts(customScripts), null, 2) });
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
    const remoteOnly = get().conversations.find((conversation) => conversation.id === cid)?.executionTarget === "vps";
    if (remoteOnly) {
      const target = domain || "the remote browser session";
      const chip: UserCommandChip = {
        kind: "script",
        title: script.title,
        detail: domain || "VPS",
      };
      const prompt = `Run my custom script "${script.title}" on ${target} on the selected VPS only. Do not prepare, open, inspect, or change any local Nextbrowser session. Follow these steps exactly using only the already-installed remote browser tooling:\n\n${script.instructions}`;
      get().enqueue(prompt, chip, cid);
      return;
    }
    const stepId = get().makeStepMessage(cid);
    let prep;
    try {
      prep = await prepareLocalSession({
        host: domain || undefined,
        selectedProfile: get().selectedProfile,
        statuses: get().statuses,
        defaultSession: get().defaultSession,
        onStep: (step) => get().appendStep(cid, stepId, step),
      });
    } catch (error) {
      get().failStep(cid, stepId, error);
      trackEvent("session_preflight_failed", { source: "custom_script" });
      return;
    }
    if (!get().agentReady()) return;
    const target = domain || `the active Nextbrowser session (${get().currentSessionDisplayName()})`;
    const chip: UserCommandChip = {
      kind: "script",
      title: script.title,
      detail: domain || get().currentSessionDisplayName(),
    };
    const note = pageReadyNote(prep.host, prep.directFallback);
    const prompt = `Run my custom script "${script.title}" on ${target} in the active Nextbrowser session.${note}\nFollow these steps exactly:\n\n${script.instructions}`;
    get().enqueue(prompt, chip, cid);
  },

  saveLocalSkill: async (skill) => {
    const existing = get().localSkills.some((item) => item.id === skill.id);
    const updated = { ...skill, updatedAt: now(), createdAt: existing ? skill.createdAt : now() };
    const localSkills = existing
      ? get().localSkills.map((item) => item.id === skill.id ? updated : item)
      : [...get().localSkills, updated];
    persistLocalSkills(localSkills);
    set({ localSkills });
    const slug = `workflow-${skill.id.slice(0, 8)}`;
    const description = `Reusable private ${skill.capability} browser workflow${skill.domain ? ` for ${skill.domain}` : ""}.`;
    const body = `---\nname: ${JSON.stringify(skill.title)}\ndescription: ${JSON.stringify(description)}\n---\n\n# ${skill.title}\n\n## Workflow\n\n${skill.instructions}\n\n## Inputs\n\n\`\`\`json\n${JSON.stringify(skill.parametersSchema, null, 2)}\n\`\`\`\n\n## Output\n\n\`\`\`json\n${JSON.stringify(skill.outputSchema, null, 2)}\n\`\`\`\n\n## Recipe\n\nExecute these task-specific actions first. The app prepares the browser session separately. If a selector is stale, resolve it again and continue.\n\n\`\`\`json\n${JSON.stringify(skill.recipe, null, 2)}\n\`\`\`\n`;
    set((state) => ({ localSkillSync: { ...state.localSkillSync, [skill.id]: "syncing" } }));
    let tempPath: string | undefined;
    try {
      // Keep the local write inside the try: a disk failure must mark the sync
      // as failed instead of rejecting into a global error notice.
      await invoke<string>("write_local_skill", { slug, content: body });
      tempPath = await invoke<string>("write_temp_skill", { slug, content: body });
      const { env, res } = await nextctlEnvelope<SkillRef>([
        "skill", "add", "--domain", skill.domain, "--private", "--slug", slug,
        "--title", skill.title, "--description", `Private browser skill${skill.domain ? ` for ${skill.domain}` : ""}.`,
        "--category", "my-skills", "--category-title", "My skills", "--category-icon", "person.crop.circle",
        "--capability", skill.capability,
        "--parameters-json", JSON.stringify(skill.parametersSchema),
        "--output-json", JSON.stringify(skill.outputSchema),
        "--recipe-json", JSON.stringify(skill.recipe),
        "--file", tempPath,
      ]);
      if (res.code !== 0 || env.ok === false) throw new Error(nextctlErrorMessage(res));
      const synced = { ...updated, serverSlug: env.data?.slug ?? slug, submittedAt: now() };
      const final = localSkills.map((item) => item.id === skill.id ? synced : item);
      persistLocalSkills(final);
      set((state) => ({ localSkills: final, localSkillSync: { ...state.localSkillSync, [skill.id]: "synced" } }));
      trackEvent("browser_workflow_saved", { has_domain: !!skill.domain, action_count: skill.actions.length, storage: "private_cloud" });
    } catch {
      set((state) => ({ localSkillSync: { ...state.localSkillSync, [skill.id]: "failed" } }));
      trackEvent("browser_workflow_saved", { has_domain: !!skill.domain, action_count: skill.actions.length, storage: "local_only" });
    } finally {
      if (tempPath) void invoke("remove_temp_file", { path: tempPath });
    }
  },

  deleteLocalSkill: async (id) => {
    const skill = get().localSkills.find((item) => item.id === id);
    if (skill?.serverSlug) {
      const { res } = await nextctlEnvelope(["skill", "delete", skill.serverSlug]);
      if (res.code !== 0) throw new Error(nextctlErrorMessage(res));
    }
    const localSkills = get().localSkills.filter((skill) => skill.id !== id);
    await invoke("delete_local_skill", { slug: `workflow-${id.slice(0, 8)}` });
    await invoke("app_data_write", { name: "local-skills.json", content: JSON.stringify(serializeWorkflowSkills(localSkills), null, 2) });
    set({ localSkills });
  },

  runAutomationRecipe: async (skill, executionId, parameters = {}) => {
    const { backendRunId, ...recipeParameters } = parameters;
    const activeConversation = get().activeConversation();
    if (activeConversation?.executionTarget === "vps") {
      throw new Error("Deterministic replay currently requires a local Nextbrowser profile.");
    }
    // Deterministic replay deliberately skips the conversational preflight,
    // but MCP page actions still require a live CDP session. Start or reattach
    // the selected profile without navigating; the saved recipe remains the
    // sole owner of page navigation.
    const activeWorkspace = get().workspaces.find((workspace) => workspace.id === get().activeWorkspaceId);
    if (!get().selectedProfile && (activeWorkspace?.profileNames.length || 0) > 1) {
      throw new Error("Choose the browser profile that should run this automation.");
    }
    const soleWorkspaceProfile = activeWorkspace?.profileNames.length === 1 ? activeWorkspace.profileNames[0] : undefined;
    const profile = get().selectedProfile || soleWorkspaceProfile;
    const runtime = profile ? runtimeForProfile(get().workspaces, profile) : "clawbrowser";
    if (profile) {
      if (get().statuses[profile] !== "running") await get().startProfile(profile);
    } else if (get().defaultSession?.status !== "running") {
      await get().startDefaultSession();
    }
    trackEvent("automation_recipe_started", { action_count: skill.actions.length, runtime, has_profile: !!profile });
    const executeRecipe = () => invoke<AutomationRecipeResult>("automation_recipe_execute", {
      executionId,
      recipe: { ...skill.recipe, actions: skill.actions },
      parameters: { task: skill.task, ...recipeParameters },
      profile,
      runtime,
      workspaceId: get().activeWorkspaceId,
      backendRunId: typeof backendRunId === "string" ? backendRunId : undefined,
    });
    let result = await executeRecipe();
    // The user can close the browser window between status polls. In that
    // short window the store still says "running", while its CDP endpoint is
    // already dead. Recover the same selected profile exactly once and replay
    // from step one; never guess another profile or enter a restart loop.
    if (result.status === "failed" && (sessionLost(result.error ?? "") || proxyTunnelLost(result.error ?? ""))) {
      trackEvent("automation_recipe_session_recovery", { runtime, has_profile: !!profile });
      if (proxyTunnelLost(result.error ?? "")) {
        const profileModel = profile ? get().profiles.find((item) => item.name === profile) : undefined;
        if (profile && profileModel?.country && !profileModel.manual_proxy) {
          await get().rotateProfile(profile);
          result = await executeRecipe();
          trackEvent(`automation_recipe_${result.status}`, { action_count: skill.actions.length, runtime, failed_step: result.failedStep });
          return result;
        }
        if (profile) await get().stopProfile(profile).catch(() => undefined);
        else await get().stopDefaultSession().catch(() => undefined);
      }
      if (profile) await get().startProfile(profile);
      else await get().startDefaultSession();
      result = await executeRecipe();
    }
    trackEvent(`automation_recipe_${result.status}`, { action_count: skill.actions.length, runtime, failed_step: result.failedStep });
    return result;
  },

  runLocalSkill: async (skill, taskOverride) => {
    if (!get().agentReady()) return;
    const task = taskOverride?.trim() || skill.task.trim();
    if (!task) return;
    set({ tab: "chat" });
    const cid = get().activeConversation()?.id ?? get().newChat();
    const remoteOnly = get().conversations.find((conversation) => conversation.id === cid)?.executionTarget === "vps";
    const target = skill.domain || "the active website";
    const chip: UserCommandChip = { kind: "skill", title: skill.title, detail: skill.domain || "Local skill" };
    if (remoteOnly) {
      return get().enqueue(
        `Use my local browser skill "${skill.title}" for ${target} on the selected VPS only. Do not prepare or change any local Nextbrowser session.\n\nTask for this run:\n${task}\n\nWorkflow instructions:\n${skill.instructions}`,
        chip, cid,
      );
    }
    const stepId = get().makeStepMessage(cid);
    let prep;
    try {
      prep = await prepareLocalSession({
        host: skill.domain || undefined,
        selectedProfile: get().selectedProfile,
        statuses: get().statuses,
        defaultSession: get().defaultSession,
        onStep: (step) => get().appendStep(cid, stepId, step),
      });
    } catch (error) {
      get().failStep(cid, stepId, error);
      trackEvent("session_preflight_failed", { source: "local_skill" });
      return;
    }
    if (!get().agentReady()) return;
    const note = pageReadyNote(prep.host, prep.directFallback);
    const replyId = get().enqueue(
      `Use my local browser skill "${skill.title}" for ${target} in the active verified Nextbrowser session.${note}\nThe app already prepared the session, verified the selected proxy, and opened the website. Do not run saved start/prepare operations again. Begin with the first task-specific action. Reuse the proven recipe, adapting selectors only if the page changed.\n\nTask for this run:\n${task}\n\nStructured recipe (execute first):\n${JSON.stringify(skill.recipe, null, 2)}\n\nWorkflow fallback:\n${skill.instructions}`,
      chip,
      cid,
    );
    trackEvent("local_skill_run_queued", { has_domain: !!skill.domain, customized_task: task !== skill.task.trim() });
    return replyId;
  },

  startRemoteStream: async (target = { runtime: "clawbrowser" }) => {
    const args = nextctlRemoteArgs(target);
    const timeoutMs = target.runtime === "multilogin" && target.selection.kind === "mobile"
      ? 3 * 60_000
      : 60_000;
    let res = await nextctlRun(args, undefined, { timeoutMs });
    if (res.code !== 0 && nextctlErrorMessage(res).includes("unknown flag")) {
      const fallbackArgs = args.filter((arg) => arg !== "--include-viewer-url");
      res = await nextctlRun(fallbackArgs, undefined, { timeoutMs });
    }
    if (res.code !== 0) throw new Error(nextctlErrorMessage(res));
    let result: RemoteStreamInfo & { data?: RemoteStreamInfo };
    try {
      result = JSON.parse(res.stdout);
    } catch {
      throw new Error(nextctlErrorMessage(res));
    }
    const envelope = result as RemoteStreamInfo & {
      data?: RemoteStreamInfo & { remote?: RemoteStreamInfo };
      remote?: RemoteStreamInfo;
    };
    if (envelope.data?.remote?.dashboard_url) result = envelope.data.remote;
    else if (envelope.data?.dashboard_url) result = envelope.data;
    else if (envelope.remote?.dashboard_url) result = envelope.remote;
    const url = result.viewer_url || result.dashboard_url;
    if (!url) throw new Error("nextctl remote did not return a viewer URL.");
    return result;
  },
  };
});

export { AGENTS, type AgentSpec };
