import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ScheduledRun } from "../types";
import { ScheduleEditor, ScheduledRunsPanel } from "./ScheduledRunsPanel";

const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock("../store", () => ({ useStore: (select: (s: unknown) => unknown) => select(fixture.state) }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));

const run: ScheduledRun = {
  id: "daily", title: "GitHub star", prompt: "Check GitHub star for nextbrowser project. Use Clawbrowser with GE proxy",
  agent: "codex", enabled: true, hour: 9, minute: 0, weekdays: [1, 2, 3, 4, 5, 6, 7], workspaceId: "w", profileName: "GE",
};

beforeEach(() => {
  fixture.state = {
    scheduledRuns: [run], scheduledRunChatTitle: () => undefined, conversations: [], agentId: "codex",
    activeWorkspaceId: "w", workspaces: [{ id: "w", profileNames: ["GE"] }], profiles: [{ name: "GE" }],
    skillCategories: [], xMonitorState: {}, redditMonitorState: {}, socialMonitors: {},
  };
});

describe("new schedule editor", () => {
  it("defaults to every day, so a daily run is not skipped on weekends", () => {
    const html = renderToStaticMarkup(
      <ScheduleEditor run={null} conversations={[]} profiles={["GE"]} remoteProfiles={["GE"]} agentName="Codex" onSave={() => {}} onClose={() => {}} />,
    );
    const days = html.match(/class="weekday-btn[^"]*"[^>]*aria-pressed="(true|false)"[^>]*>(\w+)</g) ?? [];
    expect(days).toHaveLength(7);
    expect(days.every((day) => day.includes('aria-pressed="true"'))).toBe(true);
  });
});

describe("schedule row", () => {
  it("shows when the run last started and why a later start could not happen", () => {
    fixture.state.scheduledRuns = [{ ...run, lastFiredAt: new Date(2026, 9, 17, 9, 1).getTime(), lastError: "Codex is signed out. Use “Log in” for Codex." }];
    const html = renderToStaticMarkup(<ScheduledRunsPanel asPage />);
    expect(html).toContain("09:00 · Daily");
    expect(html).toContain("Last started");
    expect(html).toContain("Could not start: Codex is signed out. Use “Log in” for Codex. It retries automatically while Nextbrowser is open.");
  });
});
