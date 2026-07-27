import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CAPTCHA_GUIDE_PROMPT, GUIDE_FEATURE_GROUPS } from "../lib/guideFeatures";
import { GuideFeatureCard } from "./GuideView";

vi.mock("../store", () => ({ useStore: vi.fn() }));

describe("Guide feature navigation", () => {
  const features = GUIDE_FEATURE_GROUPS.flatMap((group) => group.features);

  it("gives every feature a unique, real navigation action", () => {
    expect(features).toHaveLength(14);
    expect(new Set(features.map((feature) => feature.id)).size).toBe(features.length);
    expect(features.every((feature) => feature.action && feature.actionLabel)).toBe(true);
  });

  it.each(features.map((feature) => [feature.id, feature] as const))(
    "renders %s as an accessible clickable card",
    (_id, feature) => {
      const html = renderToStaticMarkup(
        <GuideFeatureCard feature={feature} onActivate={vi.fn()} />,
      );

      expect(html).toContain("<button");
      expect(html).toContain(`data-guide-feature="${feature.id}"`);
      expect(html).toContain("aria-label=");
      expect(html).toContain(feature.actionLabel);
    },
  );

  it("avoids claims the current app does not guarantee", () => {
    const copy = features.map((feature) => `${feature.title} ${feature.caption}`).join(" ");

    expect(copy).not.toMatch(/killed|each its own tab|automatically solved|universal bypass|source totals/i);
    expect(copy).toContain("Live View");
    expect(copy).toContain("while NextBrowser is open");
  });

  it("keeps every card description short", () => {
    expect(features.every((feature) => feature.caption.length <= 52)).toBe(true);
  });

  it("uses dedicated profile and captcha destinations", () => {
    expect(features.find((feature) => feature.id === "profiles")?.action).toBe("profiles");
    expect(features.find((feature) => feature.id === "identity")?.action).toBe("identity");
    expect(features.find((feature) => feature.id === "captcha")?.action).toBe("captcha");
  });

  it("sends captcha handling to Chat with an nbc fallback flow", () => {
    const captcha = features.find((feature) => feature.id === "captcha");

    expect(captcha?.actionLabel).toBe("Try in Chat");
    expect(captcha?.caption).toMatch(/nbc.*Live/i);
    expect(CAPTCHA_GUIDE_PROMPT).toContain("nbc captcha auto");
    expect(CAPTCHA_GUIDE_PROMPT).toMatch(/take over in Live/i);
  });
});
