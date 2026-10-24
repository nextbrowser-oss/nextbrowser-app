// Helpers for the sidebar, theme, guide, settings and feedback scenarios.
// Like ui.mjs they act through visible controls. The reads of layout,
// computed colours, page attributes and public URLs below only observe a
// result; none of them drives the app.
import { execFile } from "node:child_process";
import { blocked } from "./blocked.mjs";
import { sidebar, waitFor } from "./ui.mjs";

export const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a locator shows up within `ms`; Playwright's isVisible() does not wait. */
export const appears = (locator, ms = 5_000) => locator.first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);

// ---- Navigation ----

/** Opens Skills, Connectors, Scheduled or Guide from the sidebar, expanded or collapsed. */
export async function openSidebarPage(page, label) {
  const nav = sidebar(page).getByRole("navigation", { name: "Sidebar pages" });
  if (await nav.isVisible().catch(() => false)) {
    await nav.getByRole("button", { name: new RegExp(`^${label}\\b`) }).first().click();
  } else {
    await sidebar(page).getByRole("button", { name: `Open ${label}`, exact: true }).click();
  }
}

/** Leaves a secondary view through the tab bar's "Back to …" button, when it has one. */
export async function goBack(page) {
  const back = page.getByRole("button", { name: /^Back to / });
  if (!(await back.isVisible().catch(() => false))) return false;
  await back.click();
  return true;
}

// ---- Settings ----

// SettingsModal (src/App.tsx) is a plain card without a dialog role, so it is
// found by its class; everything inside it is found by role and text.
export const settingsDialog = (page) => page.locator(".settings-modal");

export async function openSettings(page) {
  const dialog = settingsDialog(page);
  if (await dialog.isVisible().catch(() => false)) return dialog;
  await page.getByRole("button", { name: /^Settings(, update available)?$/ }).click();
  await dialog.waitFor({ timeout: 15_000 });
  return dialog;
}

export async function closeSettings(page) {
  const close = settingsDialog(page).getByRole("button", { name: "Close settings" });
  if (await close.isVisible().catch(() => false)) await close.click();
  await settingsDialog(page).waitFor({ state: "detached", timeout: 10_000 }).catch(() => {});
}

/** The value Settings prints next to a label such as "Nextbrowser" or "nextctl". */
export async function settingsValue(page, label) {
  const row = settingsDialog(page).locator(".settings-row").filter({ has: page.getByText(label, { exact: true }) }).first();
  return (await row.locator("strong").first().innerText()).trim();
}

// ---- Links that open the OS browser ----

/**
 * Clicks a control that opens a web page and returns the URL it asked for.
 * The app calls window.open and the main process hands every http(s) URL to
 * the OS browser and denies the popup (setWindowOpenHandler in
 * electron/main.cjs), so no new page ever shows up over CDP. For this one
 * click window.open records the URL instead, and nothing opens in the
 * user's browser.
 */
export async function urlOpenedBy(page, click) {
  await page.evaluate(() => {
    window.__e2eWindowOpen = window.open;
    window.__e2eOpened = [];
    window.open = (url) => {
      window.__e2eOpened.push(String(url));
      return null;
    };
  });
  try {
    await click();
    await waitFor(async () => (await page.evaluate(() => window.__e2eOpened?.length ?? 0)) > 0, "the control to open a page", 5_000, 100);
    return await page.evaluate(() => window.__e2eOpened[0]);
  } finally {
    await page.evaluate(() => {
      if (window.__e2eWindowOpen) window.open = window.__e2eWindowOpen;
      delete window.__e2eWindowOpen;
      delete window.__e2eOpened;
    }).catch(() => {});
  }
}

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/**
 * Whether a public URL answers, following redirects. Sites that turn robots
 * away answer 403 or 429: that is "refused", which a scenario notes rather
 * than fails.
 */
export async function probeUrl(url, { timeoutMs = 20_000 } = {}) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": BROWSER_UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.body?.cancel().catch(() => {});
    const verdict = response.status < 400 ? "ok" : [403, 429].includes(response.status) ? "refused" : "broken";
    return { url, status: response.status, finalUrl: response.url, verdict };
  } catch (error) {
    // No answer at all says more about this machine's network than about the link.
    return { url, status: 0, finalUrl: "", verdict: "unreachable", error: String(error?.cause?.code || error?.message || error) };
  }
}

// ---- GitHub releases (an oracle for the versions Settings shows) ----

