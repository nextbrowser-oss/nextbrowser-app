import { discordUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import { needsSupportLink } from "../lib/userFacingError";

export function UserFacingError({
  message,
  surface,
  discordLabel,
}: {
  message: string;
  surface: string;
  /** Always link to Discord with this label, e.g. when the fix lives there. */
  discordLabel?: string;
}) {
  const label = discordLabel ?? (needsSupportLink(message) ? "Get help in Discord." : undefined);
  return (
    <span className="user-facing-error">
      <span>{message}</span>
      {label && (
        <>
          {" "}
          <a
            href={discordUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("internal_error_support_opened", { surface })}
          >
            {label}
          </a>
        </>
      )}
    </span>
  );
}
