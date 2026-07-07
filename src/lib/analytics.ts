type AnalyticsParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const DEFAULT_MEASUREMENT_ID = "G-MDQWQ9LRCN";
const MEASUREMENT_ID = (import.meta.env.VITE_GA4_MEASUREMENT_ID ?? DEFAULT_MEASUREMENT_ID).trim();
const COLLECT_URL = "https://www.google-analytics.com/g/collect";
const APP_SOURCE = "nextbrowser_desktop";
const APP_NAME = "NextBrowser Desktop";
const SESSION_ID = crypto.randomUUID();
const APP_INSTANCE_KEY = "nextbrowser.analytics.appInstanceId";
const ANALYTICS_USER_ID_KEY = "nextbrowser.analytics.userId";
let initialized = false;

function appInstanceId(): string {
  const existing = localStorage.getItem(APP_INSTANCE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(APP_INSTANCE_KEY, id);
  return id;
}

function baseParams(): AnalyticsParams {
  return {
    event_source: APP_SOURCE,
    app_name: APP_NAME,
    app_surface: "desktop",
    app_instance_id: appInstanceId(),
    analytics_user_id_set: !!analyticsUserId(),
    app_session_id: SESSION_ID,
    app_platform: navigator.platform || "unknown",
    app_locale: navigator.language || "unknown",
    app_packaged: import.meta.env.PROD,
  };
}

function analyticsUserId(): string | undefined {
  return localStorage.getItem(ANALYTICS_USER_ID_KEY) ?? undefined;
}

function collectEvent(name: string, params: AnalyticsParams): void {
  const search = new URLSearchParams({
    v: "2",
    tid: MEASUREMENT_ID,
    cid: appInstanceId(),
    en: name,
    dl: "app://nextbrowser/desktop",
    dt: APP_NAME,
    ul: navigator.language || "unknown",
    sr: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    _p: String(Math.floor(Math.random() * 1_000_000_000)),
  });
  const userId = analyticsUserId();
  if (userId) search.set("uid", userId);
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      search.set(`epn.${key}`, String(value));
    } else {
      search.set(`ep.${key}`, String(value));
    }
  }
  const url = `${COLLECT_URL}?${search.toString()}`;
  if (navigator.sendBeacon?.(url)) return;
  fetch(url, { mode: "no-cors", credentials: "omit", keepalive: true }).catch(() => undefined);
}

export function initAnalytics(): void {
  if (initialized || !MEASUREMENT_ID) return;
  initialized = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = window.gtag ?? function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    send_page_view: false,
    anonymize_ip: true,
    transport_type: "beacon",
    user_id: analyticsUserId(),
    ...baseParams(),
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);
}

export function setAnalyticsUserId(userId: string | undefined): void {
  const clean = userId?.trim();
  if (clean) {
    localStorage.setItem(ANALYTICS_USER_ID_KEY, clean);
  } else {
    localStorage.removeItem(ANALYTICS_USER_ID_KEY);
  }
  if (!MEASUREMENT_ID) return;
  initAnalytics();
  window.gtag?.("config", MEASUREMENT_ID, {
    send_page_view: false,
    anonymize_ip: true,
    transport_type: "beacon",
    user_id: clean || undefined,
    ...baseParams(),
  });
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (!MEASUREMENT_ID) return;
  initAnalytics();
  const eventParams = {
    ...baseParams(),
    ...params,
  };
  window.gtag?.("event", name, {
    ...eventParams,
  });
  collectEvent(name, eventParams);
}

export function trackTiming(name: string, startedAt: number, params: AnalyticsParams = {}): void {
  trackEvent(name, {
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    ...params,
  });
}
