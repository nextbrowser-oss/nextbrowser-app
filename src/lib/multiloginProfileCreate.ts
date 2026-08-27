import type { MultiloginConnectionStatus, MultiloginProfileSummary } from "./multiloginProfiles";
import type { MultiloginProfileKind, MultiloginProfileSelection } from "./multiloginSelection";

export type MultiloginCreateMode = "new" | "existing";

export const MULTILOGIN_OS_TYPES = ["windows", "macos", "linux"] as const;
export type MultiloginOSType = (typeof MULTILOGIN_OS_TYPES)[number];

export interface MultiloginCreatedProfile {
  id: string;
  name: string;
  folderId?: string;
  country?: string;
  storage?: string;
}

export function multiloginConnected(status: MultiloginConnectionStatus | null | undefined): boolean {
  return Boolean(status?.connected && status.valid);
}

export function multiloginProfileSelection(
  kind: MultiloginProfileKind,
  profile: MultiloginProfileSummary | MultiloginCreatedProfile,
): MultiloginProfileSelection {
  return { kind, id: profile.id, name: profile.name, folderId: profile.folderId };
}

/// Multilogin attaches its own built-in proxy, so a personal proxy never
/// applies and a direct profile simply skips the country flag.
export function multiloginCreateCountry(connection: "managed" | "direct" | "personal", country: string): string {
  if (connection !== "managed") return "";
  const normalized = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

export function multiloginSubmitError(
  mode: MultiloginCreateMode,
  connection: "managed" | "direct" | "personal",
  country: string,
  selection?: MultiloginProfileSelection,
): string | undefined {
  if (mode === "existing") {
    return selection ? undefined : "Choose a Multilogin profile.";
  }
  return connection === "managed" && !multiloginCreateCountry(connection, country)
    ? "Choose a valid proxy country."
    : undefined;
}

export function multiloginSubmitLabel(mode: MultiloginCreateMode): string {
  return mode === "existing" ? "Use profile" : "Create profile";
}
