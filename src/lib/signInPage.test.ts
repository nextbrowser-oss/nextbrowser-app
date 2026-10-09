import { describe, expect, it } from "vitest";
import { signInDone } from "./signInPage";

describe("signInDone", () => {
  it("is done once the tab is back on the site", () => {
    expect(signInDone("https://www.tiktok.com/foryou?lang=et", "tiktok.com")).toBe(true);
    expect(signInDone("https://www.instagram.com/", "instagram.com")).toBe(true);
    expect(signInDone("https://www.linkedin.com/feed/", "linkedin.com")).toBe(true);
    expect(signInDone("https://m.facebook.com/home.php", "facebook.com")).toBe(true);
  });

  it("waits while the tab is on a sign-in, sign-up or code page", () => {
    expect(signInDone("https://www.tiktok.com/login/phone-or-email/email", "tiktok.com")).toBe(false);
    expect(signInDone("https://www.instagram.com/accounts/login/?next=%2F", "instagram.com")).toBe(false);
    expect(signInDone("https://www.instagram.com/challenge/action/", "instagram.com")).toBe(false);
    expect(signInDone("https://www.facebook.com/checkpoint/1501092823525282/", "facebook.com")).toBe(false);
    expect(signInDone("https://www.facebook.com/two_step_verification/two_factor/", "facebook.com")).toBe(false);
    expect(signInDone("https://www.linkedin.com/uas/login-submit", "linkedin.com")).toBe(false);
    expect(signInDone("https://www.tiktok.com/signup", "tiktok.com")).toBe(false);
  });

  it("waits while an identity provider or another site is open", () => {
    expect(signInDone("https://accounts.google.com/v3/signin/identifier", "tiktok.com")).toBe(false);
    expect(signInDone("https://appleid.apple.com/auth/authorize", "instagram.com")).toBe(false);
    expect(signInDone("https://www.instagram.com/", "tiktok.com")).toBe(false);
    expect(signInDone("https://nottiktok.com/", "tiktok.com")).toBe(false);
  });

  it("reads nothing into a page it cannot parse", () => {
    expect(signInDone("about:blank", "tiktok.com")).toBe(false);
    expect(signInDone("", "tiktok.com")).toBe(false);
  });
});
