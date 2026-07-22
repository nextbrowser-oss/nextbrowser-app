import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke, listen } from "../electronBridge";
import { Icon, Spinner } from "./Icon";

interface AgentTerminalProps {
  agentId: string;
  agentName: string;
  workingDir?: string;
  onClose: () => void;
}

export function AgentTerminal({ agentId, agentName, workingDir, onClose }: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string>();
  const [status, setStatus] = useState<"starting" | "running" | "exited" | "failed">("starting");
  const [error, setError] = useState<string>();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;

    const dark = document.documentElement.dataset.theme !== "light";
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: dark
        ? { background: "#171717", foreground: "#e7e7e7", cursor: "#8b8cff", selectionBackground: "#46466a" }
        : { background: "#fbfbfb", foreground: "#252525", cursor: "#5555d9", selectionBackground: "#cfcff5" },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);

    const resize = () => {
      if (disposed || !host.isConnected || host.clientWidth === 0 || host.clientHeight === 0) return;
      try {
        fit.fit();
        if (terminalIdRef.current) {
          void invoke("terminal_resize", {
            id: terminalIdRef.current,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      } catch {
        // The panel may be between layout passes while opening or closing.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const input = terminal.onData((data) => {
      const id = terminalIdRef.current;
      if (id) void invoke("terminal_input", { id, data });
    });

    void (async () => {
      removeData = await listen<[string, string]>("terminal:data", ({ payload: [id, data] }) => {
        if (id === terminalIdRef.current) terminal.write(data);
      });
      removeExit = await listen<[string, number, number]>("terminal:exit", ({ payload: [id, exitCode] }) => {
        if (id !== terminalIdRef.current) return;
        terminal.write(`\r\n\x1b[90mProcess exited (${exitCode}).\x1b[0m\r\n`);
        setStatus("exited");
      });
      const id = await invoke<string>("terminal_start", {
        agentId,
        workingDir: workingDir || null,
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (disposed) {
        await invoke("terminal_kill", { id });
        return;
      }
      terminalIdRef.current = id;
      await invoke("terminal_ready", { id });
      setStatus("running");
      requestAnimationFrame(() => {
        resize();
        terminal.focus();
      });
    })().catch((reason) => {
      if (disposed) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      setStatus("failed");
      terminal.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    });

    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      removeData?.();
      removeExit?.();
      const id = terminalIdRef.current;
      terminalIdRef.current = undefined;
      if (id) void invoke("terminal_kill", { id });
      terminal.dispose();
    };
  }, [agentId, workingDir]);

  return (
    <section className="agent-terminal-panel" aria-label={`${agentName} terminal`}>
      <header className="agent-terminal-header">
        <Icon name="terminal" size={13} />
        <strong>{agentName} terminal</strong>
        <span className="experimental-pill">Experimental</span>
        <span className="spacer" />
        {status === "starting" && <Spinner size={12} />}
        {status === "running" && <span className="terminal-status-dot" title="Running" />}
        {status === "exited" && <span className="muted small">Exited</span>}
        {status === "failed" && <span className="error small" title={error}>Failed</span>}
        <button className="plain-icon-btn plain-icon-btn-compact" onClick={onClose} title="Close terminal" aria-label="Close terminal">
          <Icon name="xmark" size={13} />
        </button>
      </header>
      <div ref={hostRef} className="agent-terminal-host" />
    </section>
  );
}
