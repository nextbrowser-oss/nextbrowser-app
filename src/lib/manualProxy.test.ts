import { describe, expect, it } from "vitest";
import { manualProxyDefaultName, manualProxyLimits, parseManualProxyBatch, parseManualProxyClipboard, parseManualProxyUrl, validateManualProxyFields } from "./manualProxy";

describe("manual proxy URL parsing", () => {
  it("parses HTTP proxy URLs with credentials", () => {
    expect(parseManualProxyUrl("http://user:pass@proxy.example:8080")).toEqual({
      scheme: "http",
      host: "proxy.example",
      port: 8080,
      username: "user",
      password: "pass",
    });
  });

  it("parses SOCKS5 proxy URLs with encoded credentials", () => {
    expect(parseManualProxyUrl("socks5://user%40mail.test:p%3Ass@127.0.0.1:1080")).toEqual({
      scheme: "socks5",
      host: "127.0.0.1",
      port: 1080,
      username: "user@mail.test",
      password: "p:ss",
    });
  });

  it("accepts bare host and port as HTTP", () => {
    expect(parseManualProxyUrl("proxy.example:3128")).toMatchObject({
      scheme: "http",
      host: "proxy.example",
      port: 3128,
    });
  });

  it("uses default ports when the URL omits a port", () => {
    expect(parseManualProxyUrl("http://proxy.example")).toMatchObject({ port: 80 });
    expect(parseManualProxyUrl("socks5://proxy.example")).toMatchObject({ port: 1080 });
  });

  it("rejects unsupported proxy schemes", () => {
    expect(() => parseManualProxyUrl("https://proxy.example:443")).toThrow("http:// or socks5://");
  });

  it.each([
    ["", "Proxy URL is required."],
    ["http://", "Enter a valid proxy URL."],
    ["http://proxy.example:0", "Proxy URL must include a valid port."],
    ["http://proxy.example:65536", "Enter a valid proxy URL."],
    ["definitely not a proxy", "Enter host:port"],
    ["nohost:8080", "domain name or IP address"],
  ])("rejects invalid proxy URL %j", (value, message) => {
    expect(() => parseManualProxyUrl(value)).toThrow(message);
  });

  it("parses IPv6 proxy hosts", () => {
    expect(parseManualProxyUrl("socks5://[::1]:1080")).toMatchObject({
      scheme: "socks5",
      host: "[::1]",
      port: 1080,
    });
  });

  it("rejects URL parts that are not proxy connection details", () => {
    expect(() => parseManualProxyUrl("http://proxy.example:8080/path"))
      .toThrow("remove the path, query, or fragment");
    expect(() => parseManualProxyUrl("http://proxy.example:8080?x=1"))
      .toThrow("remove the path, query, or fragment");
  });

  it("reports field length limits and malformed field values", () => {
    expect(() => validateManualProxyFields({ name: "x".repeat(manualProxyLimits.name + 1), host: "host", port: 80, username: "", password: "" }))
      .toThrow("Proxy name is too long");
    expect(() => validateManualProxyFields({ name: "Proxy", host: "bad host", port: 80, username: "", password: "" }))
      .toThrow("without spaces");
    expect(() => validateManualProxyFields({ name: "Proxy", host: "proxy.example", port: 12.5, username: "", password: "" }))
      .toThrow("whole number between 1 and 65535");
    expect(() => validateManualProxyFields({ name: "Proxy", host: "proxy.example", port: 80, username: "x".repeat(manualProxyLimits.username + 1), password: "" }))
      .toThrow("Proxy username is too long");
  });

  it("builds stable generated profile names", () => {
    expect(manualProxyDefaultName(parseManualProxyUrl("socks5://proxy.example:1080"))).toBe(
      "manual-socks5-proxy.example-1080",
    );
  });

  it("imports provider-style host:port:user:pass clipboard values", () => {
    expect(parseManualProxyClipboard("proxy.example:8080:alice:p:a:ss")).toEqual({
      source: "fields",
      scheme: "http",
      host: "proxy.example",
      port: 8080,
      username: "alice",
      password: "p:a:ss",
    });
  });

  it("imports regular proxy URLs from the clipboard", () => {
    expect(parseManualProxyClipboard("socks5://alice:secret@proxy.example:1080")).toMatchObject({
      source: "url",
      scheme: "socks5",
      host: "proxy.example",
      port: 1080,
    });
  });

  it("parses common newline-separated proxy formats", () => {
    const result = parseManualProxyBatch([
      "http://alice:secret@proxy-one.example:8080",
      "proxy-two.example:3128",
      "proxy-three.example:9000:bob:p:a:ss",
      "carol:pass@proxy-four.example:8000",
      "socks5://dave:p%40ss@[2001:db8::1]:1080",
    ].join("\n"));

    expect(result.errors).toEqual([]);
    expect(result.items.map(({ lineNumber, proxy }) => ({ lineNumber, ...proxy }))).toEqual([
      { lineNumber: 1, scheme: "http", host: "proxy-one.example", port: 8080, username: "alice", password: "secret" },
      { lineNumber: 2, scheme: "http", host: "proxy-two.example", port: 3128, username: "", password: "" },
      { lineNumber: 3, scheme: "http", host: "proxy-three.example", port: 9000, username: "bob", password: "p:a:ss" },
      { lineNumber: 4, scheme: "http", host: "proxy-four.example", port: 8000, username: "carol", password: "pass" },
      { lineNumber: 5, scheme: "socks5", host: "[2001:db8::1]", port: 1080, username: "dave", password: "p@ss" },
    ]);
  });

  it("reports invalid and duplicate batch lines without discarding valid proxies", () => {
    const result = parseManualProxyBatch([
      "proxy.example:8080",
      "not a proxy",
      "proxy.example:8080",
      "https://secure-proxy.example:443",
    ].join("\n"));

    expect(result.items).toHaveLength(1);
    expect(result.errors).toEqual([
      { lineNumber: 2, message: expect.stringContaining("Enter host:port") },
      { lineNumber: 3, message: "Duplicate of line 1." },
      { lineNumber: 4, message: "Proxy URL must use http:// or socks5://." },
    ]);
  });

  it("limits the number and total size of proxies in one batch", () => {
    expect(parseManualProxyBatch("proxy.example:80\n".repeat(manualProxyLimits.batchLines + 1)).errors[0].message)
      .toContain(`up to ${manualProxyLimits.batchLines}`);
    expect(parseManualProxyBatch("x".repeat(manualProxyLimits.batchText + 1)).errors[0].message)
      .toContain("too large");
  });
});
