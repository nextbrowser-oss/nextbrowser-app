import { useEffect, useState } from "react";
import { useStore } from "../store";
import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
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
  // Keyed by request id, not a bare boolean/string: the poll that refreshes
  // `requests` every 10s can reorder or replace the front of the queue while
  // an approve/reject for the PREVIOUS front request is still in flight. A
  // bare `busy`/`error` would then attach to whatever request is now first,
  // letting someone approve a request they never actually looked at.
  const [busyRequestId, setBusyRequestId] = useState<string | undefined>(undefined);
  const [busyAction, setBusyAction] = useState<"approve" | "reject" | undefined>(undefined);
  const [dismissedId, setDismissedId] = useState<string | undefined>(undefined);
  const [errorFor, setErrorFor] = useState<{ id: string; message: string } | undefined>(undefined);

  const request = requests[0];
  const busy = !!request && busyRequestId === request.id;

  // Escape only hides the prompt: it must never record a decision on the
  // agent's behalf, so a neutral dismiss leaves the request pending.
  useEffect(() => {
    if (!request) return;
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setDismissedId(request.id);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [request]);

  if (!request || dismissedId === request.id) return null;
  const error = errorFor?.id === request.id ? errorFor.message : undefined;

  const names = Array.from({ length: Math.min(request.quantity, 5) }, (_, i) => request.quantity === 1 ? request.name_prefix : `${request.name_prefix}-${i + 1}`);
  const namesPreview = names.join(", ") + (request.quantity > names.length ? `, … (+${request.quantity - names.length} more)` : "");

  const onApprove = async () => {
    const id = request.id;
    setBusyRequestId(id);
    setBusyAction("approve");
    setErrorFor(undefined);
    try {
      await approve(id);
    } catch (e) {
      setErrorFor({ id, message: e instanceof Error ? e.message : "Could not create these profiles. Try again." });
    } finally {
      setBusyRequestId((current) => (current === id ? undefined : current));
      setBusyAction(undefined);
    }
  };

  const onDecline = async () => {
    const id = request.id;
    setBusyRequestId(id);
    setBusyAction("reject");
    setErrorFor(undefined);
    try {
      await reject(id);
    } catch (e) {
      setErrorFor({ id, message: e instanceof Error ? e.message : "Could not decline this request. Try again." });
    } finally {
      setBusyRequestId((current) => (current === id ? undefined : current));
      setBusyAction(undefined);
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
              {` · ${request.runtime === "camoufox" ? "Camoufox" : request.runtime === "dasbrowser" ? "DasBrowser" : "ClawBrowser"}`}
              {request.no_proxy ? " · No proxy (direct connection)" : request.country ? ` · ${request.country}` : ""}
              {request.proxy_scheme ? ` · ${request.proxy_scheme}` : ""}
            </div>
          </div>
        </div>
        <p className="traffic-gate-modal-copy">
          {request.status === "approved" || request.status === "completed" ? "The profiles were created. Retry to finish adding them to this workspace." : "Nothing has been created yet. Approve to create these profiles now, or decline to tell the agent no."}
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
          {request.status === "pending" && <button className="btn-bordered" type="button" disabled={busy} autoFocus onClick={onDecline}>
            <Icon name="xmark" size={13} />
            {busy && busyAction === "reject" ? "Declining…" : "Decline"}
          </button>}
          <button className="primary" type="button" disabled={busy} onClick={onApprove}>
            <Icon name="checkmark" size={13} />
          {busy && busyAction === "approve" ? "Finishing…" : request.status === "approved" || request.status === "completed" ? "Finish adding" : `Create ${request.quantity}`}
          </button>
        </div>
      </section>
    </div>
  );
}
