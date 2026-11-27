import type { Profile, SessionStatus, Workspace } from "../types";
import type { MultiloginProfileSelection } from "./multiloginSelection";
import { clawbrowserTargetKey, multiloginTargetKey } from "./liveProfileSwitch";
import type { LiveStreamTarget } from "./liveStreamTarget";

export type LiveSessionOption = {
  key: string;
  label: string;
  running: boolean;
  target: LiveStreamTarget;
};

const runtimeLabels = { clawbrowser: "ClawBrowser", dasbrowser: "DasBrowser", camoufox: "Camoufox" };

export function liveRuntimeLabel(target: LiveStreamTarget) {
  if (target.runtime !== "multilogin") return runtimeLabels[target.runtime];
  return target.selection.kind === "mobile" ? "Multilogin cloud phone" : "Multilogin browser";
}

export function workspaceLiveSessions(
  workspace: Workspace | undefined,
  profiles: Profile[],
  statuses: Record<string, string>,
  profileSessions: Record<string, SessionStatus>,
  defaultSession?: SessionStatus,
  multilogin?: MultiloginProfileSelection,
  multiloginStatus?: string,
): LiveSessionOption[] {
  if (!workspace) return [];
  const local = profiles.filter(profile => workspace.profileNames.includes(profile.name));
  const labelCounts = new Map<string, number>();
  for (const profile of local) {
    const label = profile.display_name || profile.name;
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
  }
  const sessions: LiveSessionOption[] = local.map(profile => {
    const runtime = workspace.profileToolsets[profile.name] ?? "clawbrowser";
    const label = profile.display_name || profile.name;
    return {
      key: clawbrowserTargetKey(profile.name),
      label: (labelCounts.get(label) ?? 0) > 1 ? `${label} · ${runtimeLabels[runtime]} (${profile.name})` : label,
      running: (statuses[profile.name] ?? profileSessions[profile.name]?.status) === "running",
      target: { runtime, profile: profile.name },
    };
  });
  const defaultRunning = defaultSession?.status === "running";
  const duplicate = defaultRunning && Object.values(profileSessions).some(session =>
    session.status === "running" && (
      (session.pid && session.pid === defaultSession?.pid) ||
      (session.session?.endpoint && session.session.endpoint === defaultSession?.session?.endpoint)
    ));
  if (workspace.profileNames.includes("__default") && defaultSession &&
      (defaultSession.session?.name || defaultSession.status !== "unknown") &&
      !profiles.some(profile => profile.name === "default") && !duplicate) {
    sessions.push({ key: clawbrowserTargetKey(), label: "Default browser", running: defaultRunning, target: { runtime: "clawbrowser" } });
  }
  if (multilogin) {
    sessions.push({
      key: multiloginTargetKey(multilogin),
      label: multilogin.name,
      running: multiloginStatus === "running",
      target: { runtime: "multilogin", selection: multilogin },
    });
  }
  return sessions;
}
