import { blocked } from "../lib/blocked.mjs";
import { activeWorkspace, askAgent, createWorkspace, deleteCurrentWorkspace, openMainView, setChatMode, switchWorkspace, waitFor } from "../lib/ui.mjs";

const SCREEN = '(() => { const rows = document.querySelector(".xterm-rows"); return rows ? rows.innerText : ""; })()';
// Claude Code's first-run screens; a person answers them once per machine.
const FIRST_RUN = /Choose the text style|Is this a project you created or one you trust|Try the new fullscreen renderer|Select login method/;

async function terminalScreen(page) {
  return page.evaluate(SCREEN);
}

/** Types one prompt into the agent terminal and waits until the agent is idle again. */
async function tellTerminal(page, text, { timeoutMs = 300_000 } = {}) {
  await page.locator(".xterm-screen").click();
  const before = await terminalScreen(page);
  if (FIRST_RUN.test(before)) blocked("The agent's terminal shows its first-run setup (theme, folder trust, sign-in); a person answers it once on this machine");
  await page.keyboard.type(text, { delay: 15 });
  await page.keyboard.press("Enter");
  let quiet = 0;
  await waitFor(async () => {
    const screen = await terminalScreen(page);
    const after = screen.slice(screen.lastIndexOf(text) + text.length);
    const working = /esc to interrupt/i.test(screen);
    quiet = !working && screen.includes(text) && /⏺|●/.test(after) ? quiet + 1 : 0;
    return quiet >= 3;
  }, "the terminal agent to answer", timeoutMs, 1_500);
  const screen = await terminalScreen(page);
  return screen.slice(screen.lastIndexOf(text) + text.length).trim();
}

const remembers = (reply, food) => new RegExp(`(do(?:n'?t| not)|dislike|не любит|не люби)[^.]{0,40}${food}|${food}[^.]{0,60}(dislike|do(?:n'?t| not) like|не любит)`, "i").test(reply);

export default {
  id: "terminal",
  title: "Terminal",
  checklist: [
    "Say in terminal chat for agent: \"I don't like soup\". Switch to chat agent and ask \"Do I like a soup? Am I mentioned it before?\" - response should reflect that context switched",
    "Say in terminal chat for agent: \"I don't like borsh\". Switch to chat agent and ask \"Do I like a borsh?\" - response should reflect that context switched",
  ],
  async run(s) {
    const home = await activeWorkspace(s.page);
    const workspace = s.name("terminal");
    s.cleanup(async () => {
      await setChatMode(s.page, "Chat").catch(() => {});
      if ((await activeWorkspace(s.page)) === workspace) await deleteCurrentWorkspace(s.page);
      await switchWorkspace(s.page, home);
    });
    await s.step("Open a new chat in Terminal mode", async () => {
      await createWorkspace(s.page, workspace);
      await openMainView(s.page, "Project");
      await setChatMode(s.page, "Terminal");
      await waitFor(async () => (await terminalScreen(s.page)).trim().length > 0, "the agent terminal to start", 120_000);
      await waitFor(async () => /❯|>/.test(await terminalScreen(s.page)), "the terminal prompt", 120_000);
    });

    // The first pair runs before the chat has any message: the terminal's
    // context must reach a brand-new chat too. By the second pair the chat
    // exists, which is the case the checklist usually exercises.
    for (const [food, question] of [["soup", "Do I like soup? Have I mentioned it before?"], ["borsch", "Do I like borsch?"]]) {
      await s.step(`Tell the terminal agent «I don't like ${food}»`, async () => {
        await setChatMode(s.page, "Terminal");
        const reply = await tellTerminal(s.page, `I don't like ${food}`);
        s.note(`Terminal after «I don't like ${food}»: ${reply.replace(/\s+/g, " ").slice(0, 300)}`);
      });
      await s.step(`Chat knows about the ${food} after switching from Terminal`, async () => {
        await setChatMode(s.page, "Chat");
        const reply = await askAgent(s.page, question);
        s.note(`Chat: ${reply.text.replace(/\s+/g, " ").slice(0, 400)}`);
        if (reply.status !== "done") throw new Error(`The chat reply ended as «${reply.status}»: ${reply.text.slice(0, 300)}`);
        if (!remembers(reply.text, food)) throw new Error(`The chat does not know the user dislikes ${food}: ${reply.text.slice(0, 300)}`);
      }, { soft: true });
    }
  },
};
