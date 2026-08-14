import type { Workspace } from "../types";

export function moveProfileToWorkspace(
  workspaces: Workspace[],
  profileName: string,
  targetWorkspaceId: string,
  updatedAt: number,
): Workspace[] {
  const source = workspaces.find((workspace) => workspace.profileNames.includes(profileName));
  const target = workspaces.find((workspace) => workspace.id === targetWorkspaceId);
  if (!source) throw new Error("Profile is not assigned to a workspace.");
  if (!target) throw new Error("Workspace not found.");
  if (source.id === target.id) return workspaces;
  const toolset = source.profileToolsets[profileName] ?? "clawbrowser";

  return workspaces.map((workspace) => {
    if (workspace.id !== source.id && workspace.id !== target.id) return workspace;
    const profileNames = workspace.profileNames.filter((name) => name !== profileName);
    const profileToolsets = { ...workspace.profileToolsets };
    delete profileToolsets[profileName];
    if (workspace.id === target.id) {
      profileNames.push(profileName);
      profileToolsets[profileName] = toolset;
    }
    return { ...workspace, profileNames, profileToolsets, updatedAt };
  });
}
