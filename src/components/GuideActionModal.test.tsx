import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GuideActionModal, type GuideActionConfirmation } from "./GuideActionModal";

describe("Guide action confirmation", () => {
  const confirmation: GuideActionConfirmation = {
    title: "Open Chat?",
    confirmLabel: "Open Chat",
    icon: "tray.full.fill",
    tint: "#ff2d55",
  };

  it("keeps the confirmation focused on one question and two choices", () => {
    const html = renderToStaticMarkup(
      <GuideActionModal
        confirmation={confirmation}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Open Chat?");
    expect(html).toContain(">Cancel</button>");
    expect(html).toContain("Open Chat");
    expect(html).not.toContain("From Guide");
    expect(html).not.toContain("Cancel keeps");
    expect(html).not.toMatch(/<p(?:\s|>)/);
  });
});
