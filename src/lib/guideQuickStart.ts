export type GuideProfileTarget = string | "__default" | null;

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

export function guideSessionSetupEvent(profileCount: number):
  | "nextbrowser:open-profile-creator"
  | "nextbrowser:start-selected-profile" {
  return profileCount === 0
    ? "nextbrowser:open-profile-creator"
    : "nextbrowser:start-selected-profile";
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
