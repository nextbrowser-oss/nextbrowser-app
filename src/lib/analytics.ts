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
const PAGE_LOCATION = "https://www.nextbrowser.com/desktop-app";
const SESSION_ID = Math.floor(Date.now() / 1000);
const APP_INSTANCE_KEY = "nextbrowser.analytics.appInstanceId";
const ANALYTICS_USER_ID_KEY = "nextbrowser.analytics.userId";
const SESSION_NUMBER_KEY = "nextbrowser.analytics.sessionNumber";
const FIRST_VISIT_KEY = "nextbrowser.analytics.firstVisitSent";
const HEARTBEAT_MIN_MS = 10_000;
// Packaged Electron builds run on a file:// origin where Chromium blocks
// cookies, so gtag.js can neither persist session state nor reliably transmit
// hits — and it fails silently, so our onload/timeout fallback never triggers.
// On that origin we skip gtag entirely and use the cookie-free Measurement
// Protocol endpoint (/g/collect) directly, keyed by the stable app instance id.
const FILE_ORIGIN = typeof window !== "undefined" && window.location?.protocol === "file:";
let initialized = false;
let gtagLoaded = false;
let fallbackCollect = false;
let lastEngagementAt = Date.now();
let lastHeartbeatAt = 0;
let sessionNumberCache: number | undefined;
const pendingFallbackEvents: Array<{ name: string; params: AnalyticsParams }> = [];

