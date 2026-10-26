import { blocked } from "../lib/blocked.mjs";
import { waitFor } from "../lib/ui.mjs";
import { lineTime, logLines, pause } from "../lib/ui-settings.mjs";

// Where the feedback goes. The app posts it to
// core.nextbrowser.com/signal-router/v1/feedback (submitFeedback in
// electron/project-sync.cjs) with an id "desktop-feedback:<uuid>"; that
// service, not nextbrowser-backend, forwards it to Slack. nextbrowser-backend
// has no feedback route: its Slack code (internal/provider/slack.go) only
// announces the website's support form and logs "support request
// notification sent" or "… failed" (internal/service/support.go).
// E2E_FEEDBACK_LOG_CMD may name a command that prints the feedback
// service's log, with the same contract as E2E_REPORTS_CMD; without it the
// backend log of E2E_REPORTS_CMD is searched.
const FEEDBACK_LINE = /desktop-feedback|feedback/i;
const SLACK_LINE = /slack|webhook/i;
const LOG_WAIT_MS = 90_000;

const form = (page) => page.getByRole("dialog", { name: "How is Nextbrowser?" });
const clip = (line) => line.trim().slice(0, 300);

export default {
  id: "feedback",
  title: "Feedback",
  checklist: ["Send feedback. Check if Slack gets your message."],
  async run(s) {
    const message = `e2e ${s.run.runId} feedback check — please ignore`;
    s.cleanup(async () => {
      const close = form(s.page).getByRole("button", { name: "Close feedback" });
      if (await close.isVisible().catch(() => false)) await close.click();
    });

    await s.step("Open the feedback form", async () => {
      // FeedbackButton (App.tsx) shows only while the app is signed in.
      const button = s.page.getByRole("button", { name: /^Send feedback\./ });
      if (!(await button.isVisible().catch(() => false))) blocked("The Feedback button is hidden: the app shows it only to a signed-in account");
      await button.click();
      await form(s.page).waitFor({ timeout: 10_000 });
    });

    await s.step("Rate the app and write the note", async () => {
      const dialog = form(s.page);
      await dialog.getByRole("radio", { name: "5: Excellent" }).click();
      await dialog.getByPlaceholder("What worked well, or what should we improve?").fill(message);
      await dialog.getByText("5/5 · Excellent").waitFor({ timeout: 5_000 });
      await dialog.getByText(`${message.length} / 2000`).waitFor({ timeout: 5_000 });
      if (await dialog.getByRole("button", { name: "Send feedback", exact: true }).isDisabled()) throw new Error("«Send feedback» stays disabled after rating");
    });

    // Sending also marks feedback as given, so the app will not ask for it
    // again for a while (markFeedbackSubmitted in src/lib/feedbackPrompt.ts).
    const sentAt = await s.step("Send it: the form confirms", async () => {
      const dialog = form(s.page);
      const sentAt = new Date(Date.now() - 5_000).toISOString();
      await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
      const thanks = dialog.getByRole("status").filter({ hasText: "Thank you — your feedback was sent." });
      const error = dialog.getByRole("alert");
      await waitFor(async () => (await thanks.isVisible().catch(() => false)) || (await error.isVisible().catch(() => false)), "the form to answer", 30_000, 250);
      if (await error.isVisible().catch(() => false)) throw new Error(`The form says: ${(await error.innerText()).trim()}`);
      await s.shot("feedback sent");
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
      await dialog.waitFor({ state: "detached", timeout: 5_000 });
      return sentAt;
    });

    await s.step("The feedback service logged it, and what it did with Slack", async () => {
      const dedicated = process.env.E2E_FEEDBACK_LOG_CMD || "";
      const command = dedicated || s.run.env.reportsCmd;
      if (!command) blocked("No log to read: set E2E_FEEDBACK_LOG_CMD (the feedback service) or E2E_REPORTS_CMD (the backend)");
      const since = Date.parse(sentAt);
      const recent = (lines) => lines.filter((line) => {
        const at = lineTime(line);
        return Number.isNaN(at) || at >= since;
      });
      let lines = [];
      let received = [];
      const deadline = Date.now() + LOG_WAIT_MS;
      while (Date.now() < deadline) {
        lines = recent(await logLines(command, sentAt));
        // An error report about the form (backend-reports.mjs) is not the feedback itself.
        received = lines.filter((line) => (FEEDBACK_LINE.test(line) || line.includes(s.run.runId)) && !line.includes('"client_error"'));
        if (received.length) break;
        await pause(10_000);
      }
      const slack = lines.filter((line) => SLACK_LINE.test(line));
      s.note(`Log read with ${dedicated ? "E2E_FEEDBACK_LOG_CMD" : "E2E_REPORTS_CMD"}: ${lines.length} lines since ${sentAt}.`);
      if (received.length) s.note(`Feedback in the log: ${received.slice(0, 3).map(clip).join(" | ")}`);
      s.note(`Slack forwarding: ${slack.length ? slack.slice(0, 3).map(clip).join(" | ") : "the log says nothing about Slack"}`);
      if (received.length) return;
      if (dedicated) throw new Error(`The feedback service logged no feedback request in ${Math.round(LOG_WAIT_MS / 1000)} s after ${sentAt}`);
      blocked("The backend log has no feedback line, as expected: desktop feedback goes to core.nextbrowser.com/signal-router, not to nextbrowser-backend. Set E2E_FEEDBACK_LOG_CMD to read that service's log");
    }, { soft: true });
  },
};
