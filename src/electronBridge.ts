export interface NextBrowserBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  filePathForFile?(file: File): string;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

declare global {
  interface Window { nextbrowser?: NextBrowserBridge; }
}

export function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!window.nextbrowser) return Promise.reject(new Error("Electron bridge is unavailable."));
  return window.nextbrowser.invoke<T>(command, args);
}

export function filePathForFile(file: File): string {
  return window.nextbrowser?.filePathForFile?.(file) ?? "";
}

export async function listen<T>(channel: string, callback: (event: { payload: T }) => void): Promise<() => void> {
  if (!window.nextbrowser) throw new Error("Electron bridge is unavailable.");
  return window.nextbrowser.on(channel, (payload) => callback({ payload: payload as T }));
}
