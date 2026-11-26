import { translate } from "../shared/lib/i18n";
import { useRef, useState } from "react";
import { Angry, Frown, Laugh, Meh, Smile } from "lucide-react";
import { invoke } from "../electronBridge";
import { feedbackErrorMessage } from "../lib/feedbackError";
import { Button, Dialog } from "../shared/ui";
import { Icon, Spinner } from "./Icon";
import "./feedback.css";

const RATINGS = [
  { get label() { return translate("Very poor"); }, Face: Angry },
  { get label() { return translate("Poor"); }, Face: Frown },
  { get label() { return translate("Okay"); }, Face: Meh },
  { get label() { return translate("Good"); }, Face: Smile },
  { get label() { return translate("Excellent"); }, Face: Laugh },
];
const NOTE_LIMIT = 2_000;

export function FeedbackModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted?: (rating: number) => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const pending = useRef(false);
  const sending = status === "sending";

  const submit = async () => {
    if (!rating || pending.current || status !== "idle") return;
    pending.current = true;
    setStatus("sending");
    setError("");
    try {
      await invoke("feedback_submit", { rating, comment });
    } catch (cause) {
      pending.current = false;
      setStatus("idle");
      setError(feedbackErrorMessage(cause));
      return;
    }
    setStatus("sent");
    onSubmitted?.(rating);
  };

  return (
    <Dialog title={translate("Feedback")} className="feedback-dialog" onClose={onClose} dismissible={!sending}>
      {status === "sent" ? (
        <div className="feedback-confirmation">
          <div className="feedback-receipt" role="status">
            <span className="feedback-receipt-icon"><Icon name="checkmark.circle.fill" size={30} /></span>
            <h3>{translate("Thanks for your feedback!")}</h3>
            <p>{translate("The Nextbrowser team received your response.")}</p>
          </div>
          <Button className="primary" autoFocus onClick={onClose}>{translate("Done")}</Button>
        </div>
      ) : (
        <form className="feedback-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <fieldset className="feedback-rating" disabled={sending}>
            <legend>{translate("How was your experience?")}</legend>
            <div className="feedback-options">
              {RATINGS.map(({ label, Face }, index) => (
                <label className="feedback-choice" key={label}>
                  <input type="radio" name="feedback-rating" value={index + 1} checked={rating === index + 1}
                    onChange={() => setRating(index + 1)} />
                  <Face aria-hidden="true" size={25} strokeWidth={1.7} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="feedback-note">
            <span className="feedback-note-heading">{translate("Anything to add?")} <small>{translate("Optional")}</small></span>
            <span className="feedback-note-box">
              <textarea rows={3} maxLength={NOTE_LIMIT} value={comment} disabled={sending}
                placeholder={translate("What worked well? What could be better?")} onChange={event => setComment(event.target.value)} />
              {comment.length > 0 && <small className="feedback-count" aria-hidden="true">{comment.length} / {NOTE_LIMIT}</small>}
            </span>
          </label>
          {error && <p className="feedback-error" role="alert">{error}</p>}
          <footer className="feedback-footer">
            <p>{translate("Your account email is shared with the Nextbrowser team.")}</p>
            <Button type="submit" className="primary" disabled={!rating || sending}>
              {sending ? <Spinner size={15} /> : <Icon name="paperplane.fill" size={15} />}
              {sending ? translate("Sending…") : translate("Send feedback")}
            </Button>
          </footer>
        </form>
      )}
    </Dialog>
  );
}
