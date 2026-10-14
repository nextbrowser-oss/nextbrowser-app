import type { Workspace } from "../types";
import { activeMultiloginSelectionForWorkspace } from "./multiloginSelection";

// The browser profile picked in a workspace is part of the user's setup: it
// must come back after a restart and after switching to another workspace and
// back. It is remembered per workspace, like the workspace's Multilogin
// profile, because profile names differ between workspaces.
export const SELECTED_PROFILE_PREFIX = "nextbrowser.selectedProfile.";

function storageKey(workspaceId: string): string {
  return `${SELECTED_PROFILE_PREFIX}${encodeURIComponent(workspaceId)}`;
}

function browserStorage(): Storage | undefined {
  if (typeof window !== "undefined") return window.localStorage;
  if (typeof localStorage !== "undefined") return localStorage;
  return undefined;
}

/** No profile is the agent default, which is a choice worth keeping too. */
export function rememberSelectedProfile(
  workspaceId: string | undefined,
  profileName: string | undefined,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!workspaceId || !storage) return;
  try {
    if (profileName) storage.setItem(storageKey(workspaceId), profileName);
    else storage.removeItem(storageKey(workspaceId));
  } catch { /* the choice then lasts for this session */ }
}

/**
 * The remembered profile, only while the workspace still has it and the
 * workspace's Multilogin profile is not the active target instead.
 */
export function rememberedSelectedProfile(
  workspace: Pick<Workspace, "id" | "profileNames"> | undefined,
  storage: Storage | undefined = browserStorage(),
): string | undefined {
  if (!workspace || !storage) return undefined;
  let name: string | null;
  try {
    name = storage.getItem(storageKey(workspace.id));
  } catch {
    return undefined;
  }
  if (!name || !workspace.profileNames.includes(name)) return undefined;
  if (activeMultiloginSelectionForWorkspace(workspace.id, storage)) return undefined;
  return name;
}

function rememberedKeys(storage: Storage): string[] {
  return Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(SELECTED_PROFILE_PREFIX)));
}

/** A deleted profile must not come back as any workspace's selection. */
export function forgetSelectedProfileName(
  profileName: string,
  storage: Storage | undefined = browserStorage(),
): void {
  if (!profileName || !storage) return;
  try {
    for (const key of rememberedKeys(storage)) {
      if (storage.getItem(key) === profileName) storage.removeItem(key);
    }
  } catch { /* a stale name is ignored when it is no longer in the workspace */ }
}

export function forgetWorkspaceSelectedProfile(
  workspaceId: string | undefined,
  storage: Storage | undefined = browserStorage(),
): void {
  rememberSelectedProfile(workspaceId, undefined, storage);
}

export function clearAllSelectedProfiles(storage: Storage | undefined = browserStorage()): void {
  if (!storage) return;
  try {
    for (const key of rememberedKeys(storage)) storage.removeItem(key);
  } catch { /* nothing else to clear */ }
}
