import { describe, expect, it } from "vitest";
import {
  bellScript,
  feedPillScript,
  identityScript,
  inspectScript,
  notificationsScript,
  pageHealthScript,
  timelineScript,
  verifyScript,
  type IdentitySnapshot,
} from "./scripts";

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
  /** A contenteditable element, which is what marks the composer's editor. */
  editable?: boolean;
  children?: FakeNode[];
}

interface Element {
  tagName: string;
  getAttribute(name: string): string | null;
  innerText: string;
  parentElement: Element | null;
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): Element[];
}

function attribute(node: FakeNode, name: string): string | null {
  if (name === "data-testid") return node.testId ?? null;
  if (name === "aria-label") return node.label ?? null;
  if (name === "href") return node.href ?? null;
  if (name === "role") return node.role ?? null;
  if (name === "contenteditable") return node.editable ? "true" : null;
  return null;
}

/** matches understands the shapes the scripts actually ask for: an optional tag
 *  and one or more exact or prefix attribute tests. */
function matches(node: FakeNode, selector: string): boolean {
  return selector.split(",").some((part) => {
    const one = part.trim();
    const shape = /^([a-z]*)((?:\[[a-z-]+\^?="[^"]*"\])+)$/.exec(one);
    if (!shape) return false;
    const [, tag, tests] = shape;
    if (tag && (node.tag ?? "div") !== tag) return false;
    return [...tests.matchAll(/\[([a-z-]+)(\^?)="([^"]*)"\]/g)].every(([, name, prefix, value]) => {
      const actual = attribute(node, name);
      if (actual === null) return false;
      return prefix ? actual.startsWith(value) : actual === value;
    });
  });
}

/** parents lets an element climb back up, which is how the identity script
 *  finds the composer's own row. */
const parents = new WeakMap<FakeNode, FakeNode>();
function link(node: FakeNode): void {
  for (const child of node.children ?? []) {
    parents.set(child, node);
    link(child);
  }
}

function element(node: FakeNode): Element {
  const all = (current: FakeNode, selector: string): Element[] =>
    (current.children ?? []).flatMap((child) => [
      ...(selector === "*" || matches(child, selector) ? [element(child)] : []),
      ...all(child, selector),
    ]);
  return {
    tagName: (node.tag ?? "div").toUpperCase(),
    getAttribute: (name) => attribute(node, name),
    innerText: node.text ?? "",
    get parentElement() {
      const parent = parents.get(node);
      return parent ? element(parent) : null;
    },
    querySelectorAll: (selector) => all(node, selector),
    querySelector: (selector) => all(node, selector)[0] ?? null,
  };
}

function readIdentity(page: FakeNode[], url = "https://x.com/notifications"): IdentitySnapshot {
  const root: FakeNode = { children: page };
  link(root);
  const document = element(root);
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

  it("reads the acting account from the reply composer when there is no side navigation", () => {
    // A post page in a narrow window draws no side navigation at all, but the
    // composer shows the acting account's avatar beside its text box. The post
    // above it carries the author's avatar, and that one is never taken.
    const state = readIdentity([
      { testId: "cellInnerDiv", children: [{ tag: "article", testId: "tweet", children: [AVATAR("author")] }] },
      { testId: "cellInnerDiv", children: [{ children: [
        { children: [AVATAR("GetDasbrowser")] },
        { children: [{ testId: "tweetTextarea_0", editable: true }] },
      ] }] },
    ], "https://x.com/author/status/1");
    expect(state.identity).toMatchObject({ session: true, handle: "GetDasbrowser" });
  });

  it("takes no account from a composer whose only avatar belongs to the post being answered", () => {
    // The reply dialog draws the parent post above the composer. An avatar
    // inside a post is the author's, and without one of its own the composer
    // names nobody — an unnamed account is refused, never guessed.
    const state = readIdentity([
      { role: "dialog", children: [
        { tag: "article", testId: "tweet", children: [AVATAR("author")] },
        { children: [{ testId: "tweetTextarea_0", editable: true }] },
      ] },
    ], "https://x.com/author/status/1");
    expect(state.identity).toMatchObject({ session: false, handle: "" });
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

describe("every page script", () => {
  // The scripts are built from string fragments that share helpers. A helper
  // declared twice, or a fragment left out, is a syntax error that only x.com
  // would ever report — so each one is parsed here as the browser would.
  const scripts: Record<string, string> = {
    identity: identityScript(),
    health: pageHealthScript(),
    inspect: inspectScript("1899000000000000000", "a reply", "me"),
    bell: bellScript(),
    timeline: timelineScript(5),
    notifications: notificationsScript(5),
    verify: verifyScript("a reply", "me"),
    feedPill: feedPillScript(),
  };
  for (const [name, code] of Object.entries(scripts)) {
    it(`${name} is valid JavaScript`, () => {
      expect(() => new Function(`return ${code};`)).not.toThrow();
    });
  }
});
