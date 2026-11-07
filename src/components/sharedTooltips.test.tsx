// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../shared/ui";
import { MarkdownText } from "./MarkdownText";
import { SettingsRail } from "./SettingsSections";
import { TrafficChart } from "./TrafficChart";

vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

function showHint(element: Element) {
  fireEvent.pointerOver(element);
  act(() => vi.advanceTimersByTime(180));
  return screen.getByRole("tooltip");
}

describe("shared hints in product components", () => {
  it("shows the settings attention reason while keeping tab semantics and refs usable", () => {
    vi.useFakeTimers();
    const select = vi.fn();
    render(<TooltipProvider><SettingsRail section="general" attention={{ agent: "not connected" }} onSelect={select} /></TooltipProvider>);
    const agent = screen.getByRole("tab", { name: "Agent, not connected" });
    expect(showHint(agent).textContent).toBe("Agent: not connected");
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowDown" });
    expect(select).toHaveBeenCalledWith("updates");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Updates" }));
  });

  it("uses shared hints for Markdown titles, including generated image attributes", () => {
    vi.useFakeTimers();
    render(<TooltipProvider><MarkdownText text={'[Guide](https://example.com "Read the guide")\n\n![Preview](https://example.com/image.png "Image details")'} /></TooltipProvider>);
    const link = screen.getByRole("link", { name: "Guide" });
    const image = screen.getByRole("img", { name: "Preview" });
    expect(link.hasAttribute("title")).toBe(false);
    expect(image.hasAttribute("title")).toBe(false);
    expect(showHint(link).textContent).toBe("Read the guide");
    expect(showHint(image).textContent).toBe("Image details");
  });

  it("preserves chart values and uses the shared portalled surface at the hovered point", () => {
    render(<TrafficChart points={[{ label: "Current period", used_bytes: 1024, requests: 42 }]} />);
    const chart = screen.getByRole("img", { name: "Proxy traffic trend by date" });
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 300));
    fireEvent(chart, new MouseEvent("pointermove", { bubbles: true, clientX: 500, clientY: 100 }));
    const popup = screen.getByRole("tooltip");
    expect(popup.parentElement).toBe(document.body);
    expect(popup.className).toBe("shared-tooltip");
    expect(popup.textContent).toContain("Current period");
    expect(popup.textContent).toContain("Traffic1 KiB");
    expect(popup.textContent).toContain("Requests42");
    expect(chart.getAttribute("aria-describedby")).toBe(popup.id);
    fireEvent.pointerLeave(chart);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
