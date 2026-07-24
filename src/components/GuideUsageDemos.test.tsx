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
  it("labels previews as illustrations rather than live results", () => {
    const html = renderToStaticMarkup(<GuideUsageSection />);

    expect(html).toContain("Illustrative previews, not live results");
    expect(html).toContain("ILLUSTRATION");
    expect(html).not.toMatch(/>LIVE</);
  });

  it("keeps illustration labels outside the animated canvas content", () => {
    const html = renderToStaticMarkup(<GuideUsageSection />);
    const labelIndex = html.indexOf('class="demo-illustration-badge"');
    const playerIndex = html.indexOf('class="demo-player"');

    expect(labelIndex).toBeGreaterThan(-1);
    expect(playerIndex).toBeGreaterThan(labelIndex);
  });

  it("stages only concrete browser prompts in Chat", () => {
    const chatExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "chat");
    const skillExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "skills");

    expect(chatExamples).toHaveLength(2);
    expect(chatExamples.every((demo) => demo.actionLabel === "Open in Chat")).toBe(true);
    expect(skillExamples).toHaveLength(2);
    expect(skillExamples.every((demo) => demo.actionLabel === "Browse skills")).toBe(true);
  });

  it("asks for Spain rotation and verification explicitly", () => {
    const proxy = GUIDE_USAGE_DEMOS.find((demo) => demo.title === "Rotate proxy to Spain");
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
});
