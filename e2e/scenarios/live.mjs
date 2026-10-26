import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, createProfile, createWorkspace, deleteCurrentWorkspace, openMainView, profileNames, startProfile, stopProfile, switchWorkspace, waitFor } from "../lib/ui.mjs";
import { openInProfile, pageEval, sleep } from "../lib/ui-workflows.mjs";

// A page with a known heading to click and select through the stream.
const PAGE = "https://example.com/";
const HEADING = `JSON.stringify((() => {
  const h1 = document.querySelector("h1, p");
  if (!h1) return { missing: true, url: location.href };
  const box = h1.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, vw: innerWidth, vh: innerHeight, text: h1.innerText };
})())`;

const main = (page) => page.getByRole("main");
const profileSelect = (page) => main(page).getByRole("combobox", { name: "Choose profile to stream" });

/** Profile names the Live select offers, without its "(stopped)" and toolset decorations. */
async function liveProfiles(page) {
  const labels = await profileSelect(page).locator("option").evaluateAll((options) => options.filter((option) => option.value).map((option) => option.textContent.trim()));
  return labels.map((label) => label
    .replace(/ \(stopped\)$/, "")
    .replace(/ · Multilogin (?:browser|phone)$/, "")
    .replace(/^.+ · \w+ \((.+)\)$/, "$1"));
}

async function stopStream(page) {
  await openMainView(page, "Live");
  const stop = main(page).getByRole("button", { name: "Stop", exact: true });
  if (await stop.isVisible()) await stop.click();
}

/** Where a point of the remote viewport appears on screen, mirroring pointForEvent in LiveView.tsx. */
async function stagePoint(video, target) {
  return video.evaluate((element, point) => {
    const box = element.parentElement.getBoundingClientRect();
    const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
    const width = element.videoWidth * scale;
    const height = element.videoHeight * scale;
    return {
      x: box.left + (box.width - width) / 2 + (point.x / point.vw) * width,
      y: box.top + (box.height - height) / 2 + (point.y / point.vh) * height,
    };
  }, target);
}

/** Size of the current video frame and the spread of its brightness: 0 means a blank frame. */
function frameStats(element) {
  if (!element.videoWidth || element.readyState < 2) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext("2d");
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const light = (pixels[i] * 299 + pixels[i + 1] * 587 + pixels[i + 2] * 114) / 1000;
    min = Math.min(min, light);
    max = Math.max(max, light);
  }
  return { width: element.videoWidth, height: element.videoHeight, contrast: Math.round(max - min) };
}

