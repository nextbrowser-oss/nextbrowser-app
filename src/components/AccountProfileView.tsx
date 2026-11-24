import { useState } from "react";
import { useStore } from "../store";
import { Spinner } from "./Icon";
import { AccountAvatar } from "./AccountAvatar";
import { accountDisplayName } from "../lib/accountAvatar";
import { Button } from "../shared/ui";
import { UserFacingError } from "./UserFacingError";
import { internalError } from "../lib/userFacingError";
import { UsageView } from "./UsageView";
import { AccountActivity } from "./AccountActivity";
import { PersonalProfiles } from "./PersonalProfiles";

export function AccountProfileView() {
  const authed = useStore(s => s.authed);
  const email = useStore(s => s.accountEmail);
  const name = useStore(s => s.accountName);
  const ownerId = useStore(s => s.accountOwnerId);
  const compatibilityError = useStore(s => s.nextctlCompatibilityError);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const logout = async () => {
    setPending(true); setError(undefined);
    try { await useStore.getState().logout(); }
    catch { setError(internalError("We couldn't sign you out.", "ACCOUNT_SIGN_OUT_FAILED")); }
    finally { setPending(false); }
  };
  return <section className="account-profile-page" aria-label="Profile">
    <header className="account-profile-summary">
      <h1>My account</h1>
      <div className="account-identity">
        {authed ? <AccountAvatar ownerId={ownerId} name={name} email={email} /> : <AccountAvatar />}
        <div>
          <h2>{(authed && accountDisplayName(name, email)) || "Nextbrowser account"}</h2>
          <p className="muted">{authed ? email || "Signed in" : "Sign in to sync your workspaces and proxies."}</p>
        </div>
      </div>
      <Button disabled={pending} onClick={() => authed ? void logout() : useStore.getState().setDashboardKeyPromptOpen(true)}>
        {pending && <Spinner size={13} />}{authed ? "Sign out" : "Sign in"}
      </Button>
    </header>
    {compatibilityError && <p role="status">{compatibilityError}</p>}
    {error && <div role="alert"><UserFacingError message={error} surface="account_sign_out" /></div>}
    {authed && ownerId && <div className="account-overview" key={"overview:" + ownerId}>
      <AccountActivity owner={ownerId} />
      <PersonalProfiles owner={ownerId} />
    </div>}
    {authed && <UsageView key={ownerId} />}
  </section>;
}
