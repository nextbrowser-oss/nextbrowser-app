import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_USAGE_DEMOS, GuideUsageSection } from "./GuideUsageDemos";

vi.mock("../store", () => ({
  useStore: (selector: (state: unknown) => unknown) => selector({
    setTab: vi.fn(),
    setTerminalChat: vi.fn(),
    skillCategories: [],
  }),
}));

describe("Guide usage examples", () => {
  it("labels the section once without repeating badges on every card", () => {
    const html = renderToStaticMarkup(<GuideUsageSection />);

    expect(html).toContain("do not run until you press Send");
    expect(html).not.toContain("ILLUSTRATION");
    expect(html).not.toMatch(/>LIVE</);
    expect(html).not.toContain("Examples only");
  });

  it("stages only concrete browser prompts in Chat", () => {
    const chatExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "chat");
    const skillExamples = GUIDE_USAGE_DEMOS.filter((demo) => demo.action.kind === "skills");

    expect(chatExamples).toHaveLength(2);
    expect(chatExamples.map((demo) => demo.actionLabel)).toEqual([
      "Prepare in Chat",
      "Prepare in Chat",
    ]);
    expect(skillExamples).toHaveLength(1);
    expect(skillExamples.every((demo) => demo.actionLabel === "Browse skills")).toBe(true);
  });

  it("uses a concrete artifact example with a verifiable schema", () => {
    const collection = GUIDE_USAGE_DEMOS.find((demo) => demo.title === "Collect a live list");
    const prompt = collection?.action.kind === "chat" ? collection.action.prompt : "";

    expect(prompt).toContain("news.ycombinator.com/newest");
    expect(prompt).toMatch(/first 5 story titles and URLs/i);
    expect(prompt).toContain("hn-newest.json");
    expect(prompt).toMatch(/all 5 rows/i);
  });

  it("asks for Spain rotation and verification explicitly", () => {
    const proxy = GUIDE_USAGE_DEMOS.find((demo) => demo.title === "Change proxy country");
    const prompt = proxy?.action.kind === "chat" ? proxy.action.prompt : "";

    expect(prompt).toMatch(/rotate.*country to ES/i);
    expect(prompt).toMatch(/verify.*country and IP/i);
  });

  it("keeps example visuals generic", () => {
    const html = GUIDE_USAGE_DEMOS
      .map((demo) => renderToStaticMarkup(createElement(demo.Demo, { phase: 0.8 })))
      .join(" ");

    expect(html).toContain("Example structured output");
    expect(html).not.toMatch(/Cian|Madrid|supported skill · success/i);
  });
});