export default {
  id: "live",
  title: "Live",
  checklist: [
    "Live list of profiles should be only from current workspace",
    "Run a profile. Check if Live works for it",
    "Check if you can click and select text in Live",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const homeProfiles = await profileNames(s.page);
    const workspace = s.name("live");
    const profile = s.name("Live claw");
    const nbcCmd = s.run.env.nbcCmd;
    let created = false;
    s.cleanup(async () => {
      if (!created) return;
      await stopStream(s.page).catch(() => {});
      await switchWorkspace(s.page, workspace).catch(() => {});
      await stopProfile(s.page, profile).catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });

    await s.step("Create a workspace with one Clawbrowser profile", async () => {
      await createWorkspace(s.page, workspace);
      created = true;
      await createProfile(s.page, { name: profile, connection: "none", toolset: "Clawbrowser" });
    });

    await s.step("Live lists only this workspace's profiles", async () => {
      await openMainView(s.page, "Live");
      const listed = await liveProfiles(s.page);
      const sidebarProfiles = await profileNames(s.page);
      const leaked = listed.filter((name) => homeProfiles.includes(name));
      if (leaked.length) throw new Error(`Live offers profiles of «${home}»: ${leaked.join(", ")}`);
      if (listed.slice().sort().join("|") !== sidebarProfiles.slice().sort().join("|")) {
        throw new Error(`Live offers ${listed.join(", ") || "nothing"}; the workspace has ${sidebarProfiles.join(", ")}`);
      }
    });

    await s.step(`Live in «${home}» does not offer the new profile`, async () => {
      await switchWorkspace(s.page, home);
      await openMainView(s.page, "Live");
      const listed = await liveProfiles(s.page);
      try {
        if (listed.includes(profile)) throw new Error(`Live in «${home}» offers «${profile}» from «${workspace}»`);
        const missing = (await profileNames(s.page)).filter((name) => !listed.includes(name));
        if (missing.length) s.note(`Live in «${home}» does not offer ${missing.join(", ")}, which its sidebar lists`);
      } finally {
        await switchWorkspace(s.page, workspace);
      }
    }, { soft: true });

    await s.step("Run the profile", () => startProfile(s.page, profile));

    // The stream shows a page whose heading the next steps click and select.
    const pageOpened = await s.step("Open a known page in the profile (nbc, observation only)", async () => {
      await openInProfile(nbcCmd, profile, PAGE);
      return true;
    }, { soft: true });

    let video;
    await s.step("Live streams the running profile", async () => {
      await openMainView(s.page, "Live");
      const select = profileSelect(s.page);
      const current = await select.evaluate((element) => element.selectedOptions[0]?.textContent.trim() || "");
      if (current !== profile) await select.selectOption({ label: profile });
      const stop = main(s.page).getByRole("button", { name: "Stop", exact: true });
      if (!(await stop.isVisible())) await main(s.page).getByRole("button", { name: /^(Stream|Launch to stream)$/ }).click();
      await waitFor(async () => {
        const failure = main(s.page).locator(".live-error");
        if (await failure.isVisible()) throw new Error(`Live failed: ${(await failure.innerText()).replace(/\s+/g, " ").trim()}`);
        return stop.isVisible();
      }, "the Live stream to connect", 180_000, 1_000);
      video = main(s.page).locator("video.remote-live-video");
      if (!(await video.count())) {
        video = undefined;
        s.note("Live uses the embedded dashboard viewer (no native video), so frames, clicks and selection are not measured");
        return;
      }
      // The known page has dark text on a light background; an unknown one may be blank.
      const contrast = pageOpened ? 40 : -1;
      let stats;
      await waitFor(async () => {
        stats = await video.evaluate(frameStats);
        return stats && stats.contrast > contrast;
      }, "a frame with page content in the Live stage", 60_000, 1_000);
      s.note(`Live frame ${stats.width}×${stats.height}, brightness spread ${stats.contrast}`);
      await s.shot("live stream");
    });

    const reachable = async () => {
      if (!pageOpened) blocked("The known page was not opened in the profile, so the click cannot be located or observed");
      if (!video) blocked("Live has no native video stage to click");
      let target = JSON.parse(String(await pageEval(nbcCmd, profile, HEADING)));
      if (target.missing) {
        // Streaming can bring another tab to the front; show the known page again.
        s.note(`Before the click the profile's active tab was ${target.url}`);
        await openInProfile(nbcCmd, profile, PAGE);
        await sleep(2_000);
        target = JSON.parse(String(await pageEval(nbcCmd, profile, HEADING)));
        if (target.missing) throw new Error(`The known page is not the active tab (${target.url})`);
      }
      return { target, point: await stagePoint(video, target) };
    };

    await s.step("A click in Live reaches the browser", async () => {
      const { point } = await reachable();
      await pageEval(nbcCmd, profile, "(() => { window.__e2eClicks = 0; document.addEventListener('click', () => { window.__e2eClicks += 1; }, true); return 'ready'; })()");
      await s.page.mouse.click(point.x, point.y);
      let clicks = 0;
      await waitFor(async () => {
        clicks = Number(await pageEval(nbcCmd, profile, "String(window.__e2eClicks || 0)"));
        return clicks > 0;
      }, "the click to reach the page", 15_000, 1_000).catch(() => {});
      if (!clicks) throw new Error("A click on the heading in Live did not reach the page in the browser");
    }, { soft: true });

    await s.step("Double-clicking text in Live selects it in the browser", async () => {
      const { target, point } = await reachable();
      await pageEval(nbcCmd, profile, "(() => { getSelection().removeAllRanges(); return 'cleared'; })()");
      await s.page.mouse.dblclick(point.x, point.y);
      let selected = "";
      await waitFor(async () => {
        selected = String(await pageEval(nbcCmd, profile, "window.getSelection().toString()")).trim();
        return selected.length > 0;
      }, "a text selection in the browser", 15_000, 1_000).catch(() => {});
      await sleep(500);
      await s.shot("live selection");
      if (!selected) throw new Error(`Double-clicking «${target.text}» in Live selected nothing in the browser`);
      if (!target.text.includes(selected)) throw new Error(`Live selected «${selected}», which is not in the heading «${target.text}»`);
      s.note(`Live selected «${selected}» in the browser`);
    }, { soft: true });

    await s.step("Stop streaming", async () => {
      await stopStream(s.page);
      await main(s.page).getByRole("button", { name: /^(Stream|Launch to stream)$/ }).waitFor({ timeout: 30_000 });
    }, { soft: true });
  },
};
