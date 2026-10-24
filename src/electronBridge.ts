import type { RendererErrorReport } from "./lib/errorReporting";

export interface NextbrowserBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  filePathForFile?(file: File): string;
  on(channel: string, listener: (payload: unknown) => void): () => void;
  // Optional: older preload scripts and browser previews have no reporter.
  reportError?(event: RendererErrorReport): void;
  breadcrumb?(crumb: { category: "navigation" | "ui"; message: string }): void;
}

declare global {
  interface Window { nextbrowser?: NextbrowserBridge; }
}

export function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!window.nextbrowser) return Promise.reject(new Error("Electron bridge is unavailable."));
  return window.nextbrowser.invoke<T>(command, args).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const safety = message.match(/PROXY_(?:CONNECTION_LOST|WORK_PAUSED):\s*(.*)/s);
    if (safety) throw new Error(safety[1]);
    throw error;
  });
}

export function filePathForFile(file: File): string {
  return window.nextbrowser?.filePathForFile?.(file) ?? "";
}

export async function listen<T>(channel: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  if (!window.nextbrowser) throw new Error("Electron bridge is unavailable.");
  return window.nextbrowser.on(channel, (payload) => callback({ payload: payload as T }));
}
