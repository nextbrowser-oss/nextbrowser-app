"use strict";

function createDeviceSessions({ resolveEndpoint, installId, name, platform, fetchImpl, now = Date.now }) {
  let tail = Promise.resolve();
  let lastKey, nextContact = 0;
  // A heartbeat already in flight must finish before this device signs out.
  function queue(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  async function request(endpoint, method) {
    const id = installId();
    const url = endpoint.baseURL.replace(/\/+$/, "") + "/v1/device-sessions" + (method === "GET" ? "" : "/" + encodeURIComponent(id));
    const response = await fetchImpl(url, {
      method, redirect: "error", signal: AbortSignal.timeout(5000),
      headers: { authorization: "Bearer " + endpoint.apiKey, ...(method === "PUT" && { "content-type": "application/json" }) },
      body: method === "PUT" ? JSON.stringify({ name: name().slice(0, 128) || platform, platform }) : undefined,
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("Device sessions are not available on this server yet.");
      if (response.status === 401) throw new Error("Sign in again to view device sessions.");
      throw new Error("Could not load device sessions. Please try again.");
    }
    if (method === "GET") return response.json();
  }
  async function contact(endpoint) {
    if (lastKey === endpoint.apiKey && now() < nextContact) return;
    await request(endpoint, "PUT");
    lastKey = endpoint.apiKey;
    nextContact = now() + 4 * 60_000;
  }
  return {
    heartbeat: () => queue(async () => {
      const endpoint = await resolveEndpoint();
      if (endpoint.apiKey) await contact(endpoint);
    }).catch(() => {}),
    list: () => queue(async () => {
      const endpoint = await resolveEndpoint();
      if (!endpoint.apiKey) throw new Error("Sign in to view device sessions.");
      await contact(endpoint);
      return { current: installId(), sessions: await request(endpoint, "GET") };
    }),
    logout: clearCredential => queue(async () => {
      try {
        const endpoint = await resolveEndpoint();
        if (endpoint.apiKey) await request(endpoint, "DELETE");
      } catch { /* Offline devices must still be able to sign out locally. */ }
      lastKey = undefined;
      nextContact = 0;
      await clearCredential();
    }),
  };
}

module.exports = { createDeviceSessions };
