import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_USAGE_DEMOS, GuideUsageSection } from "./GuideUsageDemos";

vi.mock("../store", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({
    setTab: vi.fn(),
    skillCategories: [],
  }),
}));

describe("Guide usage examples", () => {
  it("labels the section once without repeating badges on every card", () => {
    const html = renderToStaticMarkup(<GuideUsageSection />);

    expect(html).toContain("Examples only. Chat tasks open as drafts.");
    expect(html).not.toContain("ILLUSTRATION");
    expect(html).not.toMatch(/>LIVE</);
    expect(html.match(/Examples only/g)).toHaveLength(1);
  });

  it("stages only concrete browser prompts in Chat", () => {
    const chatExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "chat");
    const skillExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "skills");

    expect(chatExamples).toHaveLength(3);
    expect(chatExamples.map((demo) => demo.actionLabel)).toEqual([
      "Open Chat",
      "Open Chat",
      "Try in Chat",
    ]);
    expect(skillExamples).toHaveLength(1);
    expect(skillExamples.every((demo) => demo.actionLabel === "Browse skills")).toBe(true);
  });

  it("asks for Spain rotation and verification explicitly", () => {
    const proxy = GUIDE_USAGE_DEMOS.find((demo) => demo.title === "Change proxy country");
    const prompt = proxy?.action.kind === "chat" ? proxy.action.prompt : "";

    expect(prompt).toMatch(/rotate.*country to ES/i);
    expect(prompt).toMatch(/verify.*country and IP/i);
  });

  it("keeps example visuals generic and shows a human captcha branch", () => {
    const html = GUIDE_USAGE_DEMOS
      .map((demo) => renderToStaticMarkup(createElement(demo.Demo, { phase: 0.8 })))
      .join(" ");

    expect(html).toContain("Example structured output");
    expect(html).toContain("Human check needed");
    expect(html).not.toMatch(/Cian|Madrid|Captcha solved|supported skill · success/i);
  });

  it("uses the real nbc captcha command and falls back to Live", () => {
    const captcha = GUIDE_USAGE_DEMOS.find((demo) => demo.title === "Handle a captcha");
    const prompt = captcha?.action.kind === "chat" ? captcha.action.prompt : "";

    expect(captcha?.actionLabel).toBe("Try in Chat");
    expect(prompt).toContain("nbc captcha auto");
    expect(prompt).toMatch(/take over in Live/i);
  });
});