export async function githubJSON(path) {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "nextbrowser-e2e" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 429 || (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0")) {
    blocked(`The GitHub API refused an unauthenticated request (${response.status}, rate limit) for ${path}`);
  }
  if (!response.ok) {
    const error = new Error(`GitHub API answered ${response.status} for ${path}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/** The latest published release of the first repository that has one: { repo, tag }. */
export async function latestRelease(repos) {
  const missing = [];
  for (const repo of repos) {
    try {
      const release = await githubJSON(`repos/${repo}/releases/latest`);
      return { repo, tag: release.tag_name };
    } catch (error) {
      if (error.status !== 404) throw error;
      missing.push(repo);
    }
  }
  throw new Error(`No public release in ${missing.join(", ")}`);
}

/** The newest published release older than `tag`. */
export async function releaseBefore(repo, tag) {
  const releases = (await githubJSON(`repos/${repo}/releases?per_page=20`)).filter((release) => !release.draft && !release.prerelease);
  const current = semver(tag);
  return releases.map((release) => release.tag_name).find((name) => semver(name) && compareVersions(semver(name), current) < 0);
}

export function semver(text) {
  const match = String(text ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const BYTE_UNITS = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 };

/** Reads a size the app printed with humanBytes (src/types.ts): "512 B", "1.5 GiB". */
export function parseBytes(text) {
  const match = String(text).match(/([\d.,]+)\s*(B|KiB|MiB|GiB|TiB)\b/);
  return match ? Number(match[1].replace(/,/g, "")) * BYTE_UNITS[match[2]] : NaN;
}

// ---- Sidebar ----

export async function sidebarCollapsed(page) {
  return (await sidebar(page).getByRole("button", { name: "Expand sidebar", exact: true }).count()) > 0;
}

export async function setSidebarCollapsed(page, collapsed) {
  if ((await sidebarCollapsed(page)) === collapsed) return;
  await sidebar(page).getByRole("button", { name: collapsed ? "Collapse sidebar" : "Expand sidebar", exact: true }).click();
  await waitFor(async () => (await sidebarCollapsed(page)) === collapsed, `the sidebar to ${collapsed ? "collapse" : "expand"}`, 10_000, 100);
}

export const sectionToggle = (page, section) => sidebar(page).getByRole("button", { name: new RegExp(`^(Expand|Collapse) ${section}$`) });

/** The list the sidebar shows: "projects", "profiles" or null when both are closed. */
export async function openSection(page) {
  for (const section of ["projects", "profiles"]) {
    if ((await sectionToggle(page, section).getAttribute("aria-expanded")) === "true") return section;
  }
  return null;
}

/** Opens one list (which closes the other, Sidebar.tsx keeps one open) or closes both. */
export async function setOpenSection(page, section) {
  const current = await openSection(page);
  if (current === section) return;
  const toggle = sectionToggle(page, section ?? current);
  if (await toggle.isDisabled()) throw new Error("The sidebar search has text, which keeps both lists open and their toggles disabled");
  await toggle.click();
  await waitFor(async () => (await openSection(page)) === section, `the sidebar to show ${section ?? "no list"}`, 10_000, 100);
  // The list slides open (.workspace-section-reveal in src/styles.css).
  await pause(500);
}

/**
 * How the sidebar fits the window: each project and profile name a user can
 * see without scrolling its list, the section headings, the height each list
 * gets and whether the footer is on screen. Long names end in an ellipsis
 * by design (.profile-name in src/styles.css), so a cut name only matters
 * when too little of it is left to read.
 */
export async function sidebarLayout(page) {
  return sidebar(page).evaluate((aside) => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const rect = (el) => el.getBoundingClientRect();
    const rendered = (el) => {
      const r = rect(el);
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    // The part of an element its clipping ancestors and the window leave visible.
    const visibleRect = (el) => {
      const r = rect(el);
      let { top, bottom, left, right } = r;
      for (let parent = el.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (!/auto|scroll|hidden|clip/.test(`${style.overflowX} ${style.overflowY}`)) continue;
        const p = rect(parent);
        top = Math.max(top, p.top);
        bottom = Math.min(bottom, p.bottom);
        left = Math.max(left, p.left);
        right = Math.min(right, p.right);
      }
      return { top: Math.max(top, 0), bottom: Math.min(bottom, viewport.height), left: Math.max(left, 0), right: Math.min(right, viewport.width) };
    };
    const side = rect(aside);
    const names = [];
    for (const [kind, selector] of [["project", ".workspace-chat-row .workspace-chat-copy strong"], ["profile", ".profile-row .profile-name"]]) {
      for (const el of aside.querySelectorAll(selector)) {
        if (!rendered(el)) continue;
        const shown = visibleRect(el);
        if (shown.bottom - shown.top <= 0) continue; // scrolled out of its list or in a closed one
        const r = rect(el);
        names.push({
          kind,
          text: (el.textContent || "").trim(),
          width: Math.round(Math.max(0, shown.right - shown.left)),
          fullWidth: el.scrollWidth,
          cut: el.scrollWidth > el.clientWidth + 1,
          inside: r.left >= side.left - 1 && r.right <= side.right + 1,
        });
      }
    }
    const heads = [...aside.querySelectorAll(".workspace-section-toggle")].map((toggle) => {
      const label = toggle.querySelector("span");
      const r = rect(toggle);
      return {
        label: (label?.textContent || "").trim(),
        cut: label ? label.scrollWidth > label.clientWidth + 1 : false,
        inView: r.top >= 0 && r.bottom <= viewport.height + 1 && r.right <= Math.min(side.right, viewport.width) + 1,
      };
    });
    const listHeight = (selector) => {
      const el = aside.querySelector(selector);
      if (!el) return 0;
      const shown = visibleRect(el);
      return Math.round(Math.max(0, shown.bottom - shown.top));
    };
    const footer = aside.querySelector(".nextctl-footer");
    return {
      viewport,
      sidebarWidth: Math.round(side.width),
      names,
      heads,
      lists: { projects: listHeight(".workspace-chat-list"), profiles: listHeight(".workspace-profile-list") },
      footerInView: footer ? rect(footer).bottom <= viewport.height + 1 : null,
    };
  });
}

/** What a user could not read in a sidebarLayout() result. */
export function sidebarProblems(layout) {
  const problems = [];
  for (const head of layout.heads) {
    if (head.cut) problems.push(`the «${head.label}» heading is cut`);
    if (!head.inView) problems.push(`the «${head.label}» heading is outside the window`);
  }
  for (const name of layout.names) {
    if (!name.inside) problems.push(`${name.kind} «${name.text}» sticks out of the sidebar`);
    if (name.width < Math.min(name.fullWidth, 48)) problems.push(`${name.kind} «${name.text}» shows ${name.width} of ${name.fullWidth} px`);
  }
  if (layout.footerInView === false) problems.push("the sidebar footer (account, nextctl, agent) is below the window");
  return problems;
}

/**
 * Resizes the app window over CDP and puts it back. Electron may not offer
 * the Browser window domain (it lives in Chrome, not in Chromium's content
 * layer); then the page's viewport is emulated at that size instead, which
 * lays the page out the same way but leaves the window itself alone.
 */
export async function windowSizer(page) {
  const session = await page.context().newCDPSession(page);
  let windowId;
  let original;
  try {
    ({ windowId } = await session.send("Browser.getWindowForTarget"));
    ({ bounds: original } = await session.send("Browser.getWindowBounds", { windowId }));
  } catch {
    windowId = undefined;
  }
  const innerSize = () => page.evaluate(() => `${window.innerWidth}x${window.innerHeight}`);
  const settle = async (before) => {
    await waitFor(async () => (await innerSize()) !== before, "the window to resize", 5_000, 100).catch(() => {});
    await pause(400);
  };
  let restored = false;
  return {
    mode: windowId === undefined ? "emulated viewport" : "window",
    original,
    screen: await page.evaluate(() => ({ width: window.screen.availWidth, height: window.screen.availHeight })),
    async resize(width, height) {
      const before = await innerSize();
      if (windowId === undefined) {
        await session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 0, mobile: false });
      } else {
        const { bounds } = await session.send("Browser.getWindowBounds", { windowId });
        if (bounds.windowState && bounds.windowState !== "normal") await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
        await session.send("Browser.setWindowBounds", { windowId, bounds: { width, height } });
      }
      await settle(before);
      return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    },
    async restore() {
      if (restored) return;
      restored = true;
      try {
        if (windowId === undefined) {
          await session.send("Emulation.clearDeviceMetricsOverride");
        } else {
          const { left, top, width, height, windowState } = original;
          await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
          await session.send("Browser.setWindowBounds", { windowId, bounds: { left, top, width, height } });
          if (windowState && windowState !== "normal") await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState } });
        }
        await pause(400);
      } finally {
        await session.detach().catch(() => {});
      }
    },
  };
}

// ---- Theme and contrast ----

export const themeToggle = (page) => page.getByRole("button", { name: /^Switch to (light|dark) theme$/ }).first();

/** The theme the window shows: App.tsx writes it to <html data-theme>, the attribute src/styles.css keys on. */
export const documentTheme = (page) => page.evaluate(() => document.documentElement.dataset.theme || "");

/**
 * WCAG 2.x contrast of text against what is painted behind it, for the first
 * visible element with text of each selector ("body" means the page's own
 * text colour on its background). Translucent backgrounds are blended over
 * the layers below them.
 */
export async function textContrast(page, selectors) {
  return page.evaluate((selectors) => {
    const parse = (value) => {
      let match = value.match(/^rgba?\(([^)]+)\)$/);
      if (match) {
        const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
      }
      match = value.match(/^color\(srgb ([^)]+)\)$/);
      if (match) {
        const [r, g, b, a = 1] = match[1].split(/[\s/]+/).filter(Boolean).map(Number);
        return { r: r * 255, g: g * 255, b: b * 255, a };
      }
      return null;
    };
    const over = (top, bottom) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1,
    });
    const background = (el) => {
      const layers = [];
      for (let node = el; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0) layers.push(color);
        if (color && color.a >= 1) break;
      }
      let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
      while (layers.length) base = over(layers.pop(), base);
      return base;
    };
    const luminance = ({ r, g, b }) => {
      const channel = (value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const css = ({ r, g, b }) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0;
    };
    return selectors.map((selector) => {
      const el = selector === "body"
        ? document.body
        : [...document.querySelectorAll(selector)].find((candidate) => visible(candidate) && (candidate.textContent || "").trim());
      if (!el) return { selector, missing: true };
      const behind = background(el);
      const color = parse(getComputedStyle(el).color);
      if (!color) return { selector, missing: true, why: `unparsed colour ${getComputedStyle(el).color}` };
      const text = over(color, behind);
      const [light, dark] = [luminance(text), luminance(behind)].sort((a, b) => b - a);
      return {
        selector,
        text: selector === "body" ? "" : (el.textContent || "").trim().slice(0, 40),
        color: css(text),
        background: css(behind),
        ratio: Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100,
      };
    });
  }, selectors);
}

// ---- Interface size ----

/**
 * The interface size control: the sidebar footer's copy, or the one in
 * Settings when the footer copy was hidden ("Hide the interface size
 * control") or the sidebar is collapsed.
 */
export async function uiScaleControl(page) {
  const footer = sidebar(page).getByTitle("Interface size", { exact: true });
  if (await footer.isVisible().catch(() => false)) return { where: "the sidebar footer", control: footer };
  const settings = await openSettings(page);
  return { where: "Settings", control: settings.locator(".settings-row").filter({ hasText: "Interface size" }) };
}

export async function readUiScale(control) {
  return Number((await control.getByText(/^\d+%$/).innerText()).replace("%", ""));
}

export async function setUiScale(control, percent) {
  for (let i = 0; i < 12; i += 1) {
    const current = await readUiScale(control);
    if (current === percent) return;
    const button = control.getByRole("button", { name: current < percent ? "Increase interface size" : "Decrease interface size" });
    if (await button.isDisabled()) throw new Error(`The interface size stops at ${current}%, ${percent}% was wanted`);
    await button.click();
    await waitFor(async () => (await readUiScale(control)) !== current, "the interface size to change", 5_000, 100);
  }
  throw new Error(`The interface size did not reach ${percent}%`);
}

// ---- Agent ----

/** The active agent's name, from the sidebar footer (expanded) or the rail's agent button (collapsed). */
export async function currentAgent(page) {
  const footer = sidebar(page).getByRole("button", { name: "Open agent settings", exact: true });
  if (await footer.count()) return (await footer.innerText()).split("·")[0].trim();
  const rail = sidebar(page).getByRole("button", { name: /^Agent: / });
  return ((await rail.getAttribute("aria-label")) || "").replace(/^Agent:\s*/, "").trim();
}

// ---- Logs (an oracle, like backend-reports.mjs) ----

/**
 * Raw lines a log command prints for the time since `since` (RFC 3339). The
 * command gets the time as its argument, the contract of E2E_REPORTS_CMD.
 */
export function logLines(command, since, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("bash", ["-c", `${command} "$1"`, "log", since], { maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command}: ${stderr.trim() || error.message}`));
      else resolve(stdout.split("\n").filter((line) => line.trim()));
    });
  });
}

/** The time a log line was written: a JSON line's "time"/"ts", else the first RFC 3339 stamp in it. */
export function lineTime(line) {
  try {
    const entry = JSON.parse(line);
    const stamp = entry.time ?? entry.ts ?? entry.timestamp;
    if (stamp) return typeof stamp === "number" ? stamp * (stamp < 1e12 ? 1000 : 1) : Date.parse(stamp);
  } catch { /* not JSON */ }
  const match = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
  return match ? Date.parse(match[0]) : NaN;
}
