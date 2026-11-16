import { glassSurfaceClassName, Glyph, Tooltip } from "../shared/ui";
import { useStore } from "../store";
import { useLiveSessions } from "../lib/useLiveSessions";
import { chatLiveSession } from "../lib/profileNavigation";
import { CREATE_LIVE_PROFILE_EVENT } from "./LiveSessions";
import "./mainViewNavigation.css";

const views = [
  { id: "chat", label: "Project", icon: "folder" },
  { id: "live", label: "Live", icon: "video" },
  { id: "automation", label: "Automation", icon: "branch" },
] as const;

export function MainViewNavigation() {
  const tab = useStore(state => state.tab);
  const select = useStore(state => state.setTab);
  const sessions = useLiveSessions();
  const openBrowser = () => {
    const state = useStore.getState();
    const session = chatLiveSession(sessions, state.activeConversation(), state.profileChatOwners, state.selectedProfile);
    if (session) {
      const conversation = state.activeConversation();
      if (conversation && session.target.runtime !== 'multilogin') state.rememberConversationProfile(conversation.id, session.target.profile || '__default', session.target.runtime);
      state.openLiveSession(session.key);
    }
    else window.dispatchEvent(new Event(CREATE_LIVE_PROFILE_EVENT));
  };
  return <div className={`${glassSurfaceClassName} main-view-navigation`} role="tablist" aria-label="Main views">
    {views.map(view => <Tooltip key={view.id} content={view.label}><button type="button" role="tab"
      aria-label={`Open ${view.label}`} aria-selected={tab === view.id} onClick={() => view.id === "live" ? openBrowser() : select(view.id)}>
      <Glyph name={view.icon} size={14} /><span>{view.label}</span>
    </button></Tooltip>)}
  </div>;
}
