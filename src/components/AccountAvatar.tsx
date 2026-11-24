import type { CSSProperties } from "react";
import { accountAvatarHues, accountDisplayName, accountInitials } from "../lib/accountAvatar";
import { Glyph } from "../shared/ui";
import "./accountAvatar.css";

interface AccountAvatarProps {
  ownerId?: string;
  name?: string;
  email?: string;
  large?: boolean;
}

export function AccountAvatar({ ownerId, name, email, large = false }: AccountAvatarProps) {
  const initials = accountInitials(accountDisplayName(name, email));
  const hues = ownerId ? accountAvatarHues(ownerId) : undefined;
  const style = hues && {
    "--account-avatar-from": hues[0],
    "--account-avatar-to": hues[1],
  } as CSSProperties;
  return (
    <span aria-hidden="true" className={`account-avatar${large ? " account-avatar--large" : ""}${hues ? " account-avatar--identified" : ""}`} style={style}>
      {initials || <Glyph name="users" />}
    </span>
  );
}
