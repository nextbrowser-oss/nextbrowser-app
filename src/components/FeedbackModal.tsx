import { useState } from "react";
import { invoke } from "../electronBridge";
import { Icon, Spinner } from "./Icon";

const RATING_LABELS = ["Very poor", "Poor", "Okay", "Good", "Excellent"];

export function FeedbackModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted?: (rating: number) => void }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  const displayedRating = hoverRating ?? rating;

  const submit = async () => {
    if (!rating || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await invoke("feedback_submit", { rating, comment });
      setStatus("sent");
      onSubmitted?.(rating);
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "We couldn't send your feedback. Please try again.");
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={status === "sending" ? undefined : onClose}>
      <section className="modal-card feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-title-row">
          <Icon name="bubble.left.and.bubble.right.fill" size={18} />
          <div>
            <strong id="feedback-title">How is NextBrowser?</strong>
            <div className="muted small">Your rating and note go directly to the product team.</div>
          </div>
          <span className="spacer" />
          {status !== "sending" && <button className="plain-icon-btn" onClick={onClose} aria-label="Close feedback"><Icon name="xmark" size={16} /></button>}
        </div>
        {status === "sent" ? (
          <div className="feedback-success" role="status">
            <Icon name="checkmark.circle.fill" size={30} className="ok" />
            <strong>Thank you — your feedback was sent.</strong>
            <p className="muted small">It helps us decide what to improve next.</p>
            <button className="primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            <div
              className="feedback-rating"
              role="radiogroup"
              aria-label="Rate NextBrowser from one to five"
              onMouseLeave={() => setHoverRating(null)}
            >
              {RATING_LABELS.map((label, index) => {
                const value = index + 1;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={rating === value}
                    className={
                      "feedback-star" +
                      (value <= displayedRating ? " is-preview" : "") +
                      (hoverRating === null && value <= rating ? " is-selected" : "") +
                      (value === hoverRating ? " is-hovered" : "")
                    }
                    onMouseEnter={() => setHoverRating(value)}
                    onFocus={() => setHoverRating(value)}
                    onBlur={() => setHoverRating(null)}
                    onClick={() => setRating(value)}
                    title={`${value}: ${label}`}
                  >
                    <Icon name="star.fill" size={26} fill="currentColor" />
                  </button>
                );
              })}
            </div>
            <div className="feedback-rating-label">{displayedRating ? `${displayedRating}/5 · ${RATING_LABELS[displayedRating - 1]}` : "Choose a rating"}</div>
            <label className="feedback-comment">
              <span>Tell us more <em>(optional)</em></span>
              <textarea value={comment} maxLength={2_000} rows={4} placeholder="What worked well, or what should we improve?" onChange={(event) => setComment(event.target.value)} />
              <small>{comment.length} / 2000</small>
            </label>
            {error && <p className="error small feedback-error" role="alert">{error}</p>}
            <div className="modal-actions">
              <button className="secondary" onClick={onClose} disabled={status === "sending"}>Cancel</button>
              <span className="spacer" />
              <button className="primary" onClick={() => void submit()} disabled={!rating || status === "sending"}>{status === "sending" ? <><Spinner size={13} /> Sending…</> : "Send feedback"}</button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
