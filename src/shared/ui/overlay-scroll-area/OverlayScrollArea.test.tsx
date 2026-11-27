// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OverlayScrollArea } from "./index";

let itemsHeight = 1000;
let viewportHeight = 500;
let dockHeight = 120;
const callbacks = new Set<() => void>();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let positions = new WeakMap<Element, number>();
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");
const scrollTo = vi.fn(function (this: HTMLElement, options: ScrollToOptions) {
  this.scrollTop = options.top ?? 0;
  this.dispatchEvent(new Event("scroll", { bubbles: false }));
});
const resize = () => act(() => {
  callbacks.forEach(run => run());
  for (const [id, run] of [...frames]) { frames.delete(id); run(performance.now()); }
});
const isContent = (element: Element) => element.classList.contains("overlay-scroll-area__content");

beforeEach(() => {
  itemsHeight = 1000; viewportHeight = 500; dockHeight = 120; positions = new WeakMap(); scrollTo.mockClear();
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) { return isContent(this) ? viewportHeight : 0; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return this.classList.contains("overlay-scroll-area__overlay") ? dockHeight : 0; });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(function (this: Element) { return isContent(this) ? itemsHeight + dockHeight + 24 : 0; });
  vi.spyOn(Element.prototype, "scrollTop", "get").mockImplementation(function (this: Element) { return positions.get(this) ?? 0; });
  vi.spyOn(Element.prototype, "scrollTop", "set").mockImplementation(function (this: Element, value: number) { positions.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))); });
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(run => { frames.set(++frameId, run); return frameId; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  vi.stubGlobal("ResizeObserver", class {
    private run: () => void;
    constructor(callback: ResizeObserverCallback) { this.run = () => callback([], this as unknown as ResizeObserver); callbacks.add(this.run); }
    observe() {}
    disconnect() { callbacks.delete(this.run); }
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); callbacks.clear(); frames.clear();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});
const view = (resetKey = "one") => <OverlayScrollArea autoFollow resetKey={resetKey} endButtonLabel="Latest message" overlay={<textarea aria-label="Message" />}><p>History</p></OverlayScrollArea>;
function content(container: HTMLElement) { return container.querySelector(".overlay-scroll-area__content") as HTMLElement; }
function readAbove(scroll: HTMLElement) { scroll.scrollTop = 100; fireEvent.scroll(scroll); }

it("hides the action at the bottom and reveals it only when history is scrolled up", () => {
  const { container } = render(view());
  const scroll = content(container);
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  expect(screen.queryByRole("button", { name: "Latest message" })).toBeNull();
  readAbove(scroll);
  const button = screen.getByRole("button", { name: "Latest message" });
  expect(button.getAttribute("aria-controls")).toBe(scroll.id);
});

it("returns to the latest content, respects reduced motion and hides itself", () => {
  const { container } = render(view());
  const scroll = content(container);
  readAbove(scroll);
  fireEvent.click(screen.getByRole("button", { name: "Latest message" }));
  expect(scrollTo).toHaveBeenCalledWith({ top: scroll.scrollHeight, behavior: "instant" });
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  expect(screen.queryByRole("button", { name: "Latest message" })).toBeNull();
});

it("follows incoming content at the bottom and preserves the position of a reader above it", () => {
  const { container } = render(view());
  const scroll = content(container);
  itemsHeight += 200; resize();
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  readAbove(scroll);
  itemsHeight += 200; resize();
  expect(scroll.scrollTop).toBe(100);
  expect(screen.getByRole("button", { name: "Latest message" })).toBeTruthy();
});

it("retains the right position when the input area grows", () => {
  const { container } = render(view());
  const scroll = content(container);
  dockHeight += 100; resize();
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  readAbove(scroll);
  dockHeight += 100; resize();
  expect(scroll.scrollTop).toBe(100);
});

it("starts a different conversation at its latest message", () => {
  const { container, rerender } = render(view());
  const scroll = content(container);
  readAbove(scroll);
  rerender(view("two"));
  expect(scroll.scrollTop).toBe(scroll.scrollHeight - scroll.clientHeight);
  expect(screen.queryByRole("button", { name: "Latest message" })).toBeNull();
});

it("does not show the action for content that fits", () => {
  itemsHeight = 80;
  render(view());
  expect(screen.queryByRole("button", { name: "Latest message" })).toBeNull();
});

it("does not reset a reader's position when a persistent tab is temporarily hidden", () => {
  const { container } = render(view());
  const scroll = content(container);
  readAbove(scroll);
  viewportHeight = 0; resize();
  viewportHeight = 500; resize();
  expect(scroll.scrollTop).toBe(100);
});
