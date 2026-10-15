import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduleEditor } from "./ScheduledRunsPanel";

vi.mock("../store", () => ({ useStore: () => undefined }));
vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));

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
