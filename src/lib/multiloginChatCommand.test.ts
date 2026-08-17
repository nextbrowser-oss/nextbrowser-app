import { describe, expect, it } from "vitest";
import { isMultiloginMobileStartRequest, multiloginMobileStartReply } from "./multiloginChatCommand";

describe("Multilogin chat command", () => {
  it.each([
    "запусти этот клаудфон",
    "запусти профиль мультилогина выбранный",
    "Запусти выбранный Multilogin cloud phone",
    "Start the selected Multilogin cloud phone",
  ])("recognizes a simple selected-phone start request: %s", (request) => {
    expect(isMultiloginMobileStartRequest(request)).toBe(true);
  });

  it.each([
    "запусти профиль и открой Telegram",
    "почему телефон не запускается",
    "start the selected browser and log in",
  ])("leaves compound or diagnostic requests to the agent: %s", (request) => {
    expect(isMultiloginMobileStartRequest(request)).toBe(false);
  });

  it("formats immediate start replies", () => {
    expect(multiloginMobileStartReply("Phone", "starting", true)).toBe("Запуск cloud phone «Phone» отправлен.");
    expect(multiloginMobileStartReply("Phone", "started", false)).toBe("Cloud phone “Phone” is already running.");
  });
});
