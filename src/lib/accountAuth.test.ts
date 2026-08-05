import { describe, expect, it } from "vitest";
import { accountLoginURL } from "./accountAuth";

describe("accountLoginURL", () => {
  it("forces pairing through the existing login endpoint", () => {
    const url = accountLoginURL(
      "https://app.nextbrowser.com/connect?pairing_code=ABC123&pairing_id=pairing-1",
    );

    expect(url).toBe(
      "https://app.nextbrowser.com/api/session/login?next=%2Fconnect%3Fpairing_code%3DABC123%26pairing_id%3Dpairing-1",
    );
  });

  it("rejects a non-HTTPS verification URL", () => {
    expect(() => accountLoginURL("http://app.nextbrowser.com/connect"))
      .toThrow("Account verification URL must use HTTPS");
  });
});
