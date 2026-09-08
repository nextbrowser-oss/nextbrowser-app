import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PersonalProxySelect } from "./PersonalProxySelect";

describe("PersonalProxySelect", () => {
  it("uses the app-styled picker instead of the native select menu", () => {
    const html = renderToStaticMarkup(
      <PersonalProxySelect
        value="proxy-1"
        proxies={[{ id: "proxy-1", name: "US residential", scheme: "http", host: "proxy.example", port: 8080 }]}
        onChange={vi.fn()}
        onAdd={vi.fn()}
      />,
    );

    expect(html).toContain("US residential");
    expect(html).toContain("personal-proxy-select-trigger");
    expect(html).not.toContain("<select");
  });
});
