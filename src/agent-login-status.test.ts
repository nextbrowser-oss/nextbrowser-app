import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
const { agentLoginStatus } = createRequire(import.meta.url)("../electron/agent-login-status.cjs");
describe("CLI authentication status", () => {
  it("honors explicit logout even when JSON includes account fields", () => {
    expect(agentLoginStatus({ code: 1, stdout: JSON.stringify({ loggedIn: false, email: null, subscription: null }) })).toBe(false);
  });
  it("accepts structured and legacy successful login", () => {
    expect(agentLoginStatus({ code: 0, stdout: '{"loggedIn":true}' })).toBe(true);
    expect(agentLoginStatus({ code: 0, stdout: 'Logged in using ChatGPT' })).toBe(true);
  });
  it("does not mistake incidental words or a command failure for login", () => {
    expect(agentLoginStatus({ code: 1, stderr: 'Cannot read account email' })).toBe(null);
    expect(agentLoginStatus({ code: 0, stdout: 'subscription: none' })).toBe(null);
    expect(agentLoginStatus({ code: 1, stderr: 'Not logged in. Please run login.' })).toBe(false);
  });
});
