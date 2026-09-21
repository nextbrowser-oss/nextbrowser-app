import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { BrowserRuntimeUpdatePrompt, type BrowserRuntimeUpdateEntry } from "./BrowserRuntimeUpdatePrompt";

function confirmButton(node: ReactNode): { onClick: (event: unknown) => void } | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ className?: string; children?: ReactNode; onClick: (event: unknown) => void }>(child)) continue;
    if (child.type === "button" && child.props.className === "primary") return child.props;
    const match = confirmButton(child.props.children);
    if (match) return match;
  }
}

const clawbrowser: BrowserRuntimeUpdateEntry = {
  runtime: "clawbrowser", name: "Clawbrowser", status: "available", latestVersion: "1.2.3", releasePage: "https://example.test/releases",
};

describe("Update now", () => {
  it.each([
    [clawbrowser],
    [clawbrowser, { ...clawbrowser, runtime: "camoufox" as const, name: "Camoufox" }],
  ])("passes the confirmed toolsets instead of the React click event: %j", (...runtimes) => {
    const onConfirm = vi.fn();
    const button = confirmButton(BrowserRuntimeUpdatePrompt({ runtimes, onConfirm, onLater: vi.fn() }));
    expect(button).toBeDefined();
    button!.onClick({ type: "click", nativeEvent: {} });
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(runtimes.map((runtime) => runtime.runtime));
  });
});
