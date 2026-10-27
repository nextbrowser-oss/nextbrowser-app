import { invoke } from "../electronBridge";
import { isProxyPathFailure, VPN_SYSTEM_PROXY_HINT } from "./userFacingBrowserError";

export interface SystemProxyStatus {
  /** The system proxy runs on this computer: a VPN app in system-proxy mode. */
  loopback?: boolean;
}

/**
 * The hint for a failed profile start, or "": only when the start failed the
 * way a blocked path to the profile's proxy fails and the main process sees a
 * system proxy on this computer. Any failure to ask means no hint.
 */
export async function vpnSystemProxyHint(
  detail: unknown,
  status: () => Promise<SystemProxyStatus> = () => invoke<SystemProxyStatus>("system_proxy_status"),
): Promise<string> {
  if (!isProxyPathFailure(detail)) return "";
  try {
    return (await status())?.loopback === true ? VPN_SYSTEM_PROXY_HINT : "";
  } catch {
    return "";
  }
}
