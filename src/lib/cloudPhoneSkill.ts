// A cloud-phone skill drives a site's Android app on a Multilogin phone instead
// of a browser tab. The app's part is small: name the phone the workspace has
// selected, keep every browser profile out of the way, and hand the agent the
// skill text. The phone itself is reached through nbc --runtime multilogin.

import type { MultiloginProfileSelection } from "./multiloginSelection";

export interface CloudPhoneTarget {
  id: string;
  name: string;
  folderId?: string;
}

/** cloudPhoneFromSelection keeps only a phone. A Multilogin browser profile is
 *  the wrong device for a skill that drives an Android app, so it is ignored
 *  rather than passed on as if it could run the skill. */
export function cloudPhoneFromSelection(selection: MultiloginProfileSelection | undefined): CloudPhoneTarget | undefined {
  if (!selection || selection.kind !== "mobile") return undefined;
  return { id: selection.id, name: selection.name, folderId: selection.folderId };
}

/** cloudPhoneRunsIn is the Skills card's "where" line for such a skill. */
export function cloudPhoneRunsIn(phone: CloudPhoneTarget | undefined): string {
  return phone
    ? `Runs on cloud phone “${phone.name}”`
    : "Runs on a Multilogin cloud phone · pick one in Connectors";
}

/** cloudPhoneSkillPrompt frames the skill for the agent. With a phone, every
 *  nbc call is pinned to it; without one, the agent asks which phone to use
 *  instead of guessing or creating one. Either way no browser is prepared. */
export function cloudPhoneSkillPrompt(
  title: string,
  target: string,
  md: string,
  phone: CloudPhoneTarget | undefined,
  task?: string,
): string {
  const folder = phone?.folderId ? ` --multilogin-folder-id ${phone.folderId}` : "";
  const where = phone
    ? `Work on the Multilogin cloud phone “${phone.name}” (id ${phone.id}${phone.folderId ? `, folder ${phone.folderId}` : ""}). `
      + `Every nbc command runs as \`nbc --runtime multilogin${folder} mobile …\` and names this phone by its id.`
    : "No cloud phone is selected for this workspace. First list the phones with "
      + "`nbc --runtime multilogin mobile profiles list --json`, show the user their names, and ask which one to use; "
      + "do not create a phone and do not guess.";
  // The task is the app's own instruction for this run, so it precedes the
  // skill text: the workflow explains how, the task says what.
  const thisRun = task?.trim() ? `\n\nTask for this run:\n${task.trim()}` : "";
  return `Use the "${title}" skill to work with ${target} in its Android app. ${where} `
    + "Do not start, open, inspect, or change any NextBrowser browser profile for this task: the site is driven on the phone, not in a browser."
    + `${thisRun}\n\nFollow this SKILL.md exactly, step by step:\n\n${md}`;
}
