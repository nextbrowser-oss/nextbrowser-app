import { expect, it } from "vitest";
import { activityFromText } from "./activityParser";

it("reports a detected CAPTCHA as a blocker rather than ordinary activity", () => {
  expect(activityFromText("Failed: CAPTCHA_REQUIRED")).toBe("Browser verification needs attention");
  expect(activityFromText("Появилась капча")).toBe("Browser verification needs attention");
  expect(activityFromText("captcha: detected")).toBe("Browser verification needs attention");
  expect(activityFromText("No CAPTCHA detected")).not.toBe("Browser verification needs attention");
  expect(activityFromText("Look up how CAPTCHA verification works")).not.toBe("Browser verification needs attention");
});
