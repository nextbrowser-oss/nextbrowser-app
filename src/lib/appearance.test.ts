import { describe, expect, it } from "vitest";
import { appearanceTokens, parseAppearance } from "./appearance";

describe("saved appearance", () => {
  it("recovers valid settings independently of malformed colors, photos and sizes", () => {
    expect(parseAppearance("{")).toEqual({});
    expect(parseAppearance(JSON.stringify({
      accent: "#7F23af", outgoing: "bad", background: "#123456", gradientEnd: "invalid",
      wallpaper: "photo", photo: "https://example.com/image.jpg", radius: 400,
    }))).toEqual({ accent: "#7F23af", background: "#123456" });
  });

  it("preserves a local photo while another wallpaper is selected", () => {
    const settings = { wallpaper: "solid", photo: "data:image/jpeg;base64,YQ==", radius: 8 } as const;
    expect(parseAppearance(JSON.stringify(settings))).toEqual(settings);
    expect(appearanceTokens(settings)["--chat-wallpaper"]).toEqual("none");
  });

  it("uses contrasting text with custom bubbles and restores the palette when cleared", () => {
    expect(appearanceTokens({ incoming: "#eeeeee", outgoing: "#111111" })).toMatchObject({
      "--chat-incoming-ink": "var(--black)", "--chat-outgoing-ink": "var(--white)",
    });
    expect(appearanceTokens({})).toEqual({});
  });
});
