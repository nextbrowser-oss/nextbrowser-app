import { describe, expect, it } from "vitest";
import { manualProxyDefaultName, manualProxyLimits, parseManualProxyUrl, validateManualProxyFields } from "./manualProxy";

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
      .toThrow("cannot contain spaces");
    expect(() => validateManualProxyFields({ name: "Proxy", host: "host", port: 12.5, username: "", password: "" }))
      .toThrow("whole number between 1 and 65535");
    expect(() => validateManualProxyFields({ name: "Proxy", host: "host", port: 80, username: "x".repeat(manualProxyLimits.username + 1), password: "" }))
      .toThrow("Proxy username is too long");
  });

  it("builds stable generated profile names", () => {
    expect(manualProxyDefaultName(parseManualProxyUrl("socks5://proxy.example:1080"))).toBe(
      "manual-socks5-proxy.example-1080",
    );
  });
});
