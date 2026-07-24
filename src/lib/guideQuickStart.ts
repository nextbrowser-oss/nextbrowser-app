export type GuideProfileTarget = string | "__default" | null;

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
  return selectedProfile ?? profileNames[0] ?? (hasDefaultProfile ? "__default" : null);
}
