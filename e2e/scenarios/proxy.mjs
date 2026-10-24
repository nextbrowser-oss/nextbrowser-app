import { blocked } from "../lib/blocked.mjs";
import { exitCountry } from "../lib/oracle.mjs";
import { activeWorkspace, createProfile, createWorkspace, deleteCurrentWorkspace, sidebar, startProfile, stopProfile, switchWorkspace } from "../lib/ui.mjs";

async function openProxies(page) {
  await sidebar(page).getByRole("button", { name: /^Create proxy/ }).click();
  await page.getByText("Personal proxies").first().waitFor();
}

async function closeProxies(page) {
  const close = page.locator(".modal-overlay").getByRole("button", { name: "Close", exact: true }).first();
  if (await close.isVisible().catch(() => false)) await close.click();
}

/** Tests a saved proxy from its row and returns what the test reported. */
async function testProxy(page, name) {
  await page.getByRole("button", { name: `Test ${name}`, exact: true }).click();
  const result = page.locator(".personal-proxy-test-ok, .personal-proxy-test-error").first();
  await result.waitFor({ timeout: 90_000 });
  const text = (await result.innerText()).replace(/\s+/g, " ").trim();
  if (await result.evaluate((el) => el.classList.contains("personal-proxy-test-error"))) throw new Error(`The proxy test failed: ${text}`);
  return text;
}

export default {
  id: "proxy",
  title: "Proxy",
  checklist: [
    "Create manually proxy",
    "Assign manual proxy to profile",
    "Run profile. Check if proxy country is correct",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const workspace = s.name("proxy");
    const created = s.name("proxy");
    let proxyName = s.run.env.manualProxyName;
    let expected = process.env.E2E_MANUAL_PROXY_COUNTRY || "";
    let testedIp = "";
    let madeProxy = false;
    s.cleanup(async () => {
      await stopProfile(s.page, s.name("manual proxy")).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
      if (!madeProxy) return;
      await openProxies(s.page);
      await s.page.getByRole("button", { name: `Delete ${created}`, exact: true }).click();
      const confirm = s.page.getByRole("button", { name: /^(Delete|Confirm)/ }).last();
      if (await confirm.isVisible().catch(() => false)) await confirm.click();
      await closeProxies(s.page);
    });

    await s.step("Create a proxy by hand", async () => {
      if (!s.run.env.manualProxy) blocked("No proxy to enter by hand (set E2E_MANUAL_PROXY=scheme://user:pass@host:port)");
      await openProxies(s.page);
      await s.page.locator(".modal-overlay").getByRole("button", { name: "Create proxy", exact: true }).click();
      await s.page.getByPlaceholder(/user:pass@host/).fill(s.run.env.manualProxy);
      await s.page.getByRole("textbox", { name: /^Name/ }).first().fill(created);
      await s.page.locator(".modal-overlay").getByRole("button", { name: /^(Create proxy|Save)/ }).last().click();
      await s.page.getByRole("button", { name: `Test ${created}`, exact: true }).waitFor({ timeout: 60_000 });
      madeProxy = true;
      proxyName = created;
    }, { soft: true });

    await s.step("Test the proxy from its row", async () => {
      if (!proxyName) blocked("No saved proxy to test (set E2E_MANUAL_PROXY or E2E_MANUAL_PROXY_NAME)");
      await openProxies(s.page);
      const result = await testProxy(s.page, proxyName);
      s.note(`Test of «${proxyName}»: ${result}`);
      expected ||= result.match(/\b([A-Z]{2})\b/)?.[1] || "";
      testedIp = result.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/)?.[1] || "";
      await closeProxies(s.page);
    });

    const profile = s.name("manual proxy");
    await s.step("Assign the proxy to a new profile", async () => {
      await createWorkspace(s.page, workspace);
      await createProfile(s.page, { name: profile, toolset: "Clawbrowser", connection: "personal", personalProxy: proxyName });
    });

    await s.step("Run the profile: its exit country is the proxy's", async () => {
      await startProfile(s.page, profile);
      try {
        const exit = await exitCountry(s.run.env.nbcCmd, profile, "Clawbrowser");
        s.note(`«${profile}» exits from ${exit.ip} (${exit.country}); the proxy test said ${expected || "no country"}`);
        if (expected && exit.country !== expected) throw new Error(`Exit country ${exit.country} (${exit.ip}), the proxy is in ${expected}`);
        // The test shows the proxy's IP, not its country: a rotating proxy may change IP, so a mismatch is a note.
        if (testedIp && exit.ip !== testedIp) s.note(`The browser's IP ${exit.ip} differs from the tested ${testedIp}`);
        if (!expected && !testedIp) throw new Error("Neither a country nor an IP to compare the browser's exit with");
      } finally {
        await stopProfile(s.page, profile);
      }
    });
  },
};
