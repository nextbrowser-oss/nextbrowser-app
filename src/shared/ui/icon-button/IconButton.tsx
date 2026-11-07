import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "../tooltip";
import "./iconButton.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label" | "children"> {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  text?: string;
  size?: "small" | "medium";
  appearance?: "glass" | "embedded";
}

/** Compact icon action, optionally a labelled pill. Surface and hint are shared. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label, hint, children, text, size = "medium", appearance = "glass", className = "", type = "button", ...props
}, ref) {
  return (
    <Tooltip content={hint ?? label}>
      <button {...props} ref={ref} type={type} aria-label={label}
        className={`shared-icon-button shared-icon-button--${size} shared-icon-button--${appearance}${text ? " shared-icon-button--labelled" : ""} ${className}`.trim()}>
        {children}
        {text && <span>{text}</span>}
      </button>
    </Tooltip>
  );
});
