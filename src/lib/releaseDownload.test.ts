import { describe, expect, it } from "vitest";
import { latestReleaseUrl } from "../constants";
import { releaseDownloadUrl } from "./releaseDownload";

describe("releaseDownloadUrl", () => {
  it("links directly to the Apple Silicon installer", () => {
    expect(releaseDownloadUrl("0.1.20", "darwin", "arm64")).toBe(
      "https://github.com/nextbrowser-oss/nextbrowser-app/releases/download/v0.1.20/NextBrowser-0.1.20-arm64.dmg",
    );
  });

  it("links directly to the Windows installer", () => {
    expect(releaseDownloadUrl("v0.1.20", "win32", "x64")).toBe(
      "https://github.com/nextbrowser-oss/nextbrowser-app/releases/download/v0.1.20/NextBrowser-0.1.20-x64.exe",
    );
  });

  it("falls back to the releases page for an unavailable build", () => {
    expect(releaseDownloadUrl("0.1.20", "darwin", "x64")).toBe(latestReleaseUrl);
    expect(releaseDownloadUrl(undefined, "win32", "x64")).toBe(latestReleaseUrl);
  });
});
