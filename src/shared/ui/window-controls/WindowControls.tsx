import { IconButton } from "../icon-button";
import { Glyph } from "../glyph";
import "./windowControls.css";

/** Renderer-owned caption actions; platform integration belongs to the caller. */
export function WindowControls({ canRestore, onMinimize, onToggleMaximize, onClose }: {
  canRestore: boolean;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  return <div className="shared-window-controls" role="group" aria-label="Window controls">
    <IconButton appearance="plain" size="small" label="Minimize window" onClick={onMinimize}><Glyph name="minus" size={15} /></IconButton>
    <IconButton appearance="plain" size="small" label={canRestore ? "Restore window" : "Maximize window"} onClick={onToggleMaximize}><Glyph name={canRestore ? "copy" : "square"} size={14} /></IconButton>
    <IconButton appearance="plain" size="small" className="shared-window-close" label="Close window" onClick={onClose}><Glyph name="x" size={17} /></IconButton>
  </div>;
}
