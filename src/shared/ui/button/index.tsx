import { forwardRef, type ButtonHTMLAttributes } from 'react';
import './button.css';

/** Text actions with the same hit area and palette in pages and dialogs. */
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function Button({ type = 'button', className = '', ...props }, ref) {
  return <button {...props} ref={ref} type={type} className={`shared-button ${className}`.trim()} />;
});
