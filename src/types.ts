// Data shapes — mirrors clawdesk/Models/Models.swift.

export interface ProxyTraffic {
  limited: boolean;
  used_bytes: number;
  limit_bytes?: number | null;
  remaining_bytes?: number | null;
  percent_used?: number | null;
  state: string;
  top_up_bytes?: number | null;
  dashboard_url?: string | null;
}

export interface ProxyTrafficHistoryPoint {
  label: string;
  used_bytes: number;
  requests: number;
}

export interface ProxyTrafficSourceBreakdown {
  source: "proxy" | "browser";
  used_bytes: number;
  requests: number;
}

export interface ProxyTrafficDomainBreakdown {
  domain: string;
  used_bytes: number;
  requests: number;
}

export interface ProxyTrafficHistory {
  from: string;
  to: string;
  timezone: string;
  total_bytes: number;
  total_requests: number;
  data_points: ProxyTrafficHistoryPoint[];
  sources: ProxyTrafficSourceBreakdown[];
  top_domains: ProxyTrafficDomainBreakdown[];
}

export interface ManualProxy {
  scheme?: string | null;
  host?: string | null;
  port?: number | null;
  username?: string | null;
}

export interface PersonalProxy {
  id: string;
  name: string;
  scheme: "http" | "socks5";
  host: string;
  port: number;
  username?: string;
  hasPassword: boolean;
}

export interface Profile {
  name: string;
  country?: string | null;
  city?: string | null;
  proxy_scheme?: string | null;
  proxy_mode?: string | null;
  manual_proxy?: ManualProxy | null;
  created_at?: string | null;
}

export interface SessionInfo {
  name?: string | null;
  endpoint?: string | null;
  source?: string | null;
}

export interface SessionStatus {
  session?: SessionInfo | null;
  status: string;
  backend?: string | null;
  pid?: string | null;
}

export function sessionRunning(s?: SessionStatus | null): boolean {
  return s?.status === "running";
}

export function sessionEndpoint(s?: SessionStatus | null): string | undefined {
  return s?.session?.endpoint ?? undefined;
}

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus =
  | "queued"
  | "streaming"
  | "done"
  | "failed"
  | "cancelled"
  | "timedOut";

export interface UserCommandChip {
  kind: "skill" | "script";
  title: string;
  detail?: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  detail?: string;
  createdAt: number;
}

export interface ChatAttachment {
  name: string;
  path: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  createdAt: number;
  runStartedAt?: number;
  lastActivityAt?: number;
  stalled?: boolean;
  activityLabel?: string;
  toolEvents?: ToolEvent[];
  commandChip?: UserCommandChip;
  attachments?: ChatAttachment[];
}

export interface Conversation {
  id: string;
  title: string;
  agent: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  parentId?: string;
  forkedFromMessageId?: string;
  executionTarget?: "local" | "vps";
  vpsConnectionInstructions?: string;
  vpsConnectionLabel?: string;
  /** A conversation is the persistent agent context for one project. */
  chatMode?: "chat" | "terminal";
  /** Short persisted activity summary for terminal projects. */
  terminalPreview?: string;
  workspaceId?: string;
  profileNames?: string[];
  profileToolsets?: Record<string, BrowserToolset>;
}

export type BrowserToolset = "clawbrowser" | "dasbrowser" | "camoufox";

export interface Workspace {
  id: string;
  name: string;
  profileNames: string[];
  profileToolsets: Record<string, BrowserToolset>;
  /** Personal proxy associations are synced inside the private workspace document. */
  profileProxyIds?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/** Sidebar preview line for a conversation — mirrors Swift `Conversation.preview`. */
export function conversationPreview(conv: Conversation): string {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const last = conv.messages[i];
    if (last.role === "system") continue;
    if (last.commandChip) return `▸ ${last.commandChip.title}`;
    if (last.text) return last.text.slice(0, 60);
    break;
  }
  if (conv.chatMode === "terminal" && conv.terminalPreview) return conv.terminalPreview;
  return "Empty chat";
}

export interface SkillRef {
  slug?: string;
  kind?: "domain" | "captcha";
  selector?: string;
  title?: string;
  category?: string;
  category_title?: string;
  category_icon?: string;
  category_order?: number;
  version?: string;
  description?: string;
  found?: boolean;
  installed?: string[];
  installed_path?: string;
  path?: string;
}

export type SkillApplyState = "idle" | "applying" | "installed" | "failed";

export type ScriptSyncState = "idle" | "syncing" | "synced" | "failed";

export interface CustomScript {
  id: string;
  title: string;
  domain: string;
  instructions: string;
  createdAt: number;
  updatedAt: number;
  serverSlug?: string;
  submittedAt?: number;
}

