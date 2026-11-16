import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { MULTILOGIN_SELECTION_EVENT, multiloginSelectionForWorkspace } from "./multiloginSelection";
import { workspaceLiveSessions } from "./liveSessions";

export function useLiveSessions() {
  const workspace = useStore(s => s.workspaces.find(item => item.id === s.activeWorkspaceId));
  const profiles = useStore(s => s.profiles);
  const statuses = useStore(s => s.statuses);
  const profileSessions = useStore(s => s.profileSessions);
  const defaultSession = useStore(s => s.defaultSession);
  const [stored, setStored] = useState(() => ({
    workspaceId: workspace?.id, selection: multiloginSelectionForWorkspace(workspace?.id),
  }));
  const multilogin = stored.workspaceId === workspace?.id ? stored.selection : undefined;
  const multiloginStatus = useStore(s => multilogin && s.multiloginStatuses[multilogin.id]);
  useEffect(() => {
    const refresh = () => setStored({
      workspaceId: workspace?.id, selection: multiloginSelectionForWorkspace(workspace?.id),
    });
    refresh();
    window.addEventListener(MULTILOGIN_SELECTION_EVENT, refresh);
    return () => window.removeEventListener(MULTILOGIN_SELECTION_EVENT, refresh);
  }, [workspace?.id]);

  return useMemo(() => workspaceLiveSessions(
    workspace, profiles, statuses, profileSessions, defaultSession, multilogin, multiloginStatus,
  ), [workspace, profiles, statuses, profileSessions, defaultSession, multilogin, multiloginStatus]);
}
