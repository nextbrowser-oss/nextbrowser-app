import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useStore } from "../store";
import { entityNameLimits } from "../lib/entityValidation";
import { sessionName } from "../lib/sessionTitle";
import { IconButton, Tooltip } from "../shared/ui";
import { Icon } from "./Icon";

export function SessionTitle() {
  const session = useStore(state => state.activeConversation());
  if (!session) return <span className="session-name-empty">New session</span>;
  return <EditableTitle key={session.id} id={session.id} name={sessionName(session)} />;
}

function EditableTitle({ id, name }: { id: string; name: string }) {
  const [draft, setDraft] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  function finish() {
    setDraft(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  if (draft === undefined) return <Tooltip content={`Rename session · ${name}`}>
    <button type="button" ref={trigger} className="session-name-trigger" aria-label={`Rename session: ${name}`}
      onClick={() => setDraft(name)}><span>{name}</span><Pencil size={12} aria-hidden="true" /></button>
  </Tooltip>;
  return <form className="session-name-form" onSubmit={event => {
    event.preventDefault();
    if (!draft.trim()) return;
    useStore.getState().renameSession(id, draft);
    finish();
  }}>
    <input aria-label="Session name" autoFocus onFocus={event => event.target.select()}
      maxLength={entityNameLimits.session} value={draft} onChange={event => setDraft(event.target.value)}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); } }} />
    <IconButton label="Save session name" type="submit" size="small" appearance="plain" disabled={!draft.trim()}><Icon name="checkmark" size={13} /></IconButton>
    <IconButton label="Cancel rename" size="small" appearance="plain" onClick={finish}><Icon name="xmark" size={13} /></IconButton>
  </form>;
}
