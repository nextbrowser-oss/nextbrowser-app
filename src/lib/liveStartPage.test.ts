import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "../electronBridge";
import { nextctlJson, nextctlRun } from "../nextctl";
import { showLiveStartPage, isBrowserPlaceholder } from "./liveStartPage";

vi.mock("../electronBridge", () => ({ invoke: vi.fn() }));
vi.mock("../nextctl", () => ({ nextctlJson: vi.fn(), nextctlRun: vi.fn() }));

const target = { runtime: "dasbrowser", profile: "work" } as const;
const args = ["--runtime", "dasbrowser", "--profile", "work"];
const home = "data:text/html;base64,example";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue(home);
  vi.mocked(nextctlRun).mockResolvedValue({ code: 0, stdout: "", stderr: "" });
});

describe("Live start page", () => {
  it('migrates our legacy and expired local pages, preserving other data documents', () => {
    expect(isBrowserPlaceholder('data:text/html;base64,' + btoa('<title>Nextbrowser</title>'))).toBe(true);
    expect(isBrowserPlaceholder('data:text/html;base64,' + btoa('<title>My document</title>'))).toBe(false);
    expect(isBrowserPlaceholder('http://127.0.0.1:12345/start/' + 'a'.repeat(32) + '/')).toBe(true);
  });
  it("opens the bundled page when verification is the only tab", async () => {
    vi.mocked(nextctlJson).mockResolvedValue({ tabs: [{ id: "verify", url: "clawbrowser://verify/", active: true }] });
    await showLiveStartPage(target, () => true);
    expect(nextctlRun).toHaveBeenCalledWith([...args, "open", home, "--format", "json"]);
  });

  it("restores an existing page when the current tab is blank", async () => {
    vi.mocked(nextctlJson).mockResolvedValue({ tabs: [
      { id: "blank", url: "about:blank", active: true },
      { id: "existing", url: "https://example.com/" },
    ] });
    await showLiveStartPage(target, () => true);
    expect(nextctlRun).toHaveBeenCalledWith([...args, "tabs", "activate", "existing", "--format", "json"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not navigate a profile after the Live target changes", async () => {
    vi.mocked(nextctlJson).mockResolvedValue({ tabs: [] });
    await showLiveStartPage(target, () => false);
    expect(nextctlRun).not.toHaveBeenCalled();
  });
});
