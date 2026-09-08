import type { MultiloginProfileKind, MultiloginProfileSelection } from "./multiloginSelection";

export interface MultiloginProfileSummary {
  id: string;
  name: string;
  folderId?: string;
  status?: string;
}

/** Display-only identity of the connected token, read from its JWT claims. */
export interface MultiloginAccount {
  email?: string;
  workspaceId?: string;
  workspaceName?: string;
  workspaceRole?: string;
}

/** Names the workspace a token opens. Multilogin tokens carry no workspace name, so the id is
 * shortened the way the Multilogin UI shows it, and the role says how you got in. */
export function multiloginWorkspaceLabel(account: MultiloginAccount | undefined): string {
  if (!account) return "";
  const workspace = account.workspaceName || (account.workspaceId ? `Workspace ${account.workspaceId.slice(0, 8)}` : "");
  return [workspace, account.workspaceRole].filter(Boolean).join(" · ");
}

export function multiloginAccountLabel(account: MultiloginAccount | undefined): string {
  if (!account) return "";
  return [account.email, multiloginWorkspaceLabel(account)].filter(Boolean).join(" · ");
}

/** A folder in the token workspace, as offered by `nbc profiles folders`. */
export interface MultiloginFolder {
  id: string;
  name: string;
  kind: MultiloginProfileKind;
  profilesCount: number;
}

export interface MultiloginConnectionStatus {
  connected: boolean;
  account?: MultiloginAccount;
  folders?: { browser?: string; mobile?: string };
  valid: boolean;
  secureStorageAvailable: boolean;
  /**
   * A local recognition label decoded from the short-lived sign-in token.
   * Multilogin automation tokens themselves only grant workspace access.
   */
  accountEmail?: string;
  browserProfiles?: MultiloginProfileSummary[];
  cloudPhones?: MultiloginProfileSummary[];
  browserProfilesError?: string;
  cloudPhonesError?: string;
  error?: string;
}

export function multiloginProfileSelected(
  selection: MultiloginProfileSelection | undefined,
  kind: MultiloginProfileKind,
  profile: MultiloginProfileSummary,
): boolean {
  return selection?.kind === kind && selection.id === profile.id && selection.folderId === profile.folderId;
}

export function filterMultiloginProfiles(
  profiles: MultiloginProfileSummary[],
  query: string,
): MultiloginProfileSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return profiles;
  return profiles.filter((profile) => profile.name.toLocaleLowerCase().includes(normalized));
}

export function previewMultiloginConnectionStatus(search = window.location.search): MultiloginConnectionStatus {
  const connected = new URLSearchParams(search).get("connector") === "connected";
  if (!connected) return { connected: false, valid: false, secureStorageAvailable: true };
  return {
    connected: true,
    valid: true,
    secureStorageAvailable: true,
    account: { email: "you@example.com", workspaceName: "Growth team", workspaceRole: "manager" },
    browserProfiles: [
      { id: "browser-1", name: "7_GitHub_acc", status: "Stopped" },
      { id: "browser-2", name: "Amazon US", status: "Running" },
      { id: "browser-3", name: "Work EU", status: "Stopped" },
    ],
    cloudPhones: [
      { id: "17", name: "Android US", status: "Running" },
      { id: "18", name: "Android EU", status: "Stopped" },
    ],
  };
}
