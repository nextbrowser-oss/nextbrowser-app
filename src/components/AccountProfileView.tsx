import { useState, type ReactNode } from "react";
import { useStore } from "../store";
import { Icon, Spinner } from "./Icon";
import { UserFacingError } from "./UserFacingError";
import { internalError } from "../lib/userFacingError";
import { UsageView } from "./UsageView";

export function AccountProfileView({ accessory }: { accessory?: ReactNode }) {
  const authed = useStore(s => s.authed);
  const email = useStore(s => s.accountEmail);
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
    <header className="live-sessions-header"><h1>Profile</h1>{accessory}</header>
    <div className="account-profile-summary">
      <Icon name="person.crop.circle" size={28} />
      <div><strong>{email || "Nextbrowser account"}</strong><p className="muted">{compatibilityError || (authed ? "Signed in" : "Sign in to sync your workspaces and proxies")}</p></div>
      <button type="button" className="secondary" disabled={pending} onClick={() => authed ? void logout() : useStore.getState().setDashboardKeyPromptOpen(true)}>
        {pending && <Spinner size={13} />}{authed ? "Sign out" : "Sign in"}
      </button>
    </div>
    {error && <div role="alert"><UserFacingError message={error} surface="account_sign_out" /></div>}
    {authed && <UsageView />}
  </section>;
}
