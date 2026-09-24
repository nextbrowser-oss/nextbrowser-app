import type { ScheduledRun } from "../types";

export function resolveScheduledProfile(run: ScheduledRun, workspaceProfiles: string[]): string | undefined {
  if (run.profileName) {
    if (!workspaceProfiles.includes(run.profileName)) throw new Error(`The scheduled profile “${run.profileName}” is no longer in this workspace. Edit the schedule before retrying.`);
    return run.profileName;
  }
  if (workspaceProfiles.length > 1) throw new Error("Choose a browser profile in this schedule before it runs. The currently selected profile is not used automatically.");
  return workspaceProfiles[0];
}
