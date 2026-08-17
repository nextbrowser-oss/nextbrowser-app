import type { MultiloginProfileKind, MultiloginProfileSelection } from "./multiloginSelection";

export interface MultiloginProfileSummary {
  id: string;
  name: string;
  folderId?: string;
  status?: string;
}

export interface MultiloginConnectionStatus {
  connected: boolean;
  valid: boolean;
  secureStorageAvailable: boolean;
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

export function previewMultiloginConnectionStatus(search = window.location.search): MultiloginConnectionStatus {
  const connected = new URLSearchParams(search).get("connector") === "connected";
  if (!connected) return { connected: false, valid: false, secureStorageAvailable: true };
  return {
    connected: true,
    valid: true,
    secureStorageAvailable: true,
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
