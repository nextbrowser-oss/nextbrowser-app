import { translate } from "../shared/lib/i18n";
import { createContext, useContext, useState } from "react";
import { Columns2, Plus } from "lucide-react";
import type { AppInfo } from "../lib/miniAppLibrary";
import { IconButton, Popover } from "../shared/ui";
import { MiniAppIcon } from "./MiniAppIcon";
import { useStore } from "../store";

export const SessionMiniApps = createContext<{ apps: readonly AppInfo[]; open: (id: string) => void } | null>(null);

export function AddMiniAppTab() {
  const session = useContext(SessionMiniApps);
  const [opened, setOpened] = useState(false);
  if (!session) return null;
  return <Popover label={translate("Add mini app to session")} open={opened} onOpenChange={setOpened} align="start"
    className="session-mini-picker" trigger={props =>
      <IconButton {...props} label={translate("Add mini app to session")} appearance="plain" size="small"><Plus size={14} /></IconButton>}>
    {session.apps.map(app => <button key={app.id} type="button" onClick={() => { setOpened(false); session.open(app.id); }}>
      <MiniAppIcon app={app} />{app.name}</button>)}
    {!session.apps.length && <span>{translate("No installed mini apps")}</span>}
    <button type="button" onClick={() => { setOpened(false); useStore.getState().setTab("mini-apps"); }}>{translate("Browse Mini Apps")}</button>
  </Popover>;
}

export function OpenInSession({ id }: { id: string }) {
  const session = useContext(SessionMiniApps);
  return session && <IconButton label={translate("Open beside chat")} text="Open beside chat" appearance="plain" size="small"
    onClick={() => session.open(id)}><Columns2 size={15} /></IconButton>;
}
