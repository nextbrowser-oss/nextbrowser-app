const net = require("node:net");

function isLoopbackProxyHost(value) {
  const host = String(value || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host === "::1") return true;
  const address = net.isIP(host);
  return (address === 4 && /^127(?:\.\d{1,3}){3}$/.test(host))
    || (address === 6 && /^::ffff:127(?:\.\d{1,3}){3}$/i.test(host));
}

function assertManualProxyRuntimeSupport(runtime, proxy) {
  if (runtime === "clawbrowser" && isLoopbackProxyHost(proxy?.host)) {
    throw new Error("[LOCAL_PROXY_UNSUPPORTED] This proxy runs on this computer. ClawBrowser cannot use local proxy ports yet because its fingerprint service runs remotely. Create the profile with Camoufox or DasBrowser instead.");
  }
}

module.exports = { assertManualProxyRuntimeSupport, isLoopbackProxyHost };
