// Structured status takes precedence over incidental words such as "email".
function agentLoginStatus({ code, stdout = "", stderr = "" }) {
  try {
    const status = JSON.parse(stdout);
    if (typeof status.loggedIn === "boolean") return status.loggedIn;
    if (typeof status.logged_in === "boolean") return status.logged_in;
    if (typeof status.authenticated === "boolean") return status.authenticated;
  } catch { /* Older agents emit plain text. */ }
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (/not logged in|logged out|please (?:run|log in|sign in)|not authenticated|unauthorized|invalid (?:api key|token)|token (?:has )?expired/.test(text)) return false;
  if (code !== 0) return null;
  if (/logged in|authenticated|api.?key/.test(text)) return true;
  return null;
}
module.exports = { agentLoginStatus };
