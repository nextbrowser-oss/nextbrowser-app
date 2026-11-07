// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommandList } from "./index";

afterEach(cleanup);
it("exposes active options and picks without moving focus out of the composer", () => {
  const choose = vi.fn();
  render(<><textarea aria-label="Composer" /><CommandList id="commands" label="Commands" activeId="new"
    options={[{ id: "new", title: "/new", description: "Fresh session" }]} onChoose={choose} /></>);
  screen.getByRole("textbox").focus();
  const option = screen.getByRole("option", { name: "/new Fresh session" });
  expect(option.getAttribute("aria-selected")).toBe("true");
  expect(option.id).toBe("commands-new");
  expect(fireEvent.pointerDown(option)).toBe(false);
  fireEvent.click(option);
  expect(choose).toHaveBeenCalledWith("new");
  expect(document.activeElement).toBe(screen.getByRole("textbox"));
});
it("portals outside the composer's backdrop root so its glass can blur the conversation", () => {
  const anchor = document.createElement("div");
  document.body.append(anchor);
  const { unmount } = render(<CommandList id="anchored" label="Anchored commands" activeId="help" anchor={anchor}
    options={[{ id: "help", title: "/help", description: "Commands" }]} onChoose={() => {}} />);
  expect(screen.getByRole("listbox").parentElement).toBe(document.body);
  expect(screen.getByRole("listbox").style.position).toBe("fixed");
  unmount(); anchor.remove();
});
