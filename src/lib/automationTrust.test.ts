import { describe, expect, it } from "vitest";
import { automationTrustSummary } from "./automationTrust";

describe("automation trust preview", () => {
  it("describes local collection without presenting it as an upload", () => {
    expect(automationTrustSummary({
      domain: "example.com",
      actions: [
        { tool: "open", arguments: { url: "https://example.com/results" } },
        { tool: "extract", arguments: { fields: { title: {} } } },
        { tool: "save_artifact", arguments: { name: "results.json" } },
      ],
    })).toMatchObject({
      domains: ["example.com"],
      savesLocalArtifact: true,
      needsConfirmation: false,
      effects: ["read", "local_artifact"],
    });
  });

  it("calls out a file upload as a user confirmation boundary", () => {
    expect(automationTrustSummary({
      domain: "example.com",
      actions: [{ tool: "upload", arguments: { selector: "input[type=file]" } }],
    })).toMatchObject({ needsConfirmation: true, effects: ["external_upload"] });
  });

  it("makes account, publication, and proxy effects explicit before a run", () => {
    expect(automationTrustSummary({
      domain: "example.com",
      actions: [
        { tool: "input", arguments: { selector: "input[type=password]", text: "kept-out-of-preview" } },
        { tool: "click", arguments: { locator: { role: "button", name: "Publish reply" } } },
        { tool: "select", arguments: { selector: "[name=proxy]", value: "residential" } },
      ],
    })).toMatchObject({
      needsConfirmation: true,
      effects: ["authentication", "form_change", "publication", "proxy_change"],
    });
  });
});
