/** Paths a person signs in, signs up or confirms a code on. A re-check opens
 *  the site's home page, so it must never run while the tab shows one of these:
 *  the user may be halfway through typing a code from an email. */
const SIGN_IN_PATH = /\/(log-?in|sign-?in|sign-?up|accounts\/(login|emailsignup|password)|challenge|checkpoint|two[-_]?(factor|step)|2fa|auth|verify|confirm|recover|uas\/login)/i;

/** signInDone says whether a tab at `href` has left the sign-in pages and is
 *  back on `site`, which is when the account can be read without getting in
 *  the user's way. Another host is an identity provider's page (Google,
 *  Apple) in the middle of a sign-in. */
export function signInDone(href: string, site: string): boolean {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return false;
  }
  const host = site.replace(/^www\./, "").toLowerCase();
  if (url.hostname !== host && !url.hostname.endsWith(`.${host}`)) return false;
  return !SIGN_IN_PATH.test(url.pathname);
}
