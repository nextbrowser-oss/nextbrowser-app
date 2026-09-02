import { describe, expect, it } from "vitest";
import { cloudPhoneFromSelection, cloudPhoneRunsIn, cloudPhoneSkillPrompt } from "./cloudPhoneSkill";

describe("cloud-phone skills", () => {
  it("takes only a phone from the workspace's Multilogin selection", () => {
    expect(cloudPhoneFromSelection({ kind: "mobile", id: "p1", name: "Reddit-test", folderId: "f1" }))
      .toEqual({ id: "p1", name: "Reddit-test", folderId: "f1" });
    expect(cloudPhoneFromSelection({ kind: "browser", id: "b1", name: "Amazon US" })).toBeUndefined();
    expect(cloudPhoneFromSelection(undefined)).toBeUndefined();
  });

  it("pins every nbc call to the selected phone and keeps browsers out", () => {
    const prompt = cloudPhoneSkillPrompt("Reddit on a Cloud Phone", "reddit.com", "# Reddit", { id: "p1", name: "Reddit-test", folderId: "f1" }, "Upvote the top post of r/golang.");
    expect(prompt).toContain("cloud phone “Reddit-test” (id p1, folder f1)");
    expect(prompt).toContain("nbc --runtime multilogin --multilogin-folder-id f1 mobile");
    expect(prompt).toContain("Do not start, open, inspect, or change any NextBrowser browser profile");
    expect(prompt.indexOf("Task for this run:\nUpvote the top post")).toBeLessThan(prompt.indexOf("# Reddit"));
  });

  it("asks which phone to use when none is selected instead of guessing", () => {
    const prompt = cloudPhoneSkillPrompt("Reddit on a Cloud Phone", "reddit.com", "# Reddit", undefined);
    expect(prompt).toContain("No cloud phone is selected");
    expect(prompt).toContain("mobile profiles list --json");
    expect(prompt).toContain("do not create a phone and do not guess");
    expect(prompt).not.toContain("Task for this run");
  });

  it("labels the card by the phone it would run on", () => {
    expect(cloudPhoneRunsIn({ id: "p1", name: "Reddit-test" })).toBe("Runs on cloud phone “Reddit-test”");
    expect(cloudPhoneRunsIn(undefined)).toContain("pick one in Connectors");
  });
});
