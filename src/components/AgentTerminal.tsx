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
  savingWorkflow?: boolean;
  pendingHandoff?: { id: string; text: string };
  handoffToChatRequest?: string;
  onSaveWorkflow: (transcript: string) => void;
  onContinueInChat: (transcript: string) => void;
  onHandoffConsumed: (id: string) => void;
  onChatHandoffConsumed: (id: string) => void;
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

function handoffFingerprint(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\b(?:working|worked for)\s*\([^)]*\)/gi, "working")
    .replace(/\s+/g, " ")
    .trim();
}

export function AgentTerminal({ agentId, agentName, conversationId, workingDir, savingWorkflow, pendingHandoff, handoffToChatRequest, onSaveWorkflow, onContinueInChat, onHandoffConsumed, onChatHandoffConsumed }: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string>();
  const terminalRef = useRef<Terminal>();
  const [status, setStatus] = useState<"starting" | "running" | "exited" | "failed">("starting");
  const [error, setError] = useState<string>();
  const [restartNonce, setRestartNonce] = useState(0);
  const onContinueInChatRef = useRef(onContinueInChat);
  const onHandoffConsumedRef = useRef(onHandoffConsumed);
  const onChatHandoffConsumedRef = useRef(onChatHandoffConsumed);
  const lastTerminalHandoffRef = useRef("");
  onContinueInChatRef.current = onContinueInChat;
  onHandoffConsumedRef.current = onHandoffConsumed;
  onChatHandoffConsumedRef.current = onChatHandoffConsumed;

  const transcript = () => {
    const terminal = terminalRef.current;
    if (!terminal) return "";
    const buffer = terminal.buffer.active;
    const first = Math.max(0, buffer.length - 500);
    const rows: string[] = [];
    for (let index = first; index < buffer.length; index += 1) {
      const line = buffer.getLine(index);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && rows.length > 0) rows[rows.length - 1] += text;
      else rows.push(text);
    }
    return rows.join("\n").trim();
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("starting");
    setError(undefined);
    lastTerminalHandoffRef.current = "";
    let disposed = false;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;
    let lastEscapeAt = 0;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      // Agent CLIs emit their own ANSI colors. Keep even explicit black/dark
      // foreground sequences readable when the app switches theme.
      minimumContrastRatio: 7,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.25,
      scrollback: 10_000,
      theme: activeTerminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    terminalRef.current = terminal;
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.key === "Enter" && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        if (event.type === "keydown" && !event.repeat) {
          const id = terminalIdRef.current;
          // Codex treats LF (the same byte as Ctrl+J) as an editor newline and
          // CR as submit. Suppress every native Shift+Enter event so xterm
          // cannot emit a second, submitting CR after this explicit LF.
          if (id) void invoke("terminal_input", { id, data: "\n" });
        }
        return false;
      }

      if (event.type !== "keydown") return true;

      if (event.key === "Escape") {
        const now = Date.now();
        if (now - lastEscapeAt < 1_000) {
          lastEscapeAt = 0;
          return false;
        }
        lastEscapeAt = now;
      }

      return true;
    });

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
      themeObserver.disconnect();
      input.dispose();
      removeData?.();
      removeExit?.();
      const id = terminalIdRef.current;
      terminalIdRef.current = undefined;
      terminalRef.current = undefined;
      if (id) void invoke("terminal_kill", { id });
      terminal.dispose();
    };
  // A terminal is the interactive state of one chat, not a global agent
  // process. Restart it when the selected conversation changes so pending
  // input, scrollback, or an unfinished prompt cannot leak into another chat.
  }, [agentId, conversationId, workingDir, restartNonce]);

  useEffect(() => {
    const id = terminalIdRef.current;
    if (!pendingHandoff || !id || status !== "running") return;
    // Paste the complete multiline handoff, then submit it once so switching
    // the Settings toggle continues the task without another user action.
    void invoke("terminal_input", { id, data: `\x1b[200~${pendingHandoff.text}\x1b[201~\r` });
    terminalRef.current?.focus();
    onHandoffConsumedRef.current(pendingHandoff.id);
  }, [pendingHandoff?.id, status]);

  useEffect(() => {
    if (!handoffToChatRequest || status !== "running") return;
    const value = transcript();
    const fingerprint = handoffFingerprint(value);
    if (value && fingerprint !== lastTerminalHandoffRef.current) {
      lastTerminalHandoffRef.current = fingerprint;
      onContinueInChatRef.current(value);
    }
    onChatHandoffConsumedRef.current(handoffToChatRequest);
  }, [handoffToChatRequest, status]);

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
        {(status === "exited" || status === "failed") && (
          <button
            className="mini"
            onClick={() => setRestartNonce((value) => value + 1)}
            title={`Restart ${agentName} terminal`}
          >
            Restart
          </button>
        )}
        <button
          className="mini terminal-save-skill"
          disabled={status !== "running" || savingWorkflow}
          onClick={() => {
            const value = transcript();
            if (value) onSaveWorkflow(value);
          }}
          title="Save this terminal browser workflow as a private skill"
        >
          {savingWorkflow && <Spinner size={11} />} {savingWorkflow ? "Preparing…" : "Save as skill"}
        </button>
      </header>
      <div ref={hostRef} className="agent-terminal-host" />
    </section>
  );
}
