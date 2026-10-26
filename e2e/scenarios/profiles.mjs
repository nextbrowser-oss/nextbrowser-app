import { exitCountry } from "../lib/oracle.mjs";
import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, createProfile, createWorkspace, deleteCurrentWorkspace, deleteProfile, profileNames, profileStatus, resetUi, startProfile, stopProfile, switchWorkspace, waitFor } from "../lib/ui.mjs";

// The checklist's "PO" is read as Poland (PL) and "Ge" as the ISO code GE
// (Georgia), the code the existing QA profile "Claw GE" uses.
const PROFILES = [
  { suffix: "Claw US", toolset: "Clawbrowser", connection: "managed", country: "US" },
  { suffix: "Claw PL", toolset: "Clawbrowser", connection: "managed", country: "PL" },
  { suffix: "Das direct", toolset: "DasBrowser", connection: "none" },
  { suffix: "Camoufox GE", toolset: "Camoufox", connection: "managed", country: "GE" },
  { suffix: "Multilogin custom", toolset: "Multilogin", connection: "personal" },
];

const TRAFFIC_LIMIT = /traffic (?:limit|is used up|exhausted)|PROXY_TRAFFIC_EXHAUSTED|star .*unlock/i;

export default {
  id: "profiles",
  title: "Profiles",
  checklist: [
    "Create 5 profiles: Clawbrowser proxy USA, Clawbrowser proxy PO, Dasbrowser no proxy, Camoufox proxy Ge, Multilogin custom proxy",
    "Delete the first one (Clawbrowser USA). It should disappear. Refresh page. It should still not be in the workspace",
    "Run them. Check that they are running, and that whoer and verify show the correct country",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const workspace = s.name("profiles");
    s.cleanup(async () => {
      for (const profile of await profileNames(s.page)) await stopProfile(s.page, profile).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });
    await s.step("Create a workspace for this scenario", () => createWorkspace(s.page, workspace));

    const created = [];
    for (const spec of PROFILES) {
      const name = s.name(spec.suffix);
      await s.step(`Create «${spec.suffix}» (${spec.toolset}, ${spec.connection === "none" ? "no proxy" : spec.country || "saved proxy"})`, async () => {
        if (spec.connection === "personal") {
          const saved = s.run.env.manualProxyName;
          if (!saved) blocked("No saved proxy to use as the Multilogin custom proxy (set E2E_MANUAL_PROXY)");
          spec.personalProxy = saved;
        }
        await createProfile(s.page, { name, ...spec });
        created.push({ ...spec, name });
      }, { soft: true });
    }

    const [first, ...rest] = created;
    await s.step("Delete the first profile", async () => {
      if (!first || first.suffix !== "Claw US") blocked("The first profile was not created");
      await deleteProfile(s.page, first.name);
    });
    await s.step("Refresh the window: the deleted profile stays deleted", async () => {
      await s.run.refresh();
      await switchWorkspace(s.page, workspace);
      await waitFor(async () => (await profileNames(s.page)).length >= rest.length, "the profile list to load", 60_000).catch(() => {});
      const names = await profileNames(s.page);
      if (names.includes(first.name)) throw new Error("The deleted profile came back after a refresh");
      const missing = rest.map((profile) => profile.name).filter((name) => !names.includes(name));
      if (missing.length) throw new Error(`Profiles lost after a refresh: ${missing.join(", ")}`);
    });

    for (const profile of rest) {
      await s.step(`Run «${profile.suffix}» and check its exit country`, async () => {
        await resetUi(s.page);
        try {
          await startProfile(s.page, profile.name);
        } catch (error) {
          if (TRAFFIC_LIMIT.test(String(error.message))) blocked(`The QA account has no proxy traffic left: ${error.message}`);
          throw error;
        }
        try {
          const row = await profileStatus(s.page, profile.name);
          s.note(`«${profile.suffix}» row while running: ${row}`);
          await s.shot(`${profile.suffix} running`);
          const exit = await exitCountry(s.run.env.nbcCmd, profile.name, profile.toolset);
          s.note(`«${profile.suffix}» exits from ${exit.ip} (${exit.country})`);
          if (profile.country && exit.country !== profile.country) throw new Error(`Exit country ${exit.country} (${exit.ip}), expected ${profile.country}`);
        } finally {
          await stopProfile(s.page, profile.name);
        }
      }, { soft: true });
    }
  },
};
