import { describe, expect, it } from "vitest";
import { identityScript, type IdentitySnapshot } from "./scripts";

/** A stand-in for the parts of a page the identity script reads. The scripts run
 *  in the browser, so the only way to test what they make of x.com's markup is to
 *  hand them a document — this one answers exactly the selectors they use. */
interface FakeNode {
  tag?: string;
  testId?: string;
  role?: string;
  text?: string;
  label?: string;
  href?: string;
  children?: FakeNode[];
}

interface Element {
  getAttribute(name: string): string | null;
  innerText: string;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Element[];
}

/** matches understands the shapes the scripts actually ask for: an optional tag,
 *  an exact or prefix test id, and role. */
function matches(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const one = part.trim();
    const attribute = /^([a-z]*)\[([a-z-]+)(\^?)=\"([^\"]*)\"\]$/.exec(one);
    if (!attribute) return false;
    const [, tag, name, prefix, value] = attribute;
    if (tag && (node.tag ?? "div") !== tag) return false;
    const actual = name === "data-testid" ? node.testId : name === "role" ? node.role : name === "href" ? node.href : undefined;
    if (actual === undefined) return false;
    return prefix ? actual.startsWith(value) : actual === value;
  });
}

function element(node: FakeNode): Element {
  const descendants = (): Element[] => (node.children ?? []).flatMap((child) => [element(child), ...element(child).querySelectorAll("*")]);
  return {
    getAttribute: (name) => {
      if (name === "data-testid") return node.testId ?? null;
      if (name === "aria-label") return node.label ?? null;
      if (name === "href") return node.href ?? null;
      if (name === "role") return node.role ?? null;
      return null;
    },
    innerText: node.text ?? "",
    querySelectorAll: (selector) => {
      const all = (current: FakeNode): Element[] =>
        (current.children ?? []).flatMap((child) => [
          ...(selector === "*" || matches(child, selector) ? [element(child)] : []),
          ...all(child),
        ]);
      return selector === "*" ? descendants() : all(node);
    },
    querySelector: (selector) => element(node).querySelectorAll(selector)[0] ?? null,
  };
}

function readIdentity(page: FakeNode[], url = "https://x.com/notifications"): IdentitySnapshot {
  const document = element({ children: page });
  const parsed = new URL(url);
  const location = { href: url, pathname: parsed.pathname, search: parsed.search };
  return new Function("document", "location", `return ${identityScript()};`)(document, location) as IdentitySnapshot;
}

const AVATAR = (handle: string): FakeNode => ({ testId: `UserAvatar-Container-${handle}` });
const SIDE_NAV = (children: FakeNode[]): FakeNode => ({ tag: "header", role: "banner", children });

describe("reading who x.com is signed in as", () => {
  it("reads the handle the account switcher spells out", () => {
    const state = readIdentity([
      SIDE_NAV([{ testId: "SideNav_AccountSwitcher_Button", text: "Timur\n@Timur_878", children: [AVATAR("Timur_878")] }]),
    ]);
    expect(state.identity).toMatchObject({ session: true, handle: "Timur_878" });
    expect(state.login_wall).toBe(false);
  });

  it("reads the account of a switcher that renders no handle", () => {
    // A delegated account and a collapsed sidebar both render the switcher as
    // the bare avatar. Reading only the text called both of them signed out.
    const state = readIdentity([
      SIDE_NAV([{ testId: "SideNav_AccountSwitcher_Button", children: [AVATAR("GetDasbrowser")] }]),
    ]);
    expect(state.identity).toMatchObject({ session: true, handle: "GetDasbrowser" });
  });

  it("prefers the avatar over a label that names the other account", () => {
    // On a delegated account the label can name the account that granted the
    // access; the avatar is the account the page is acting as.
    const state = readIdentity([
      SIDE_NAV([{
        testId: "SideNav_AccountSwitcher_Button",
        label: "Account menu, delegated by @Timur_878",
        children: [AVATAR("GetDasbrowser")],
      }]),
    ]);
    expect(state.identity.handle).toBe("GetDasbrowser");
  });

  it("falls back to the sidebar when the switcher is not rendered", () => {
    const state = readIdentity([
      { testId: "SideNav_NewTweet_Button", text: "Post" },
      SIDE_NAV([AVATAR("GetDasbrowser")]),
    ]);
    expect(state.identity).toMatchObject({ session: true, handle: "GetDasbrowser" });
  });

  it("reads the handle out of the profile tab on a narrow window", () => {
    const state = readIdentity([{ tag: "a", testId: "AppTabBar_Profile_Link", href: "/GetDasbrowser" }]);
    expect(state.identity).toMatchObject({ session: true, handle: "GetDasbrowser" });
  });

  it("never takes the account from an avatar in the timeline", () => {
    // Every post carries an avatar test id of its own, and those are strangers.
    const state = readIdentity([{ testId: "primaryColumn", children: [AVATAR("stranger"), { testId: "tweet" }] }]);
    expect(state.identity).toMatchObject({ session: false, handle: "" });
  });

  it("reports a session it cannot name rather than a signed-out profile", () => {
    const state = readIdentity([{ testId: "SideNav_NewTweet_Button", text: "Post" }]);
    expect(state.identity).toMatchObject({ session: true, handle: "" });
  });

  it("reports the sign-in wall as signed out", () => {
    const state = readIdentity([{ tag: "a", href: "/i/flow/login", text: "Sign in" }], "https://x.com/i/flow/login");
    expect(state.login_wall).toBe(true);
    expect(state.identity.session).toBe(false);
  });
});