function appInstanceId(): string {
  const existing = localStorage.getItem(APP_INSTANCE_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(APP_INSTANCE_KEY, id);
  return id;
}

function sessionNumber(): number {
  if (sessionNumberCache) return sessionNumberCache;
  const previous = Number.parseInt(localStorage.getItem(SESSION_NUMBER_KEY) ?? "0", 10);
  const next = Number.isFinite(previous) ? previous + 1 : 1;
  localStorage.setItem(SESSION_NUMBER_KEY, String(next));
  sessionNumberCache = next;
  return next;
}

function engagementTimeMsec(): number {
  const now = Date.now();
  const elapsed = Math.max(1, now - lastEngagementAt);
  lastEngagementAt = now;
  return Math.min(elapsed, 60_000);
}

function eventParams(params: AnalyticsParams = {}, includeEngagement = true): AnalyticsParams {
  return {
    ...baseParams(),
    ...(includeEngagement ? { engagement_time_msec: engagementTimeMsec() } : {}),
    page_location: PAGE_LOCATION,
    page_title: APP_NAME,
    ...params,
  };
}

function baseParams(): AnalyticsParams {
  return {
    event_source: APP_SOURCE,
    app_name: APP_NAME,
    app_version: __APP_VERSION__,
    app_surface: "desktop",
    app_instance_id: appInstanceId(),
    analytics_user_id_set: !!analyticsUserId(),
    app_session_id: SESSION_ID,
    session_id: SESSION_ID,
    session_number: sessionNumber(),
    app_platform: navigator.platform || "unknown",
    app_locale: navigator.language || "unknown",
    app_packaged: import.meta.env.PROD,
  };
}

function analyticsUserId(): string | undefined {
  return localStorage.getItem(ANALYTICS_USER_ID_KEY) ?? undefined;
}

function userProperties(): Record<string, string | number | boolean> {
  return {
    app_source: APP_SOURCE,
    app_surface: "desktop",
    app_version: __APP_VERSION__,
    app_platform: navigator.platform || "unknown",
    app_locale: navigator.language || "unknown",
    app_packaged: import.meta.env.PROD,
  };
}

function cleanParams(params: AnalyticsParams): AnalyticsParams {
  const clean: AnalyticsParams = {};
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (typeof value === "number") {
      if (Number.isFinite(value)) clean[key] = value;
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function collectEvent(name: string, params: AnalyticsParams): void {
  const clean = cleanParams(params);
  const search = new URLSearchParams({
    v: "2",
    tid: MEASUREMENT_ID,
    cid: appInstanceId(),
    en: name,
    dl: PAGE_LOCATION,
    dt: APP_NAME,
    ul: navigator.language || "unknown",
    sr: `${window.screen?.width ?? 0}x${window.screen?.height ?? 0}`,
    _p: String(Math.floor(Math.random() * 1_000_000_000)),
    sid: String(SESSION_ID),
    sct: String(sessionNumber()),
    seg: "1",
  });
  const userId = analyticsUserId();
  if (userId) search.set("uid", userId);
  for (const [key, value] of Object.entries(clean)) {
    // Engagement time is a canonical GA4 hit param (_et), not a custom param;
    // sending it as epn.* means GA4 never credits the session as engaged.
    if (key === "engagement_time_msec") {
      if (typeof value === "number" && Number.isFinite(value)) search.set("_et", String(value));
      continue;
    }
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

function enableFallbackCollect(): void {
  if (fallbackCollect) return;
  fallbackCollect = true;
  while (pendingFallbackEvents.length) {
    const event = pendingFallbackEvents.shift();
    if (event) collectEvent(event.name, event.params);
  }
}

function sendAnalyticsEvent(name: string, params: AnalyticsParams): void {
  const clean = cleanParams(params);
  if (fallbackCollect) {
    collectEvent(name, clean);
    return;
  }
  if (gtagLoaded) {
    window.gtag?.("event", name, clean);
    return;
  }
  pendingFallbackEvents.push({ name, params: clean });
  if (pendingFallbackEvents.length > 100) pendingFallbackEvents.shift();
}

export function initAnalytics(): void {
  if (initialized || !MEASUREMENT_ID) return;
  initialized = true;
  if (FILE_ORIGIN) {
    // gtag.js is unreliable here; send straight to the Measurement Protocol.
    enableFallbackCollect();
  } else {
    window.dataLayer = window.dataLayer ?? [];
    window.gtag = window.gtag ?? function gtag(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      send_page_view: false,
      anonymize_ip: true,
      transport_type: "beacon",
      client_id: appInstanceId(),
      user_id: analyticsUserId(),
      page_location: PAGE_LOCATION,
      page_title: APP_NAME,
      user_properties: userProperties(),
      ...baseParams(),
    });
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
    script.onload = () => {
      gtagLoaded = true;
      if (fallbackCollect) return;
      while (pendingFallbackEvents.length) {
        const event = pendingFallbackEvents.shift();
        if (event) window.gtag?.("event", event.name, event.params);
      }
    };
    script.onerror = () => enableFallbackCollect();
    document.head.appendChild(script);
    window.setTimeout(() => {
      if (!gtagLoaded) enableFallbackCollect();
    }, 5_000);
  }
  const firstVisitSent = localStorage.getItem(FIRST_VISIT_KEY) === "1";
  const initialParams = eventParams({
    engagement_time_msec: 1,
  }, false);
  if (!firstVisitSent) {
    localStorage.setItem(FIRST_VISIT_KEY, "1");
    sendAnalyticsEvent("first_visit", initialParams);
  }
  sendAnalyticsEvent("session_start", initialParams);
  sendAnalyticsEvent("page_view", initialParams);
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
    client_id: appInstanceId(),
    user_id: clean || undefined,
    page_location: PAGE_LOCATION,
    page_title: APP_NAME,
    user_properties: userProperties(),
    ...baseParams(),
  });
}

export function trackEvent(name: string, params: AnalyticsParams = {}): void {
  if (!MEASUREMENT_ID) return;
  initAnalytics();
  sendAnalyticsEvent(name, eventParams(params));
}

export function trackTiming(name: string, startedAt: number, params: AnalyticsParams = {}): void {
  trackEvent(name, {
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    ...params,
  });
}

export function trackScreenView(
  screenName: string,
  params: AnalyticsParams = {},
  options: { pageView?: boolean } = {},
): void {
  const screenParams = {
    screen_name: screenName,
    screen_class: "NextBrowserDesktop",
    firebase_screen: screenName,
    firebase_screen_class: "NextBrowserDesktop",
    page_location: `${PAGE_LOCATION}#/${screenName}`,
    ...params,
  };
  trackEvent("screen_view", screenParams);
  if (options.pageView !== false) trackEvent("page_view", screenParams);
}

export function flushAnalyticsEngagement(reason = "manual"): void {
  if (!MEASUREMENT_ID) return;
  initAnalytics();
  const now = Date.now();
  if (reason === "heartbeat" && now - lastHeartbeatAt < HEARTBEAT_MIN_MS) return;
  lastHeartbeatAt = now;
  sendAnalyticsEvent("user_engagement", eventParams({
    engagement_reason: reason,
  }));
}
