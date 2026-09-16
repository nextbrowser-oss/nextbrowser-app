import { useStore } from "../store";
import { discordUrl } from "../constants";
import { trackEvent } from "../lib/analytics";
import { freeTrafficAllowanceBytes, trafficGateState } from "../lib/trafficGate";
import { humanBytes } from "../types";
import { Icon } from "./Icon";

/**
 * The free traffic gate closing is the one allocation change a gated account
 * cannot discover on its own: the dashboard keeps showing the full allowance it
 * was promised, so the first symptom is profiles refusing to start and pages
 * that never load. This modal is deliberately the loudest surface in the app —
 * it interrupts, it names the cause, and it hands over the one action that
 * lifts the pause.
 */
export function TrafficGateModal() {
  const proxy = useStore((s) => s.proxy);
  const open = useStore((s) => s.trafficGatePromptOpen);
  const setOpen = useStore((s) => s.setTrafficGatePromptOpen);

  // The store only opens this on a gated account, but a grant can land while
  // the modal is up; the moment it does, the pause is over and it should go.
  if (!open || trafficGateState(proxy) !== "blocked") return null;

  const askInDiscord = () => {
    trackEvent("proxy_traffic_gate_discord_opened", {
      surface: "gate_modal",
      proxy_state: proxy?.state ?? "unknown",
      used_bytes_bucket: proxy ? Math.floor(proxy.used_bytes / (10 * 1024 * 1024)) * 10 : "unknown",
    });
    window.open(discordUrl, "_blank", "noopener,noreferrer");
    setOpen(false);
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
            <strong id="traffic-gate-title">Your free proxy traffic is paused</strong>
            <div className="muted small">
              {proxy ? `${humanBytes(proxy.used_bytes)} used` : "Traffic used"}
              {" of your free "}
              {humanBytes(freeTrafficAllowanceBytes)}
            </div>
          </div>
        </div>
        <p className="traffic-gate-modal-copy">
          New accounts pause after the first few dozen megabytes so we can meet the people
          using NextBrowser. Say hi in Discord and we unlock the rest of your allowance by
          hand. Feedback, repo stars, and pull requests earn more.
        </p>
        <div className="traffic-gate-modal-effect">
          <Icon name="exclamationmark.triangle.fill" size={14} />
          <span>
            Until then profiles will not start and pages will not load through the managed
            proxy. Nothing runs without it, so your accounts stay on their own proxy.
          </span>
        </div>
        <div className="modal-actions">
          <button className="btn-bordered" type="button" onClick={() => setOpen(false)}>
            Later
          </button>
          <button className="primary" type="button" onClick={askInDiscord}>
            <Icon name="bubble.left.and.bubble.right.fill" size={13} />
            Ask in Discord
          </button>
        </div>
      </section>
    </div>
  );
}
