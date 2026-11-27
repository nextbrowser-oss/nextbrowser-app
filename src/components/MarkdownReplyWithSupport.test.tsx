// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportUserFacingMessage } from "../lib/errorReporting";
import { TooltipProvider } from "../shared/ui";
import { MarkdownReplyWithSupport } from "./MarkdownText";

vi.mock("../lib/errorReporting", () => ({ reportUserFacingMessage: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("agent replies with a support reference", () => {
  const ref = "NB-0123ABCD-1234";
  const diagnostic = `The search paused. Ref: ${ref}`;

  it("renders the saved partial result as Markdown and keeps the diagnostic outside its list", () => {
    const text = [
      "**Что проверено**", "", "- Маршрут выбран", "- Даты требуют проверки", "",
      "**Дальше**", "", "1. Открыть [календарь](https://example.com/calendar)", "2. Проверить `даты`", diagnostic,
    ].join("\n");
    const { container } = render(<TooltipProvider><MarkdownReplyWithSupport text={text} diagnosticRef={ref} /></TooltipProvider>);
    expect(screen.getByText("Что проверено").tagName).toBe("STRONG");
    expect(container.querySelectorAll("ul > li")).toHaveLength(2);
    expect(container.querySelectorAll("ol > li")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "календарь" }).getAttribute("href")).toBe("https://example.com/calendar");
    expect(screen.getByText("даты").tagName).toBe("CODE");
    const support = screen.getByText(diagnostic);
    expect(support.closest("li, .markdown")).toBeNull();
    expect(within(support).getByRole("link", { name: "Get help in Discord." })).toBeTruthy();
    expect(reportUserFacingMessage).toHaveBeenCalledWith("agent-turn", text);
  });

  it("preserves a reference quoted as code in a reply without run metadata", () => {
    const text = ["**Пример**", "", "```", `Ref: ${ref}`, "```"].join("\n");
    render(<MarkdownReplyWithSupport text={text} />);
    expect(screen.getByText("Пример").tagName).toBe("STRONG");
    expect(screen.getByText(`Ref: ${ref}`).closest("pre")).toBeTruthy();
  });

  it("shows a standalone diagnostic once without an empty reply body", () => {
    const { container } = render(<MarkdownReplyWithSupport text={diagnostic} diagnosticRef={ref} />);
    expect(container.querySelector(".markdown")).toBeNull();
    expect(screen.getAllByText(diagnostic)).toHaveLength(1);
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });
});
