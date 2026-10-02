import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProxyTraffic } from "../types";
import { UsageView } from "./UsageView";

const state = vi.hoisted(() => ({
  authed: true,
  isRefreshing: false,
  proxyWarning: undefined,
  refreshProxyData: vi.fn(),
  githubStar: undefined,
  loadGitHubStar: vi.fn(),
  proxy: undefined as ProxyTraffic | undefined,
}));

vi.mock("../store", () => ({ useStore: (select?: (value: typeof state) => unknown) => select ? select(state) : state }));
vi.mock("../lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("./TrafficChart", () => ({ TrafficChart: () => null }));

describe("NodeMaven purchase handoff", () => {
  it("offers the invitation after the full 1 GB trial is exhausted", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 1_000_000_000,
      limit_bytes: 1_000_000_000, remaining_bytes: 0, state: "exhausted",
      provider_account_email: "customer@example.com",
      provider_access_url: "https://dashboard.nodemaven.com/accounts/password/reset/",
      pricing_url: "https://dashboard.nodemaven.com/pricing",
    } as ProxyTraffic;
    const html = renderToStaticMarkup(<UsageView />);
    expect(html).toContain("Buy traffic in NodeMaven");
    expect(html).toContain("email you a link");
    expect(html).not.toContain("Set up account access");
  });

  it("does not offer the purchase invitation while trial traffic remains", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 500_000_000,
      limit_bytes: 1_000_000_000, remaining_bytes: 500_000_000, state: "ok",
    } as ProxyTraffic;
    expect(renderToStaticMarkup(<UsageView />)).not.toContain("Buy traffic in NodeMaven");
  });

  it("keeps dashboard access after an invite, including while traffic remains", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 500_000_000,
      limit_bytes: 1_000_000_000, remaining_bytes: 500_000_000, state: "ok",
      provider_access_method: "email_sent",
      dashboard_url: "https://dashboard.nodemaven.com/dashboard",
      pricing_url: "https://dashboard.nodemaven.com/pricing",
    } as ProxyTraffic;
    const html = renderToStaticMarkup(<UsageView />);
    expect(html).toContain("Open NodeMaven dashboard");
    expect(html).not.toContain("Buy traffic in NodeMaven");
  });

  it("offers another purchase and dashboard access when a later allocation runs out", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 2_000_000_000,
      limit_bytes: 2_000_000_000, remaining_bytes: 0, state: "exhausted",
      provider_access_method: "email_sent",
      dashboard_url: "https://dashboard.nodemaven.com/dashboard",
      pricing_url: "https://dashboard.nodemaven.com/pricing",
    } as ProxyTraffic;
    const html = renderToStaticMarkup(<UsageView />);
    expect(html).toContain("Open NodeMaven dashboard");
    expect(html).toContain("Buy more traffic in NodeMaven");
  });

  it("keeps the purchase handoff hidden during the human-review gate", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 10_000_000,
      limit_bytes: 100_000_000, remaining_bytes: 90_000_000, state: "ok",
      provider_account_email: "customer@example.com",
    } as ProxyTraffic;
    const html = renderToStaticMarkup(<UsageView />);
    expect(html).not.toContain("Your NodeMaven account is ready");
    expect(html).not.toContain("Buy traffic in NodeMaven");
  });

  it("keeps the dashboard link visible if a previously invited account is paused", () => {
    state.proxy = {
      provider: "nodemaven", limited: true, used_bytes: 100_000_000,
      limit_bytes: 100_000_000, remaining_bytes: 0, state: "exhausted",
      provider_access_method: "email_sent",
      dashboard_url: "https://dashboard.nodemaven.com/dashboard",
    } as ProxyTraffic;
    const html = renderToStaticMarkup(<UsageView />);
    expect(html).toContain("Open NodeMaven dashboard");
    expect(html).not.toContain("Buy more traffic in NodeMaven");
  });
});
