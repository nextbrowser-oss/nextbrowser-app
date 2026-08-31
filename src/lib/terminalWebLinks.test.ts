import { describe, expect, it, vi } from "vitest";
import { openTerminalWebLink, terminalWebLink } from "./terminalWebLinks";

describe("terminal web links", () => {
  it("accepts clickable HTTP and HTTPS links", () => {
    expect(terminalWebLink("https://example.com/docs?q=1")).toBe("https://example.com/docs?q=1");
    expect(terminalWebLink("http://localhost:3000/path")).toBe("http://localhost:3000/path");
  });

  it("rejects local files and executable URL schemes", () => {
    expect(terminalWebLink("file:///Users/me/private.txt")).toBeUndefined();
    expect(terminalWebLink("javascript:alert(1)")).toBeUndefined();
    expect(terminalWebLink("not a URL")).toBeUndefined();
  });

  it("opens a valid terminal link through the desktop bridge", async () => {
    const open = vi.fn().mockResolvedValue(undefined);

    await expect(openTerminalWebLink("https://example.com", open)).resolves.toBe(true);
    expect(open).toHaveBeenCalledWith("https://example.com/");
  });
});
