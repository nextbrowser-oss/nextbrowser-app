export type MultiloginProfileKind = "browser" | "mobile";

export interface MultiloginProfileSelection {
  kind: MultiloginProfileKind;
  id: string;
  name: string;
  folderId?: string;
}

export const MULTILOGIN_SELECTION_EVENT = "nextbrowser:multilogin-selection";
const MULTILOGIN_SELECTION_PREFIX = "nextbrowser.multilogin.selection.";

function clean(value: unknown, maxLength = 200): string {
  return typeof value === "string"
    ? value.replace(/[\r\n]+/g, " ").trim().slice(0, maxLength)
    : "";
}

function storageKey(workspaceId: string): string {
  return `${MULTILOGIN_SELECTION_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function browserStorage(): Storage | undefined {
  if (typeof window !== "undefined") return window.localStorage;
  if (typeof localStorage !== "undefined") return localStorage;
  return undefined;
}

function notify(workspaceId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(MULTILOGIN_SELECTION_EVENT, { detail: { workspaceId } }));
}

export function multiloginSelectionForWorkspace(
  workspaceId?: string,
  storage: Storage | undefined = browserStorage(),
): MultiloginProfileSelection | undefined {
  if (!workspaceId || !storage) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(storageKey(workspaceId)) || "null");
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const candidate = parsed as Record<string, unknown>;
  const kind = candidate.kind === "browser" || candidate.kind === "mobile" ? candidate.kind : undefined;
  const id = clean(candidate.id);
  const name = clean(candidate.name);
  const folderId = clean(candidate.folderId);
  if (!kind || !id || !name) return undefined;
  return { kind, id, name, folderId: folderId || undefined };
}

export function setMultiloginSelection(
  workspaceId: string,
  selection: MultiloginProfileSelection,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!workspaceId || !storage) return;
  const id = clean(selection.id);
  const name = clean(selection.name);
  const folderId = clean(selection.folderId);
  if (!id || !name) return;
  storage.setItem(storageKey(workspaceId), JSON.stringify({
    kind: selection.kind,
    id,
    name,
    folderId: folderId || undefined,
  }));
  notify(workspaceId);
}

export function clearMultiloginSelection(
  workspaceId?: string,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!workspaceId || !storage) return;
  storage.removeItem(storageKey(workspaceId));
  notify(workspaceId);
}

export function clearAllMultiloginSelections(storage: Storage | undefined = browserStorage()): void {
  if (!storage) return;
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(MULTILOGIN_SELECTION_PREFIX)));
  for (const key of keys) storage.removeItem(key);
  notify();
}
