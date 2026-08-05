export function accountLoginURL(verificationURL: string) {
  const verification = new URL(verificationURL);
  if (verification.protocol !== "https:") {
    throw new Error("Account verification URL must use HTTPS");
  }
  const login = new URL("/api/session/login", verification.origin);
  login.searchParams.set("next", `${verification.pathname}${verification.search}`);
  return login.toString();
}
