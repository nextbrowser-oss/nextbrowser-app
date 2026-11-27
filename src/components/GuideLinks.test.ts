import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { GUIDE_FEATURE_GROUPS } from "../lib/guideFeatures";
import { isUtilityDialogTab } from "../lib/appNavigation";
import { GUIDE_USAGE_DEMOS } from "./GuideUsageDemos";

vi.mock("../store", () => ({ useStore: vi.fn() }));

const srcRoot = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, srcRoot), "utf8");

// Everything the Guide screen links to, plus the tour its "Replay tour" opens.
const guideSources = [
  "components/GuideView.tsx",
  "components/GuideUsageDemos.tsx",
  "components/OnboardingView.tsx",
  "lib/guideQuickStart.ts",
  "lib/guideDraft.ts",
].map(read).join("\n");

const appSources = readdirSync(srcRoot, { recursive: true, encoding: "utf8" })
  .filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
  .map(read)
  .join("\n");

const matches = (text: string, pattern: RegExp) => [...new Set([...text.matchAll(pattern)].map((match) => match[1]))];

describe("Guide links", () => {
  it("only sends events some part of the app listens for", () => {
    const sent = matches(guideSources, /"(nextbrowser:[a-z-]+)"/g);
    const heard = matches(appSources, /addEventListener\(\s*"(nextbrowser:[a-z-]+)"/g);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.filter((name) => !heard.includes(name))).toEqual([]);
  });

  it("only opens views or utility dialogs the app renders", () => {
    const special = new Set(["account", "agent", "profiles", "start_session", "identity"]);
    const tabs = new Set([
      ...GUIDE_FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.action)).filter((action) => !special.has(action)),
      ...matches(guideSources, /setTab\("([a-z]+)"\)/g),
    ]);
    const app = read("App.tsx");

    expect([...tabs]).toEqual(expect.arrayContaining(["chat", "live", "scheduled", "skills", "usage"]));
    expect([...tabs].filter((tab) => !isUtilityDialogTab(tab) && !app.includes(`tab === "${tab}"`))).toEqual([]);
  });

  it("names only well-formed https pages in example prompts", () => {
    const urls = GUIDE_USAGE_DEMOS.flatMap((demo) => demo.action.kind === "chat"
      ? demo.action.prompt.match(/\bhttps?:\/\/[^\s,)]+/g) ?? []
      : []);

    expect(urls).toEqual(["https://news.ycombinator.com/newest"]);
    expect(urls.every((url) => new URL(url).protocol === "https:")).toBe(true);
  });
});
