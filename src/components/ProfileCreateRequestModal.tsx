import { useState } from "react";
import { useStore } from "../store";
import { Icon } from "./Icon";

/**
 * An agent cannot create browser profiles by itself inside a NextBrowser
 * workspace — profiles map to real proxy allocations, so nbc refuses
 * profiles_create there and routes the agent through profiles_create_request
 * instead. This modal is where that request actually gets a decision: it
 * surfaces the batch the agent asked for (a name prefix and a quantity) and
 * lets the person approve or decline it. Nothing is created until Approve.
 */
export function ProfileCreateRequestModal() {
  const requests = useStore((s) => s.pendingProfileCreateRequests);
  const approve = useStore((s) => s.approveProfileCreateRequest);
  const reject = useStore((s) => s.rejectProfileCreateRequest);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const request = requests[0];
  if (!request) return null;

  const names = Array.from({ length: Math.min(request.quantity, 5) }, (_, i) => `${request.name_prefix}-${i + 1}`);
  const namesPreview = names.join(", ") + (request.quantity > names.length ? `, … (+${request.quantity - names.length} more)` : "");

  const onApprove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await approve(request.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create these profiles. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await reject(request.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decline this request. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay">
      <section
        aria-labelledby="profile-create-request-title"
        aria-modal="true"
        className="modal-card"
        role="alertdialog"
      >
        <div className="modal-title-row">
          <Icon name="person.2.fill" size={18} />
          <div>
            <strong id="profile-create-request-title">
              An agent wants to create {request.quantity} profile{request.quantity === 1 ? "" : "s"}
            </strong>
            <div className="muted small">
              {namesPreview}
              {request.country ? ` · ${request.country}` : ""}
              {request.proxy_scheme ? ` · ${request.proxy_scheme}` : ""}
            </div>
          </div>
        </div>
        <p className="traffic-gate-modal-copy">
          Nothing has been created yet. Approve to create these profiles now, or decline to tell
          the agent no.
        </p>
        {requests.length > 1 && (
          <div className="muted small">{requests.length - 1} more request{requests.length - 1 === 1 ? "" : "s"} waiting after this one.</div>
        )}
        {error && (
          <div className="traffic-gate-modal-effect">
            <Icon name="exclamationmark.triangle.fill" size={14} />
            <span>{error}</span>
          </div>
        )}
        <div className="modal-actions">
          <button className="btn-bordered" type="button" disabled={busy} onClick={onDecline}>
            <Icon name="xmark" size={13} />
            Decline
          </button>
          <button className="primary" type="button" disabled={busy} onClick={onApprove}>
            <Icon name="checkmark" size={13} />
            {busy ? "Creating…" : `Create ${request.quantity}`}
          </button>
        </div>
      </section>
    </div>
  );
}
