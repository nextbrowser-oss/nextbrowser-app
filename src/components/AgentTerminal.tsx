import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke, listen } from "../electronBridge";
import { Icon, Spinner } from "./Icon";

interface AgentTerminalProps {
  agentId: string;
  agentName: string;
  conversationId?: string;
  workingDir?: string;
  browserEngine?: boolean;
  selectedProfile?: string;
  onClose: () => void;
}

const DARK_TERMINAL_THEME = {
  background: "#181818",
  foreground: "#d9d9dc",
  cursor: "#a5a6ff",
  cursorAccent: "#181818",
  selectionBackground: "#55578080",
  black: "#242426",
  red: "#ef6b73",
  green: "#61c98b",
  yellow: "#d7b76a",
  blue: "#7697e8",
  magenta: "#b48cdb",
  cyan: "#64b8c5",
  white: "#d9d9dc",
  brightBlack: "#85858d",
  brightRed: "#ff848b",
  brightGreen: "#78dda0",
  brightYellow: "#e9cb80",
  brightBlue: "#91aff5",
  brightMagenta: "#c8a2ec",
  brightCyan: "#7bcbd6",
  brightWhite: "#f4f4f5",
};

const LIGHT_TERMINAL_THEME = {
  background: "#f7f7f8",
  foreground: "#29292d",
  cursor: "#5555d9",
  cursorAccent: "#f7f7f8",
  selectionBackground: "#b9baf080",
  black: "#29292d",
  red: "#b52c39",
  green: "#247a48",
  yellow: "#86630b",
  blue: "#355fb3",
  magenta: "#7745a2",
  cyan: "#17717d",
  white: "#e8e8ea",
  brightBlack: "#707078",
  brightRed: "#cf3e49",
  brightGreen: "#318e56",
  brightYellow: "#987316",
  brightBlue: "#4972c7",
  brightMagenta: "#8b59b5",
  brightCyan: "#25838f",
  brightWhite: "#ffffff",
};

function activeTerminalTheme() {
  return document.documentElement.dataset.theme === "light"
    ? LIGHT_TERMINAL_THEME
    : DARK_TERMINAL_THEME;
}

export function AgentTerminal({ agentId, agentName, conversationId, workingDir, browserEngine, selectedProfile, onClose }: AgentTerminalProps) {
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

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: activeTerminalTheme(),
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
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = activeTerminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
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
      const engine = browserEngine
        ? await invoke<{ command: string; cdpUrl: string }>("browser_engine_prepare", { profile: selectedProfile || null })
        : null;
      const id = await invoke<string>("terminal_start", {
        agentId,
        workingDir: workingDir || null,
        cols: terminal.cols,
        rows: terminal.rows,
        browserEngine: engine,
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
      themeObserver.disconnect();
      input.dispose();
      removeData?.();
      removeExit?.();
      const id = terminalIdRef.current;
      terminalIdRef.current = undefined;
      if (id) void invoke("terminal_kill", { id });
      terminal.dispose();
    };
  // A terminal is the interactive state of one chat, not a global agent
  // process. Restart it when the selected conversation changes so pending
  // input, scrollback, or an unfinished prompt cannot leak into another chat.
  }, [agentId, browserEngine, conversationId, selectedProfile, workingDir]);

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
