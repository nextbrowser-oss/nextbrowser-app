// @vitest-environment jsdom
import { createRef, type FormEvent } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { IconButton, TooltipProvider } from "../index";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("forwards native button refs and handlers without submitting its parent form", () => {
  const ref = createRef<HTMLButtonElement>();
  const click = vi.fn();
  const submit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  render(<TooltipProvider><form onSubmit={submit}><IconButton ref={ref} label="Open scripts" onClick={click} aria-expanded={false}><svg aria-hidden="true" /></IconButton></form></TooltipProvider>);
  const button = screen.getByRole("button", { name: "Open scripts" });
  expect(ref.current).toBe(button);
  expect(button.getAttribute("type")).toBe("button");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  expect(click).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it("retains disabled state and shows a shared explanation without changing the action name", () => {
  vi.useFakeTimers();
  const click = vi.fn();
  render(<TooltipProvider><IconButton label="Send" hint="Connect an account first" disabled onClick={click}><svg aria-hidden="true" /></IconButton></TooltipProvider>);
  const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  fireEvent.pointerOver(button);
  act(() => vi.advanceTimersByTime(180));
  expect(screen.getByRole("tooltip").textContent).toBe("Connect an account first");
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  expect(click).not.toHaveBeenCalled();
});
