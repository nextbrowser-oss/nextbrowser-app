import { describe, expect, it } from "vitest";
import { hostStartCommand } from "./hostStartCommand";

describe("host start command", () => {
  it("sends the profile as a form field every shell passes unchanged", () => {
    expect(hostStartCommand("Clawbrowser profile")).toBe(
      `curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/start" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" --data "profile=Clawbrowser%20profile"`,
    );
    for (const name of ["HEY!", `It's "mine" $HOME (1)*`, "Профиль 1", "a+b&c=d", "back`tick;|"]) {
      const value = hostStartCommand(name).match(/--data "profile=([^"]*)"$/)?.[1] ?? "";
      expect(value, name).toMatch(/^[A-Za-z0-9._~%-]+$/);
      expect(new URLSearchParams(`profile=${value}`).get("profile"), name).toBe(name);
    }
  });
});
