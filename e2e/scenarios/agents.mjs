import { blocked } from "../lib/blocked.mjs";
import { exitCountry } from "../lib/oracle.mjs";
import { activeWorkspace, askAgent, createProfile, createWorkspace, deleteCurrentWorkspace, openMainView, profileNames, profileStatus, setChatMode, sidebar, startProfile, stopProfile, switchWorkspace, waitFor } from "../lib/ui.mjs";

// The checklist starts from the 4 profiles left by the Profiles section. The
// Multilogin one needs a connected Multilogin account, so a second
// Clawbrowser profile stands in for it.
const START = [
  { suffix: "Claw PL", toolset: "Clawbrowser", connection: "managed", country: "PL" },
  { suffix: "Das direct", toolset: "DasBrowser", connection: "none" },
  { suffix: "Camoufox GE", toolset: "Camoufox", connection: "managed", country: "GE" },
  { suffix: "Claw DE", toolset: "Clawbrowser", connection: "managed", country: "DE" },
];

const failedReply = (reply) => reply.status !== "done" ? new Error(`The agent's reply ended as «${reply.status}»: ${reply.text.slice(0, 400)}`) : null;

async function agentLabel(page) {
  return (await sidebar(page).getByRole("button", { name: "Open agent settings" }).innerText()).replace(/\s+/g, " ").trim();
}

export default {
  id: "agents",
  title: "Agents",
  checklist: [
    "Ask agent which profiles it sees (should be only these 4)",
    "Ask agent: delete 3 profiles, leave 1",
    "Ask agent: create 3 random profiles with random proxy and 1 with no proxy. Check result",
    "Run 2 of the created profiles. Check with whoer and verify that the proxy countries are correct",
    "Logout from your agent in Nextbrowser settings. Then login back",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const homeProfiles = await profileNames(s.page);
    const workspace = s.name("agents");
    s.cleanup(async () => {
      for (const profile of await profileNames(s.page)) await stopProfile(s.page, profile).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    await s.step("Prepare a workspace with 4 profiles", async () => {
      await createWorkspace(s.page, workspace);
      for (const spec of START) await createProfile(s.page, { ...spec, name: s.name(spec.suffix) });
      await openMainView(s.page, "Project");
      await setChatMode(s.page, "Chat");
      const label = await agentLabel(s.page);
      s.note(`Agent: ${label}`);
      if (!/Connected/i.test(label)) blocked(`No agent is connected (${label})`);
    });
    const names = START.map((spec) => s.name(spec.suffix));

    await s.step("The agent sees exactly the workspace's 4 profiles", async () => {
      const reply = await askAgent(s.page, "Which browser profiles can you see in this workspace? Answer with their exact names, one per line, and nothing else.");
      const failure = failedReply(reply);
      if (failure) throw failure;
      s.note(`Reply: ${reply.text.replace(/\s+/g, " ").slice(0, 400)}`);
      const missing = names.filter((name) => !reply.text.includes(name));
      const foreign = homeProfiles.filter((name) => reply.text.split(/\n/).some((line) => line.trim() === name));
      if (missing.length) throw new Error(`The agent did not list: ${missing.join(", ")}`);
      if (foreign.length) throw new Error(`The agent listed profiles from another workspace: ${foreign.join(", ")}`);
    });

    const [keep, ...remove] = names;
    await s.step("The agent deletes 3 profiles and leaves 1", async () => {
      const reply = await askAgent(s.page, `Delete these 3 browser profiles: ${remove.join(", ")}. Keep ${keep}. Do not touch any other profile.`);
      const failure = failedReply(reply);
      if (failure) throw failure;
      await waitFor(async () => {
        const left = await profileNames(s.page);
        return left.length === 1 && left[0] === keep;
      }, "the sidebar to show only the kept profile", 120_000);
    });

    const created = ["R1", "R2", "R3", "R4"].map((suffix) => s.name(suffix));
    await s.step("The agent creates 3 profiles with random proxies and 1 without", async () => {
      const reply = await askAgent(s.page, [
        "Create 4 Clawbrowser browser profiles in this workspace.",
        `${created[0]}, ${created[1]} and ${created[2]}: each with a managed proxy in a different random country.`,
        `${created[3]}: no proxy.`,
        "Do not start them. Reply with each name and its proxy country.",
      ].join(" "));
      const failure = failedReply(reply);
      if (failure) throw failure;
      await waitFor(async () => {
        const listed = await profileNames(s.page);
        return created.every((name) => listed.includes(name));
      }, "the 4 new profiles in the sidebar", 120_000);
      for (const name of created) s.note(`${name}: ${await profileStatus(s.page, name)}`);
      const countries = await Promise.all(created.slice(0, 3).map(async (name) => (await profileStatus(s.page, name)).match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/)?.[1] || ""));
      if (countries.some((code) => !code)) throw new Error(`A proxy profile has no country: ${countries.join(", ")}`);
      if (new Set(countries).size !== 3) throw new Error(`The proxy countries are not all different: ${countries.join(", ")}`);
      const direct = await profileStatus(s.page, created[3]);
      if (/\b[A-Z]{2}\b\s*$/.test(direct)) throw new Error(`The no-proxy profile shows a country: ${direct}`);
    });

    for (const name of created.slice(0, 2)) {
      await s.step(`Run «${name.split(" ").pop()}» and check its exit country`, async () => {
        const expected = (await profileStatus(s.page, name)).match(/\b([A-Z]{2})\b(?!.*\b[A-Z]{2}\b)/)?.[1];
        await startProfile(s.page, name);
        try {
          const exit = await exitCountry(s.run.env.nbcCmd, name, "Clawbrowser");
          s.note(`${name} exits from ${exit.ip} (${exit.country}), configured ${expected}`);
          if (exit.country !== expected) throw new Error(`Exit country ${exit.country} (${exit.ip}), expected ${expected}`);
        } finally {
          await stopProfile(s.page, name);
        }
      }, { soft: true });
    }

    await s.step("Sign the agent out in Settings and back in", async () => {
      // Signing back in opens the agent's own browser sign-in, which needs a person.
      if (!process.env.E2E_AGENT_RELOGIN) blocked("Signing the agent back in needs a person to finish its browser sign-in (set E2E_AGENT_RELOGIN=1 and be at the machine)");
      await sidebar(s.page).getByRole("button", { name: "Open agent settings" }).click();
      const signOut = s.page.getByRole("button", { name: /Sign out|Log out|Disconnect/i }).first();
      await signOut.click();
      await waitFor(async () => !/Connected/i.test(await agentLabel(s.page)), "the agent to show as signed out", 60_000);
      await s.page.getByRole("button", { name: /Sign in|Log in|Connect/i }).first().click();
      await waitFor(async () => /Connected/i.test(await agentLabel(s.page)), "the agent to be connected again (finish the sign-in in the browser)", 600_000, 3_000);
    });
  },
};
