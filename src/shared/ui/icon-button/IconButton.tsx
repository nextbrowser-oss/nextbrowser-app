import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Tooltip } from "../tooltip";
import "./iconButton.css";

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "aria-label" | "children"> {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  size?: "small" | "medium";
  appearance?: "glass" | "embedded";
}

/** Accessible circular action. Icons come from the caller; the surface and hint are shared. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label, hint, children, size = "medium", appearance = "glass", className = "", type = "button", ...props
}, ref) {
  return (
    <Tooltip content={hint ?? label}>
      <button {...props} ref={ref} type={type} aria-label={label}
        className={`shared-icon-button shared-icon-button--${size} shared-icon-button--${appearance} ${className}`.trim()}>
        {children}
      </button>
    </Tooltip>
  );
});
