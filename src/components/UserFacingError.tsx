import { discordUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import { needsSupportLink } from "../lib/userFacingError";

export function UserFacingError({
  message,
  surface,
}: {
  message: string;
  surface: string;
}) {
  return (
    <span className="user-facing-error">
      <span>{message}</span>
      {needsSupportLink(message) && (
        <>
          {" "}
          <a
            href={discordUrl}
            target="_blank"
            rel="noreferrer"
            onClick={() => trackEvent("internal_error_support_opened", { surface })}
          >
            Get help in Discord.
          </a>
        </>
      )}
    </span>
  );
}
