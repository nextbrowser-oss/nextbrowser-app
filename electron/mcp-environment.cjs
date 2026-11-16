// Only explicit server credentials and the OS/runtime environment cross into
// third-party MCP processes. Provider and browser-control secrets stay here.
function serverEnvironment(base, extra = {}) {
  const keep = /^(?:path|pathext|systemroot|windir|comspec|home|userprofile|appdata|localappdata|temp|tmp|lang|lc_all|http_proxy|https_proxy|all_proxy|no_proxy)$/i;
  return { ...Object.fromEntries(Object.entries(base).filter(([key]) => keep.test(key))), ...extra };
}
module.exports = { serverEnvironment };
