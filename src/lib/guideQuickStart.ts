export type GuideProfileTarget = string | "__default" | null;
export type GuideSessionState = "running" | "starting" | "stopped";

export function guideSessionState(...states: Array<string | undefined>): GuideSessionState {
  if (states.includes("running")) return "running";
  if (states.some((state) => ["starting", "rotating"].includes(state || ""))) return "starting";
  return "stopped";
}

export function guideWorkspaceProfileNames(
  activeWorkspaceId: string | undefined,
  workspaces: ReadonlyArray<{ id: string; profileNames: readonly string[] }>,
  profiles: ReadonlyArray<{ name: string }>,
): string[] {
  const available = new Set(profiles.map((profile) => profile.name));
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const names = workspace?.profileNames ?? profiles.map((profile) => profile.name);
  return names.filter((name, index) => available.has(name) && names.indexOf(name) === index);
}

export function guideSessionSetupEvent(target: GuideProfileTarget):
  | "nextbrowser:open-profile-creator"
  | "nextbrowser:start-selected-profile" {
  return target ? "nextbrowser:start-selected-profile" : "nextbrowser:open-profile-creator";
}

export interface GuideBrowserSession {
  state: GuideSessionState;
  /** Profile the state belongs to, or the one the Guide would start next. */
  profile: GuideProfileTarget;
}

/**
 * A browser session counts as started for the Guide when *any* profile of the
 * active workspace — or the unnamed default session — is up. Reading only the
 * selected profile left the step stuck on "Start session" for every workspace
 * with more than one profile, because nothing is selected until the user clicks
 * a row.
 */
export function guideBrowserSession(
  profileNames: readonly string[],
  selectedProfile: string | undefined,
  statuses: Readonly<Record<string, string | undefined>>,
  profileSessions: Readonly<Record<string, { status?: string } | undefined>>,
  defaultStatus?: string,
  hasDefaultProfile = false,
): GuideBrowserSession {
  const stateOf = (name: string) => guideSessionState(statuses[name], profileSessions[name]?.status);
  const selected = selectedProfile && profileNames.includes(selectedProfile) ? selectedProfile : undefined;
  const defaultState = guideSessionState(defaultStatus);

  for (const wanted of ["running", "starting"] as const) {
    if (selected && stateOf(selected) === wanted) return { state: wanted, profile: selected };
    const match = profileNames.find((name) => stateOf(name) === wanted);
    if (match) return { state: wanted, profile: match };
    if (defaultState === wanted) return { state: wanted, profile: "__default" };
  }

  return { state: "stopped", profile: guideProfileTarget(selected, profileNames, hasDefaultProfile) };
}

export function guideProfileTarget(
  selectedProfile: string | undefined,
  profileNames: readonly string[],
  hasDefaultProfile: boolean,
): GuideProfileTarget {
  return (selectedProfile && profileNames.includes(selectedProfile) ? selectedProfile : undefined)
    ?? profileNames[0]
    ?? (hasDefaultProfile ? "__default" : null);
}
