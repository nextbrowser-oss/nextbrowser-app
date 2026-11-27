// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tooltip, TooltipContent, TooltipProvider } from "./index";

function hover(element: Element, pointerType = "mouse") {
  const event = new MouseEvent("pointerover", { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  fireEvent(element, event);
}
function tick(ms = 180) { act(() => vi.advanceTimersByTime(ms)); }
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("shared Tooltip", () => {
  it("keeps the same DOM child, refs, click handlers and accessible names", () => {
    const ref = createRef<HTMLButtonElement>();
    const click = vi.fn();
    const { container } = render(<TooltipProvider><Tooltip content="Settings"><button ref={ref} onClick={click}><svg aria-hidden="true" /></button></Tooltip></TooltipProvider>);
    const button = screen.getByRole("button", { name: "Settings" });
    expect(container.firstElementChild).toBe(button);
    expect(ref.current).toBe(button);
    fireEvent.click(button);
    expect(click).toHaveBeenCalledOnce();
    expect(button.hasAttribute("title")).toBe(false);
  });

  it("delays hover, portals outside clipping parents and preserves visible button text", () => {
    const { container } = render(<TooltipProvider><div style={{ overflow: "hidden" }}><Tooltip content="A longer explanation"><button>Run</button></Tooltip></div></TooltipProvider>);
    const button = screen.getByRole("button", { name: "Run" });
    hover(button); tick(179);
    expect(screen.queryByRole("tooltip")).toBeNull();
    tick(1);
    const popup = screen.getByRole("tooltip");
    expect(popup.textContent).toBe("A longer explanation");
    expect(popup.parentElement).toBe(document.body);
    expect(container.contains(popup)).toBe(false);
    expect(button.getAttribute("aria-label")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe(popup.id);
  });

  it("shows the reason on a disabled button without enabling it or adding a wrapper", () => {
    const click = vi.fn();
    const { container } = render(<TooltipProvider><Tooltip content="Connect an account first"><button disabled onClick={click}>Send</button></Tooltip></TooltipProvider>);
    const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    hover(button); tick();
    expect(screen.getByRole("tooltip").textContent).toBe("Connect an account first");
    expect(container.firstElementChild).toBe(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(click).not.toHaveBeenCalled();
  });

  it("opens immediately on keyboard focus and restores existing descriptions on Escape", () => {
    render(<TooltipProvider><Tooltip content="More details"><button aria-describedby="help">Run</button></Tooltip></TooltipProvider>);
    const button = screen.getByRole("button");
    hover(button);
    // jsdom does not implement the browser's keyboard/pointer focus-visible heuristic.
    const matches = button.matches.bind(button);
    vi.spyOn(button, "matches").mockImplementation(selector => selector === ":focus-visible" || matches(selector));
    act(() => button.focus()); tick(0);
    expect(button.getAttribute("aria-describedby")).toContain(screen.getByRole("tooltip").id);
    const parentEscape = vi.fn();
    document.addEventListener("keydown", parentEscape);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(button.getAttribute("aria-describedby")).toBe("help");
    expect(parentEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(parentEscape).toHaveBeenCalledOnce();
    document.removeEventListener("keydown", parentEscape);
  });

  it("allows the pointer to cross the gap and hover or scroll long tooltip content", () => {
    render(<TooltipProvider><Tooltip content={<span>Long details</span>}><button>Run</button></Tooltip></TooltipProvider>);
    const button = screen.getByRole("button");
    hover(button); tick();
    const popup = screen.getByRole("tooltip");
    fireEvent.pointerOut(button, { relatedTarget: document.body }); tick(50);
    hover(popup); tick(100);
    fireEvent.scroll(popup);
    expect(screen.getByRole("tooltip")).toBe(popup);
    fireEvent.pointerLeave(popup); tick(100);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("describes the focused input when a hint belongs to its label", () => {
    render(<TooltipProvider><Tooltip content="Read only when keywords are set"><label><input type="checkbox" />Watch comments</label></Tooltip></TooltipProvider>);
    const input = screen.getByRole("checkbox");
    const matches = input.matches.bind(input);
    vi.spyOn(input, "matches").mockImplementation(selector => selector === ":focus-visible" || matches(selector));
    act(() => input.focus()); tick(0);
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
    fireEvent.blur(input);
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  it.each(["scroll", "resize", "blur", "pointerdown"])("dismisses on outside %s", event => {
    render(<TooltipProvider><Tooltip content="Details"><button>Run</button></Tooltip></TooltipProvider>);
    hover(screen.getByRole("button")); tick();
    fireEvent(event === "pointerdown" ? document.body : window, new Event(event));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("updates visible content and removes stale hints when the trigger unmounts or becomes empty", () => {
    const view = (content: string) => <TooltipProvider><Tooltip content={content}><button>Run</button></Tooltip></TooltipProvider>;
    const { rerender, unmount } = render(view("Before"));
    hover(screen.getByRole("button")); tick();
    rerender(view("After"));
    expect(screen.getByRole("tooltip").textContent).toBe("After");
    rerender(view(""));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button").hasAttribute("data-tooltip-id")).toBe(false);
    rerender(view("Again")); hover(screen.getByRole("button"));
    unmount(); tick();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("ignores touch and cancels pending hints when the pointer leaves", () => {
    render(<TooltipProvider><Tooltip content="Details"><button>Run</button></Tooltip></TooltipProvider>);
    const button = screen.getByRole("button");
    hover(button, "touch"); tick();
    expect(screen.queryByRole("tooltip")).toBeNull();
    hover(button); fireEvent.pointerOut(button, { relatedTarget: document.body }); tick();
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("uses the same glass surface for controlled rich content and virtual chart anchors", () => {
    const anchor = { getBoundingClientRect: () => ({ left: 100, right: 120, top: 100, bottom: 120, width: 20, height: 20 }) };
    render(<TooltipContent anchor={anchor} side="right" interactive={false}><strong>Traffic</strong><span>42 MB</span></TooltipContent>);
    const popup = screen.getByRole("tooltip");
    expect(popup.classList.contains("shared-tooltip")).toBe(true);
    expect(popup.classList.contains("shared-glass-surface")).toBe(true);
    expect(popup.textContent).toBe("Traffic42 MB");
    expect(popup.style.pointerEvents).toBe("none");
    expect(popup.style.left).toBe("130px");
    expect(popup.getAttribute("data-side")).toBe("right");
  });
});
