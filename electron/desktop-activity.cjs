"use strict";

// Best-effort, bodyless activity signals. Credentials stay in the main process.
function createDesktopActivityReporter({ allowed, resolveEndpoint, fetchImpl, now = Date.now }) {
  let inFlight = false;
  let retryAfter = 0;
  let lastAccountKey;
  let lastSuccessfulMinute;
  return {
    async report() {
      if (!allowed || inFlight || now() < retryAfter) return;
      inFlight = true;
      retryAfter = now() + 5_000;
      try {
        const { apiKey, baseURL } = await resolveEndpoint();
        if (!apiKey || !baseURL) return;
        const minute = Math.floor(now() / 60_000);
        if (lastAccountKey === apiKey && lastSuccessfulMinute === minute) return;
        const response = await fetchImpl(`${baseURL.replace(/\/+$/, "")}/v1/desktop-activity`, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(5_000),
        });
        if (response.ok) {
          lastAccountKey = apiKey;
          lastSuccessfulMinute = minute;
        }
      } catch {
        // Do not queue offline input or affect the user's action.
      } finally {
        inFlight = false;
      }
    },
  };
}

module.exports = { createDesktopActivityReporter };
