import { waitFor } from "../lib/ui.mjs";
import { documentTheme, pause, textContrast, themeToggle } from "../lib/ui-settings.mjs";

// WCAG AA for normal text.
const MIN_CONTRAST = 4.5;
// Text a user reads: the page's own text colour, view headings, the chat
// title and the sidebar's workspace, project and profile names. Muted text
// is reported, not judged: it is secondary by design.
const PRIMARY_TEXT = ["body", "main h2", "main .chat-title", "aside .workspace-picker strong", "aside .workspace-chat-copy strong", "aside .profile-name"];
const MUTED_TEXT = ["aside .muted", "main .muted"];

const other = (theme) => (theme === "dark" ? "light" : "dark");

export default {
  id: "theme",
  title: "Theme",
  checklist: ["Switch theme. Check if it looks good"],
  async run(s) {
    const start = await s.step("Read the current theme", async () => {
      const theme = await documentTheme(s.page);
      if (!["dark", "light"].includes(theme)) throw new Error(`<html data-theme> is «${theme}», expected dark or light`);
      const label = await themeToggle(s.page).getAttribute("aria-label");
      if (label !== `Switch to ${other(theme)} theme`) throw new Error(`The window is ${theme} but the toggle offers «${label}»`);
      return theme;
    });
    s.cleanup(async () => {
      if (start && (await documentTheme(s.page)) !== start) await themeToggle(s.page).click();
    });

    const check = async (theme) => {
      await s.shot(`${theme} theme`);
      const results = await textContrast(s.page, [...PRIMARY_TEXT, ...MUTED_TEXT]);
      const describe = (result) => `${result.selector}${result.text ? ` «${result.text}»` : ""} ${result.color} on ${result.background}: ${result.ratio}`;
      const measured = results.filter((result) => !result.missing);
      s.note(`${theme}: ${measured.map(describe).join("; ")}`);
      const low = measured.filter((result) => PRIMARY_TEXT.includes(result.selector) && result.ratio < MIN_CONTRAST);
      if (!measured.some((result) => result.selector === "body")) throw new Error("The page's text colour could not be read");
      if (low.length) throw new Error(`Text below ${MIN_CONTRAST}:1 in the ${theme} theme: ${low.map(describe).join("; ")}`);
    };

    await s.step(`The ${start ?? "current"} theme is readable`, () => check(start), { soft: true });

    await s.step(`Switch to the ${other(start)} theme`, async () => {
      await themeToggle(s.page).click();
      await waitFor(async () => (await documentTheme(s.page)) === other(start), `the window to turn ${other(start)}`, 5_000, 100);
      const label = await themeToggle(s.page).getAttribute("aria-label");
      if (label !== `Switch to ${start} theme`) throw new Error(`After switching, the toggle offers «${label}»`);
      // Colours fade over a short transition.
      await pause(500);
    });

    await s.step(`The ${other(start)} theme is readable`, () => check(other(start)), { soft: true });

    await s.step(`Switch back to the ${start} theme`, async () => {
      await themeToggle(s.page).click();
      await waitFor(async () => (await documentTheme(s.page)) === start, `the window to turn ${start} again`, 5_000, 100);
    });
  },
};
