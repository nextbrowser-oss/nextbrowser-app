import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfileCreateRequest } from "../types";
import { ProfileCreateRequestModal } from "./ProfileCreateRequestModal";

const state = vi.hoisted(() => ({
  pendingProfileCreateRequests: [] as ProfileCreateRequest[],
  approveProfileCreateRequest: vi.fn(),
  rejectProfileCreateRequest: vi.fn(),
}));

vi.mock("../store", () => ({
  useStore: (select: (value: typeof state) => unknown) => select(state),
}));

function request(overrides: Partial<ProfileCreateRequest>): ProfileCreateRequest {
  return {
    id: "req-1",
    name_prefix: "pixelscan-test",
    quantity: 10,
    country: "US",
    proxy_scheme: "http",
    status: "pending",
    requested_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  state.pendingProfileCreateRequests = [];
  state.approveProfileCreateRequest.mockReset();
  state.rejectProfileCreateRequest.mockReset();
});

describe("agent profile-creation request prompt", () => {
  it("renders nothing without a pending request", () => {
    expect(renderToStaticMarkup(<ProfileCreateRequestModal />)).toBe("");
  });

  it("names the batch, quantity, and country, and never claims profiles already exist", () => {
    state.pendingProfileCreateRequests = [request({ quantity: 3 })];

    const html = renderToStaticMarkup(<ProfileCreateRequestModal />);

    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("An agent wants to create 3 profiles");
    expect(html).toContain("pixelscan-test-1, pixelscan-test-2, pixelscan-test-3");
    expect(html).toContain("US");
    expect(html).toContain("Nothing has been created yet");
    expect(html).toContain("Create 3");
    expect(html).toContain("Decline");
  });

  it("truncates the name preview for a large batch instead of listing every name", () => {
    state.pendingProfileCreateRequests = [request({ quantity: 20 })];

    const html = renderToStaticMarkup(<ProfileCreateRequestModal />);

    expect(html).toContain("pixelscan-test-1, pixelscan-test-2, pixelscan-test-3, pixelscan-test-4, pixelscan-test-5, … (+15 more)");
  });

  it("surfaces how many more requests are queued behind the current one", () => {
    state.pendingProfileCreateRequests = [request({ id: "req-1" }), request({ id: "req-2" }), request({ id: "req-3" })];

    const html = renderToStaticMarkup(<ProfileCreateRequestModal />);

    expect(html).toContain("2 more requests waiting after this one");
  });
});
