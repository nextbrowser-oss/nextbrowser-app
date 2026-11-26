import { translate } from "../shared/lib/i18n";
import { useEffect } from "react";
import { useStore } from "../store";
import { discordUrl, repoUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
import { trafficGateState } from "../lib/trafficGate";
import { shouldAskForGitHubStar } from "../lib/githubStarReward";
import { humanBytes } from "../types";
import { Icon } from "./Icon";

/**
 * The free traffic gate closing is the one allocation change a gated account
 * cannot discover on its own: the dashboard keeps showing the full allowance it
 * was promised, so the first symptom is profiles refusing to start and pages
 * that never load. This modal is deliberately the loudest surface in the app —
 * it interrupts, it names the cause, and it hands over the one action that
 * lifts the pause: a GitHub star. Discord stays for questions only.
 */
export function TrafficGateModal() {
  const proxy = useStore((s) => s.proxy);
  const open = useStore((s) => s.trafficGatePromptOpen);
  const setOpen = useStore((s) => s.setTrafficGatePromptOpen);
  // A GitHub sign-up lifts its limit with a star; that prompt replaces this one.
  const starAsked = useStore((s) => shouldAskForGitHubStar(s.githubStar));

  useEffect(() => {
    if (!open || trafficGateState(proxy) !== "blocked") return;
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [open, proxy, setOpen]);

  // The store only opens this on a gated account, but a grant can land while
  // the modal is up; the moment it does, the pause is over and it should go.
  if (!open || starAsked || trafficGateState(proxy) !== "blocked") return null;

  const usedBucket = proxy ? Math.floor(proxy.used_bytes / (10 * 1024 * 1024)) * 10 : "unknown";
  const openGitHub = () => {
    trackEvent("proxy_traffic_gate_github_opened", { surface: "gate_modal", proxy_state: proxy?.state ?? "unknown", used_bytes_bucket: usedBucket });
    window.open(repoUrl, "_blank", "noopener,noreferrer");
    setOpen(false);
  };
  const askInDiscord = () => {
    trackEvent("proxy_traffic_gate_discord_opened", { surface: "gate_modal", proxy_state: proxy?.state ?? "unknown", used_bytes_bucket: usedBucket });
    window.open(discordUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="modal-overlay traffic-gate-overlay">
      <section
        aria-labelledby="traffic-gate-title"
        aria-modal="true"
        className="modal-card traffic-gate-modal"
        role="alertdialog"
      >
        <div className="modal-title-row">
          <Icon name="lock.fill" size={18} />
          <div>
            <strong id="traffic-gate-title">{translate("Get 1 GB of free proxy traffic")}</strong>
            <div className="muted small">
              {proxy ? translate("%1 used · ", humanBytes(proxy.used_bytes)) : ""}{translate("free traffic is paused")}</div>
          </div>
        </div>
        <p className="traffic-gate-modal-copy">{translate("Connect GitHub and star")} <strong>{translate("nextbrowser-oss/nextbrowser-app")}</strong>{translate(". Your 1 GB unlocks once the star is checked. If you remove the star later, the bonus pauses again.")} </p>
        <div className="traffic-gate-modal-effect">
          <Icon name="exclamationmark.triangle.fill" size={14} />
          <span>{translate("Until then profiles on the managed proxy will not start and pages will not load through it. Profiles on a direct connection or your own proxy keep working.")}</span>
        </div>
        <div className="modal-actions">
          <button className="link small" type="button" onClick={askInDiscord}>{translate("Questions? Ask in Discord")}</button>
          <span className="spacer" />
          <button className="btn-bordered" type="button" autoFocus onClick={() => setOpen(false)}>{translate("Later")}</button>
          <button className="primary" type="button" onClick={openGitHub}>
            <Icon name="star.fill" size={13} />{translate("Open GitHub")}</button>
        </div>
      </section>
    </div>
  );
}
