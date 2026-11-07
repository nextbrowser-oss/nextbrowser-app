import { useId, useState } from "react";
import { IconButton, Popover } from "../shared/ui";
import { Icon } from "./Icon";

export function ChatCommands({ ready, remote, onRun }: { ready: boolean; remote: boolean; onRun: (command: string) => void }) {
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const inputId = useId();
  return <Popover label="Run command" open={open} onOpenChange={setOpen} side="top" className="chat-command-popover"
    trigger={props => <IconButton {...props} label="Open commands" appearance="embedded" size="small" text="Commands">
      <Icon name="terminal" size={14} />
    </IconButton>}>
    <form onSubmit={event => {
      event.preventDefault();
      if (!ready || !command.trim()) return;
      onRun(command.trim()); setCommand(""); setOpen(false);
    }}>
      <label className="chat-popover-heading" htmlFor={inputId}>Run command</label>
      <textarea id={inputId} aria-label="Command to run" rows={3} value={command} onChange={event => setCommand(event.target.value)} placeholder="git status" />
      <p>{ready ? `The selected agent runs this ${remote ? "on the selected VPS" : "in this project"} and reports the result in chat.` : "Connect an agent to run commands."}</p>
      <button type="submit" disabled={!ready || !command.trim()}>Run in chat</button>
    </form>
  </Popover>;
}
