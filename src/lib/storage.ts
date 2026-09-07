import { invoke } from "../electronBridge";

export async function readAppData(name: string): Promise<string | null> {
  try {
    return (await invoke<Option<string>>("app_data_read", { name })) ?? null;
  } catch {
    return localStorage.getItem(`clawdesk.${name}`);
  }
}

export async function writeAppData(name: string, content: string): Promise<void> {
  try {
    await invoke("app_data_write", { name, content });
  } catch {
    localStorage.setItem(`clawdesk.${name}`, content);
  }
}

export async function loadJson<T>(name: string, fallback: T): Promise<T> {
  const raw = await readAppData(name);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function saveJson(name: string, value: unknown): Promise<void> {
  await writeAppData(name, JSON.stringify(value, null, 2));
}

type Option<T> = T | null;

/** appendAppData adds to a file under the app's data directory, which is how
 *  a log grows without rewriting itself. The main process bounds the file. A
 *  line the app could not keep is dropped: a log must never fail the work. */
export async function appendAppData(name: string, content: string): Promise<void> {
  try {
    await invoke("app_data_append", { name, content });
  } catch {
    /* nothing to fall back to: localStorage is no place for a growing log */
  }
}