export interface BrowserWorkflowSkill {
  id: string;
  title: string;
  domain: string;
  task: string;
  instructions: string;
  actions: BrowserWorkflowAction[];
  capability: BrowserSkillCapability;
  parametersSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  recipe: BrowserWorkflowRecipe;
  createdAt: number;
  updatedAt: number;
  revision?: number;
  serverSlug?: string;
  submittedAt?: number;
}

export type BrowserSkillCapability = "scrape" | "search" | "posting" | "form" | "navigation" | "other";
export interface BrowserWorkflowAction { tool: string; arguments: Record<string, unknown>; }
export interface BrowserWorkflowRecipe { version: 1; capability: BrowserSkillCapability; actions: BrowserWorkflowAction[]; }
export interface AutomationRecipeStepResult { index: number; tool: string; ok: boolean; output?: unknown; error?: string; }
export interface AutomationRecipeResult { status: "completed" | "failed" | "cancelled"; results: AutomationRecipeStepResult[]; failedStep?: number; error?: string; }

export function customPrivateSlug(script: CustomScript): string {
  return script.serverSlug ?? `custom-${script.id.slice(0, 8).toLowerCase()}`;
}

export function customPublishSelector(script: CustomScript): string {
  const d = script.domain.trim().toLowerCase();
  return d || `${customPrivateSlug(script)}.script`;
}

export interface ScheduledRun {
  id: string;
  title: string;
  prompt: string;
  agent: string;
  hour: number;
  minute: number;
  weekdays: number[];
  enabled: boolean;
  lastFiredAt?: number;
  conversationId?: string;
}

export const WEEKDAY_ORDER = [2, 3, 4, 5, 6, 7, 1] as const;

export function weekdayShortName(weekday: number): string {
  return ["", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekday] ?? "";
}

export function weekdaysSummary(weekdays: number[]): string {
  const set = new Set(weekdays);
  if (set.size === 7) return "Daily";
  if ([2, 3, 4, 5, 6].every((d) => set.has(d)) && set.size === 5) return "Mon–Fri";
  if (set.has(1) && set.has(7) && set.size === 2) return "Weekends";
  if (!weekdays.length) return "Never";
  return WEEKDAY_ORDER.filter((d) => set.has(d))
    .map(weekdayShortName)
    .join(" ");
}

/// One account a watchlist skill follows. The app owns this record; an agent
/// never writes it, so a bad run cannot lose the user's list.
export interface WatchedProfile {
  id: string;
  skillId: string;
  handle: string;
  enabled: boolean;
  addedAt: number;
  subscribeQueuedAt?: number;
  lastRunAt?: number;
}

/// A watchlist skill left running in the app. It survives a restart, so a user
/// who switched it on finds it still on, and it only ever runs while the app is
/// open — there is no background service behind it.
export interface WatchlistRun {
  skillId: string;
  enabled: boolean;
  intervalMinutes: number;
  conversationId?: string;
  lastRunAt?: number;
  nextRunAt?: number;
}

export const WATCHLIST_INTERVAL_CHOICES = [1, 2, 3, 4, 5, 20] as const;
export const DEFAULT_WATCHLIST_INTERVAL_MINUTES = 2;

/// clampWatchlistInterval snaps a stored interval onto the offered set, so the
/// picker always shows the value that is actually in effect. A pass that is
/// still running holds the next one back regardless of how short this is.
export function clampWatchlistInterval(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_WATCHLIST_INTERVAL_MINUTES;
  let nearest: number = WATCHLIST_INTERVAL_CHOICES[0];
  for (const choice of WATCHLIST_INTERVAL_CHOICES) {
    if (Math.abs(choice - minutes) < Math.abs(nearest - minutes)) nearest = choice;
  }
  return nearest;
}

/// What an agent recorded for one watched account in its workspace state file.
/// Every field is optional: the file is written by a model, so the panel has to
/// render whatever survived rather than assume a complete record.
export interface WatchedProfileReport {
  handle: string;
  following?: boolean;
  notifications?: boolean;
  lastPostId?: string;
  lastCheckedAt?: number;
  repliesSent?: number;
  lastReplyUrl?: string;
  note?: string;
}

/// X handles stop at 15 characters; a skill that watches something else, such
/// as subreddits (21), says so in its watchlist.
export const DEFAULT_WATCH_HANDLE_MAX_LENGTH = 15;

export interface WatchHandleOptions {
  maxLength?: number;
}

