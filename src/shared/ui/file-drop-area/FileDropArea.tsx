import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import "./fileDropArea.css";

const containsFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes("Files") || event.dataTransfer.files.length > 0;

/** File-only drop feedback; the caller owns attachment processing and storage. */
export function FileDropArea({ children, onFiles, disabled = false, className = "", label = "Drop files to attach", unavailableLabel = "File attachments are unavailable" }: {
  children: ReactNode;
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
  unavailableLabel?: string;
}) {
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const reset = useCallback(() => { depth.current = 0; setDragging(false); }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !depth.current) return;
      event.preventDefault(); event.stopPropagation(); reset();
    };
    window.addEventListener("drop", reset);
    window.addEventListener("dragend", reset);
    window.addEventListener("blur", reset);
    window.addEventListener("keydown", escape, true);
    return () => {
      window.removeEventListener("drop", reset);
      window.removeEventListener("dragend", reset);
      window.removeEventListener("blur", reset);
      window.removeEventListener("keydown", escape, true);
    };
  }, [reset]);
  return (
    <div className={`file-drop-area ${className}`.trim()} data-file-drag={dragging ? disabled ? "unavailable" : "active" : undefined}
      onDragEnter={event => {
        if (!containsFiles(event)) return;
        event.preventDefault(); depth.current += 1; setDragging(true);
      }}
      onDragOver={event => {
        if (!containsFiles(event)) return;
        event.preventDefault(); event.dataTransfer.dropEffect = disabled ? "none" : "copy";
      }}
      onDragLeave={() => { depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); }}
      onDrop={event => {
        if (!containsFiles(event)) return;
        event.preventDefault(); event.stopPropagation(); reset();
        if (!disabled && event.dataTransfer.files.length) onFiles(Array.from(event.dataTransfer.files));
      }}>
      {children}
      {dragging && <div className="file-drop-area__indicator" role="status" aria-live="polite">
        <span>{disabled ? unavailableLabel : label}</span>
      </div>}
    </div>
  );
}
