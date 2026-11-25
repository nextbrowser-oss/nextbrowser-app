import { useEffect } from "react";
import { discordUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import { reportUserFacingMessage } from "../lib/errorReporting";
import { needsSupportLink } from "../lib/userFacingError";

interface ErrorSupportProps {
  message: string;
  surface: string;
  /** Always link to Discord with this label, e.g. when the fix lives there. */
  discordLabel?: string;
}

export function ErrorSupportLink({ message, surface, discordLabel }: ErrorSupportProps) {
  const supportRef = needsSupportLink(message);
  const label = discordLabel ?? (supportRef ? "Get help in Discord." : undefined);
  // A message with a Ref is an internal error the user is looking at. It is
  // reported by its surface, error code and Ref, once per Ref; the text, which
  // in a chat turn holds the agent's output, never is.
  useEffect(() => {
    if (supportRef) reportUserFacingMessage(surface.replace(/_/g, "-"), message);
  }, [supportRef, surface, message]);
  return label ? (
    <a
      href={discordUrl}
      target="_blank"
      rel="noreferrer"
      onClick={() => trackEvent("internal_error_support_opened", { surface })}
    >
      {label}
    </a>
  ) : null;
}

export function UserFacingError(props: ErrorSupportProps) {
  return (
    <span className="user-facing-error">
      <span>{props.message}</span>{" "}<ErrorSupportLink {...props} />
    </span>
  );
}
