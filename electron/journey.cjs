"use strict";
const { randomUUID } = require("node:crypto");
const EVENTS = new Set(["login_succeeded", "agent_action_succeeded"]);

// No properties, offline disk queue, chat text, page data or renderer identity.
// Resolve once so a retry cannot be attributed to a newly signed-in account.
function createJourneyReporter({ allowed, resolveEndpoint, fetchImpl, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  let pending = 0;
  return {
    async report(event) {
      if (!allowed || !EVENTS.has(event) || pending >= 8) return;
      pending++;
      try {
        const { apiKey, baseURL } = await resolveEndpoint();
        if (!apiKey || !baseURL) return;
        const body = JSON.stringify({ event, event_id: randomUUID() });
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const response = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/v1/telemetry/journey`, {
              method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
              body, signal: AbortSignal.timeout(5_000),
            });
            if (response.ok || (response.status < 500 && response.status !== 429)) return;
          } catch { /* best effort; bounded retry with the same event ID */ }
          if (attempt < 2) await wait((attempt + 1) * 1_000);
        }
      } catch { /* analytics never fails the user action */ }
      finally { pending--; }
    },
  };
}
module.exports = { createJourneyReporter };
