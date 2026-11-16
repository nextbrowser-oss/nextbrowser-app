import type { Conversation } from "../types";
import type { LiveSessionOption } from "./liveSessions";

export const PROFILE_ACTIONS_EVENT = "nextbrowser:profile-card-actions";
export function openProfileActions(name: string, anchor: HTMLElement) {
  window.dispatchEvent(new CustomEvent(PROFILE_ACTIONS_EVENT, { detail: { name, anchor } }));
}

/** Resolve the chat's browser before any workspace-wide choice. Never jump to another chat's running browser. */
export function chatLiveSession(sessions: LiveSessionOption[], conversation: Conversation | undefined,
  owners: Record<string, string>, selectedProfile?: string) {
  const profile = (session: LiveSessionOption) => session.target.runtime === "multilogin" ? undefined : session.target.profile || "__default";
  const owned = conversation && sessions.filter(session => owners[profile(session) || ""] === conversation.id);
  if (owned && owned.length) return owned.find(session => profile(session) === selectedProfile) ?? owned.find(session => session.running) ?? owned[0];
  const available = sessions.filter(session => {
    const owner = owners[profile(session) || ""];
    return !owner || owner === conversation?.id;
  });
  const assigned = available.filter(session => conversation?.profileNames?.includes(profile(session) || ""));
  if (assigned.length) return assigned.find(session => profile(session) === selectedProfile) ?? assigned.find(session => session.running) ?? assigned[0];
  return available.find(session => profile(session) === selectedProfile)
    ?? available.find(session => session.target.runtime === "multilogin" && session.target.selection.active !== false && !selectedProfile)
    ?? available.find(session => session.running) ?? available[0];
}
