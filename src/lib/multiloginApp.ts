import { invoke } from "../electronBridge";

export const MULTILOGIN_DOWNLOAD_URL = "https://multilogin.com/download/";

/**
 * Launches the installed Multilogin desktop app. The main process falls back to the
 * download page when the app is not installed, and so does this when IPC is unavailable.
 */
export async function openMultiloginApp(): Promise<void> {
  try {
    await invoke("multilogin_open_app");
  } catch {
    await invoke("open_external", { url: MULTILOGIN_DOWNLOAD_URL }).catch(() => {
      window.open(MULTILOGIN_DOWNLOAD_URL, "_blank", "noopener,noreferrer");
    });
  }
}
