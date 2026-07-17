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

export type AppTab = "chat" | "skills" | "live" | "usage" | "guide" | "profiles" | "scheduled";

export function proxyFraction(p?: ProxyTraffic | null): number {
  if (!p) return 0;
  if (p.percent_used != null) return Math.min(Math.max(p.percent_used / 100, 0), 1);
  if (p.limit_bytes) return Math.min(p.used_bytes / p.limit_bytes, 1);
  return 0;
}

export function humanBytes(bytes: number): string {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
