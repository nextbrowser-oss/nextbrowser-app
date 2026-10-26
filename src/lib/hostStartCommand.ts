/**
 * The exact command an agent runs to have the app start a listed profile.
 *
 * The profile goes as a URL-encoded form field rather than JSON in quotes: an
 * agent runs it in whatever shell it has, and Windows PowerShell 5.1 drops the
 * double quotes inside a native command's argument, so '{"profile":"Work"}'
 * reached the app as {profile:Work} (and split at a space) and could not be
 * read. The encoded value holds only letters, digits and - _ . ~ %, which
 * bash, zsh, PowerShell and cmd all pass unchanged.
 */
export function hostStartCommand(profileName: string): string {
  const value = encodeURIComponent(profileName).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `curl -sS -X POST "$NEXTBROWSER_CONTROL_URL/profile/start" -H "Authorization: Bearer $NEXTBROWSER_CONTROL_TOKEN" --data "profile=${value}"`;
}
