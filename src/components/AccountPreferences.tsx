import { useRef, useState } from "react";
import { Check, KeyRound, Pencil, X } from "lucide-react";
import { Button, IconButton, Popover } from "../shared/ui";
import { avatarImage, saveAppearance, useAccountAppearance, type AccountAppearance } from "../lib/accountAppearance";
import { invoke } from "../electronBridge";
import { accountDisplayName } from "../lib/accountAvatar";
import { AccountAvatar } from "./AccountAvatar";

interface AccountDetails {
  owner: string;
  name?: string;
  email?: string;
}

type IdentityAction = "email" | "password";

function EditActions({ save, cancel, busy = false }: { save: () => void; cancel: () => void; busy?: boolean }) {
  return <span className="account-edit-actions">
    <IconButton label="Save" size="small" appearance="plain" disabled={busy} onClick={save}><Check size={15} /></IconButton>
    <IconButton label="Cancel" size="small" appearance="plain" onClick={cancel}><X size={14} /></IconButton>
  </span>;
}

export function AccountPreferences({ owner, name, email }: AccountDetails) {
  const appearance = useAccountAppearance(owner);
  const displayName = appearance.nickname || accountDisplayName(name, email) || "Nextbrowser account";
  const [nickname, setNickname] = useState<string>();
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [photo, setPhoto] = useState<string>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<IdentityAction>();
  const [fallback, setFallback] = useState<IdentityAction>();
  const photoTicket = useRef(0);
  const nameButton = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  function toggleAvatar(open: boolean) {
    photoTicket.current++;
    setReading(false); setError(""); setPhoto(appearance.avatar); setAvatarOpen(open);
  }
  function save(change: AccountAppearance, finish: () => void) {
    try { saveAppearance(owner, { ...appearance, ...change }); setError(""); finish(); }
    catch { setError("Could not save this change on your device."); }
  }
  function finishName() {
    setNickname(undefined);
    requestAnimationFrame(() => nameButton.current?.focus());
  }
  async function manage(action: IdentityAction) {
    setPending(action); setFallback(undefined); setError("");
    try { if (!(await invoke<boolean>("account_manage_identity", { action }))) setFallback(action); }
    catch { setFallback(action); }
    finally { setPending(undefined); }
  }
  async function open(url: string) {
    try { await invoke("open_external", { url }); }
    catch { setError("Could not open the browser. Try again."); }
  }
  return <div className="account-identity">
    <div className="account-portrait">
      <AccountAvatar large ownerId={owner} name={name} email={email}
        preview={avatarOpen ? { ...appearance, avatar: photo } : undefined} />
      <Popover label="Avatar" open={avatarOpen} onOpenChange={toggleAvatar} align="start"
        trigger={props => <IconButton {...props} className="account-avatar-edit" label="Edit avatar" hint="Edit" size="small" appearance="embedded"><Pencil size={12} /></IconButton>}>
        <div className="account-photo-menu">
          <Button onClick={() => picker.current?.click()} disabled={reading}>Choose photo…</Button>
          {photo && <Button onClick={() => setPhoto(undefined)} disabled={reading}>Use initials</Button>}
          <input hidden ref={picker} type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            const ticket = ++photoTicket.current;
            setReading(true);
            try { const result = await avatarImage(file); if (ticket === photoTicket.current) setPhoto(result); }
            catch (err) { if (ticket === photoTicket.current) setError(err instanceof Error ? err.message : "Could not read image."); }
            finally { if (ticket === photoTicket.current) setReading(false); }
          }} />
          <EditActions busy={reading} cancel={() => toggleAvatar(false)} save={() => save({ avatar: photo }, () => toggleAvatar(false))} />
        </div>
      </Popover>
    </div>
    <div className="account-identity-data">
      <div className="account-field">
        <small>Display name</small>
        {nickname === undefined ? <div className="account-field-row"><h2>{displayName}</h2>
          <IconButton ref={nameButton} label="Edit display name" size="small" appearance="plain"
            onClick={() => { setError(""); setNickname(appearance.nickname ?? displayName); }}><Pencil size={13} /></IconButton>
        </div> : <form className="account-field-row" onSubmit={event => { event.preventDefault(); save({ nickname: nickname.trim() }, finishName); }}>
          <input className="shared-text-field" aria-label="Nickname on this device" autoFocus maxLength={80} value={nickname}
            onFocus={event => event.target.select()} onChange={event => setNickname(event.target.value)}
            onKeyDown={event => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.stopPropagation(); finishName(); } }} />
          <EditActions save={() => save({ nickname: nickname.trim() }, finishName)} cancel={finishName} />
        </form>}
      </div>
      <div className="account-field">
        <small>Sign-in email</small>
        <div className="account-field-row"><span>{email || "Signed in"}</span>
          <IconButton label="Change sign-in email" hint="Edit email with your sign-in provider" size="small" appearance="plain"
            disabled={!!pending} onClick={() => void manage("email")}><Pencil size={13} /></IconButton>
        </div>
      </div>
      <button type="button" className="account-reset" disabled={!!pending} onClick={() => void manage("password")}><KeyRound size={14} />Reset password</button>
      {fallback && <div className="account-recovery-options" role="group" aria-label="Account security">
        <p>{fallback === "password" ? "Choose how you sign in to recover your account." : "Open your sign-in provider to verify a new email address."}</p>
        <div className="personal-profile-actions">
          <Button onClick={() => void open(fallback === "password" ? "https://accounts.google.com/signin/recovery" : "https://myaccount.google.com/email")}>Google ↗</Button>
          <Button onClick={() => void open(fallback === "password" ? "https://github.com/password_reset" : "https://github.com/settings/emails")}>GitHub ↗</Button>
          <Button onClick={() => void open("https://app.nextbrowser.com/api/session/login")}>Nextbrowser sign-in ↗</Button>
        </div>
        <p>For help with another sign-in method, contact support@nextbrowser.com.</p>
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
