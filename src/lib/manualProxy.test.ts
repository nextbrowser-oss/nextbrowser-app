import { describe, expect, it } from "vitest";
import { manualProxyDefaultName, parseManualProxyUrl } from "./manualProxy";

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

  it("builds stable generated profile names", () => {
    expect(manualProxyDefaultName(parseManualProxyUrl("socks5://proxy.example:1080"))).toBe(
      "manual-socks5-proxy.example-1080",
    );
  });
});