/// normalizeWatchHandle accepts what a user actually pastes — `@handle`, a
/// profile URL, `r/community`, or the bare name — and returns the bare handle,
/// or an empty string when the value cannot be one.
export function normalizeWatchHandle(value: string, options: WatchHandleOptions = {}): string {
  const maxLength = options.maxLength && options.maxLength > 0 ? Math.floor(options.maxLength) : DEFAULT_WATCH_HANDLE_MAX_LENGTH;
  let handle = value.trim();
  const url = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*[a-z0-9-]+\.[a-z]{2,}\/(?:(?:r|u|user)\/)?(@?[A-Za-z0-9_]+)/i.exec(handle);
  if (url) handle = url[1];
  handle = handle.replace(/^\/?(?:r|u|user)\//i, "").replace(/^@+/, "").split(/[/?#]/)[0].trim();
  return new RegExp(`^[A-Za-z0-9_]{1,${maxLength}}$`).test(handle) ? handle : "";
}

export function sameWatchHandle(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function reportNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function reportCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

/// The account the skill posts from, as the agent last observed it. Without
/// this the panel cannot tell "nothing happened yet" from "the browser profile
/// is signed out", which is the single most common reason a watch pass does
/// nothing at all.
export interface WatchedPublisher {
  handle?: string;
  signedIn?: boolean;
  checkedAt?: number;
}

export interface WatchState {
  publisher?: WatchedPublisher;
  reports: Record<string, WatchedProfileReport>;
}

/// parseWatchState reads the state file an agent keeps in its workspace. The
/// file is untrusted input in both directions: it may be missing, half-written,
/// or shaped differently than the skill asked for, and none of that may break
/// the panel. Unknown handles are kept — the list the user sees is filtered
/// against their own records.
export function parseWatchState(raw: string | null | undefined, options: WatchHandleOptions = {}): WatchState {
  if (!raw) return { reports: {} };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { reports: {} }; }
  const root = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  const rawPublisher = root.publisher && typeof root.publisher === "object"
    ? root.publisher as Record<string, unknown>
    : undefined;
  const publisher: WatchedPublisher | undefined = rawPublisher
    ? {
      handle: normalizeWatchHandle(typeof rawPublisher.handle === "string" ? rawPublisher.handle : "", options) || undefined,
      signedIn: typeof rawPublisher.signed_in === "boolean" ? rawPublisher.signed_in : undefined,
      checkedAt: reportNumber(rawPublisher.checked_at),
    }
    : undefined;
  const container = root.handles ?? parsed;
  const rows: unknown[] = Array.isArray(container)
    ? container
    : container && typeof container === "object"
      ? Object.entries(container).map(([handle, value]) =>
        value && typeof value === "object" ? { handle, ...(value as Record<string, unknown>) } : { handle })
      : [];
  const reports: Record<string, WatchedProfileReport> = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const handle = normalizeWatchHandle(typeof record.handle === "string" ? record.handle : "", options);
    if (!handle) continue;
    reports[handle.toLowerCase()] = {
      handle,
      following: typeof record.following === "boolean" ? record.following : undefined,
      notifications: typeof record.notifications === "boolean" ? record.notifications : undefined,
      lastPostId: typeof record.last_post_id === "string" ? record.last_post_id.slice(0, 32) : undefined,
      lastCheckedAt: reportNumber(record.last_checked_at),
      repliesSent: reportCount(record.replies_sent),
      lastReplyUrl: typeof record.last_reply_url === "string" && /^https:\/\//i.test(record.last_reply_url)
        ? record.last_reply_url.slice(0, 512)
        : undefined,
      note: typeof record.note === "string" ? record.note.replace(/\s+/g, " ").trim().slice(0, 160) || undefined : undefined,
    };
  }
  return { publisher, reports };
}

export interface UsageSnapshot {
  id: string;
  date: number;
  usedBytes: number;
  limitBytes?: number;
}

export interface TabsList {
  tabs: {
    id: string;
    url?: string;
    title?: string;
    current?: boolean;
    active?: boolean;
  }[];
}

export type AppTab = "chat" | "automation" | "skills" | "connectors" | "live" | "usage" | "guide" | "scheduled";

export interface AutomationArtifact {
  id: string;
  name: string;
  size: number;
  createdAt: number;
  extension: string;
  contentType?: string;
  sha256?: string;
  runId?: string;
}

export function proxyFraction(p?: ProxyTraffic | null): number {
  if (!p) return 0;
  if (p.percent_used != null) return Math.min(Math.max(p.percent_used / 100, 0), 1);
  if (p.limit_bytes) return Math.min(p.used_bytes / p.limit_bytes, 1);
  return 0;
}

export function humanBytes(bytes: number): string {
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  const digits = n < 10 && i > 0 && !Number.isInteger(n) ? 1 : 0;
  return `${n.toFixed(digits)} ${u[i]}`;
}
