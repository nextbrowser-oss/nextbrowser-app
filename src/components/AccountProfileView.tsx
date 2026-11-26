import { translate } from "../shared/lib/i18n";
import { useStore } from "../store";
import { AccountAvatar } from "./AccountAvatar";
import { accountDisplayName } from "../lib/accountAvatar";
import { Button } from "../shared/ui";
import { UsageView } from "./UsageView";
import { AccountActivity } from "./AccountActivity";
import { AccountNetworkData } from "./AccountNetworkData";
import { AccountPreferences } from "./AccountPreferences";

export function AccountProfileView({ onDevices }: { onDevices: () => void }) {
  const authed = useStore(s => s.authed);
  const email = useStore(s => s.accountEmail);
  const name = useStore(s => s.accountName);
  const ownerId = useStore(s => s.accountOwnerId);
  const compatibilityError = useStore(s => s.nextctlCompatibilityError);
  return <section className="account-profile-page" aria-label={translate("Profile")}>
    <div className="account-profile-columns">
    <section className="account-profile-summary claw-card">
      <h1>{translate("My account")}</h1>
      {!authed && <Button onClick={() => useStore.getState().setDashboardKeyPromptOpen(true)}>{translate("Sign in")}</Button>}
      {authed && ownerId ? <AccountPreferences key={ownerId} owner={ownerId} name={name} email={email} /> :
        <div className="account-identity">
          <AccountAvatar large name={authed ? name : undefined} email={authed ? email : undefined} />
          <div className="account-identity-data">
            <h2>{(authed && accountDisplayName(name, email)) || translate("Nextbrowser account")}</h2>
            <p className="muted">{authed ? email || translate("Signed in") : translate("Sign in to sync your workspaces and proxies.")}</p>
          </div>
        </div>}
      {authed && ownerId && <AccountActivity key={"activity:" + ownerId} owner={ownerId} />}
    </section>
    {authed && ownerId && <AccountNetworkData key={ownerId} owner={ownerId} onDevices={onDevices} />}
    </div>
    {compatibilityError && <p role="status">{compatibilityError}</p>}
    {authed && <UsageView key={ownerId} />}
  </section>;
}
