// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Select } from "./index";
import { Popover } from "../popover";

const options = [{ value: "nvidia", label: "NVIDIA" }, { value: "openrouter", label: "OpenRouter" }, { value: "deepseek", label: "DeepSeek" }];
afterEach(cleanup);
function Fixture() {
  const [value, setValue] = useState("nvidia");
  return <><Select label="Provider" value={value} options={options} onChange={setValue} /><button>Outside</button></>;
}
it("renders all choices using the shared glass list and commits pointer selection without a native select", () => {
  const { container } = render(<Fixture />);
  const trigger = screen.getByRole("combobox"); trigger.focus(); fireEvent.click(trigger);
  const list = screen.getByRole("listbox", { name: "Provider" });
  expect(list.classList.contains("shared-glass-surface")).toBe(true);
  expect(list.classList.contains("shared-scrollbarless")).toBe(true);
  expect(screen.getAllByRole("option")).toHaveLength(3);
  expect(trigger.getAttribute("aria-controls")).toBe(list.id);
  const option = screen.getByRole("option", { name: "DeepSeek" });
  fireEvent.pointerDown(option); fireEvent.click(option);
  expect(trigger.textContent).toContain("DeepSeek");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(container.querySelector("select")).toBeNull();
});
it("supports arrow keys, Home/End and typeahead, committing only on Enter", () => {
  render(<Fixture />);
  const trigger = screen.getByRole("combobox"); trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "End" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "DeepSeek" }).id);
  expect(trigger.textContent).toContain("NVIDIA");
  fireEvent.keyDown(trigger, { key: "Home" });
  fireEvent.keyDown(trigger, { key: "o" });
  fireEvent.keyDown(trigger, { key: "p" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "OpenRouter" }).id);
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(trigger.textContent).toContain("OpenRouter");
});
it("dismisses on outside pointer, focus departure and Tab and cannot open when disabled", () => {
  render(<Fixture />);
  const trigger = screen.getByRole("combobox");
  for (const close of [() => fireEvent.pointerDown(screen.getByRole("button", { name: "Outside" })), () => { trigger.focus(); screen.getByRole("button", { name: "Outside" }).focus(); }, () => fireEvent.keyDown(trigger, { key: "Tab" })]) {
    fireEvent.click(trigger); expect(screen.getByRole("listbox")).toBeTruthy(); act(close); expect(screen.queryByRole("listbox")).toBeNull();
  }
  cleanup(); const change = vi.fn();
  render(<Select label="Disabled" value="nvidia" options={options} onChange={change} disabled />);
  fireEvent.click(screen.getByRole("combobox"));
  expect(screen.queryByRole("listbox")).toBeNull(); expect(change).not.toHaveBeenCalled();
});
it("closes the list on first Escape while keeping its owning popover open", () => {
  function Nested() {
    const [open, setOpen] = useState(false);
    return <Popover label="Model picker" open={open} onOpenChange={setOpen} trigger={props => <button {...props}>Models</button>}><Fixture /></Popover>;
  }
  render(<Nested />); fireEvent.click(screen.getByRole("button", { name: "Models" }));
  const trigger = screen.getByRole("combobox"); trigger.focus(); fireEvent.click(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull(); expect(screen.getByRole("dialog")).toBeTruthy();
  expect(document.activeElement).toBe(trigger);
  fireEvent.keyDown(trigger, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull();
});
