import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsPanel, SettingsRail } from "./SettingsSections";

/** The opening tag of each tab in rendered markup, keyed by its section. */
function tabs(html: string): Record<string, string> {
  return Object.fromEntries([...html.matchAll(/<button[^>]*id="settings-tab-([a-z]+)"[^>]*>/g)].map((match) => [match[1], match[0]]));
}

describe("Settings section rail", () => {
  const rail = (section: Parameters<typeof SettingsRail>[0]["section"], attention = {}) =>
    renderToStaticMarkup(<SettingsRail section={section} attention={attention} onSelect={() => undefined} />);

  it("is a vertical tablist of the five sections", () => {
    const html = rail("general");
    expect(html).toMatch(/^<div[^>]*role="tablist"[^>]*>/);
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Settings sections"');
    expect(Object.keys(tabs(html))).toEqual(["general", "privacy", "agent", "browser", "proxy"]);
  });

  it("selects one tab and keeps only it in the Tab order", () => {
    const all = tabs(rail("browser"));
    for (const [id, tag] of Object.entries(all)) {
      expect(tag).toContain('role="tab"');
      expect(tag).toContain('type="button"');
      expect(tag).toContain('aria-controls="settings-panel"');
      expect(tag).toContain(id === "browser" ? 'aria-selected="true"' : 'aria-selected="false"');
      expect(tag).toContain(id === "browser" ? 'tabindex="0"' : 'tabindex="-1"');
    }
    expect(all.browser).toContain("is-active");
  });

  it("marks a section that needs attention and names the reason", () => {
    const html = rail("general", { agent: "not connected" });
    const all = tabs(html);
    expect(all.agent).toContain('aria-label="Agent, not connected"');
    expect(all.agent).toContain('title="Agent: not connected"');
    expect(all.general).not.toContain("aria-label=");
    expect(html.match(/settings-rail-dot/g)).toHaveLength(1);
    expect(html).toContain('<span class="settings-rail-dot" aria-hidden="true"></span>');
  });
});

describe("Settings panel", () => {
  it("is the tab panel of the selected section, headed by its name and summary", () => {
    const html = renderToStaticMarkup(<SettingsPanel section="privacy"><p>content</p></SettingsPanel>);
    expect(html).toMatch(/^<div[^>]*role="tabpanel"[^>]*>/);
    expect(html).toContain('id="settings-panel"');
    expect(html).toContain('aria-labelledby="settings-tab-privacy"');
    expect(html).toContain("<h2>Privacy</h2>");
    expect(html).toContain("Error reports and the device data sent with your account.");
    expect(html).toContain("<p>content</p>");
  });
});

// SettingsModal (App.tsx) renders one section at a time; each setting must stay
// reachable in the section the rail names for it.
describe("Settings sections hold every setting", () => {
  const app = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
  const modal = app.slice(app.indexOf("function SettingsModal("), app.indexOf("function AppUpdatePrompt("));
  const block = (section: string) => {
    const start = modal.indexOf(`{section === "${section}" && (`);
    if (start < 0) throw new Error(`No ${section} section`);
    const next = modal.indexOf("{section === ", start + 1);
    return modal.slice(start, next < 0 ? undefined : next);
  };

  it.each([
    ["general", ["Nextbrowser</span>", "Check for updates", "App update", "Restart and update", "<ManualReleaseDownload", "Interface size", "<UIScaleSlider"]],
    ["privacy", ["Send error reports", "<DeviceDataSettings />"]],
    ["agent", ["<AgentPicker", "Connect", "Login", "Log out", "<AgentInstallLink"]],
    ["browser", ["nextctl</span>", "Profiles</span>", "Browser toolsets", "Check browser toolset updates"]],
    ["proxy", ["Proxy</span>", "Proxy usage", "onOpenUsage()"]],
  ])("%s", (section, settings) => {
    const source = block(section as string);
    for (const setting of settings as string[]) expect(source).toContain(setting);
  });
});
