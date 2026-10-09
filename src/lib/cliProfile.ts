/** cliProfile writes a profile name the way a shell command in an agent task
 *  needs it: as is when it is a plain name, single-quoted otherwise, and the
 *  "<profile>" placeholder when the task has no profile to name. */
export function cliProfile(profileName?: string): string {
  if (!profileName) return "<profile>";
  return /^[\w.@-]+$/.test(profileName) ? profileName : `'${profileName.replace(/'/g, "'\\''")}'`;
}
