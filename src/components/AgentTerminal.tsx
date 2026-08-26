import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { invoke, listen } from "../electronBridge";
import { Icon, Spinner } from "./Icon";
import type { ChatAttachment } from "../types";
import { terminalAttachmentContext } from "../lib/chatAttachments";
import { terminalBrowserScopeContext, terminalInputWithDeferredContext, terminalLineBufferAfter } from "../lib/contextHandoff";
import { terminalActivityPreview, terminalAgentReady, terminalInputShouldQueueBeforeReady } from "../lib/terminalReadiness";
import { terminalBrowserSession } from "../lib/terminalBrowserSession";

interface AgentTerminalProps {
  agentId: string;
  agentName: string;
  conversationId?: string;
  workspaceId?: string;
  workingDir?: string;
  browserContext?: string;
  browserProfiles?: Array<{ name: string; runtime: "clawbrowser" | "dasbrowser" | "camoufox"; running: boolean; selected?: boolean; ownerConversationId?: string }>;
  savingWorkflow?: boolean;
  pendingHandoff?: { id: string; text: string };
  handoffToChatRequest?: string;
  onSaveWorkflow: (transcript: string) => void;
  onContinueInChat: (transcript: string) => void;
  onHandoffConsumed: (id: string) => void;
  onChatHandoffConsumed: (id: string) => void;
  onProfileStarted?: (profile: string) => void;
  onProfileStopped?: (profile: string) => void;
  onProfilesRefresh?: () => void;
  onPreviewChange?: (preview?: string) => void;
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

export function AgentTerminal({ agentId, agentName, conversationId, workspaceId, workingDir, browserContext, browserProfiles, savingWorkflow, pendingHandoff, handoffToChatRequest, onSaveWorkflow, onContinueInChat, onHandoffConsumed, onChatHandoffConsumed, onProfileStarted, onProfileStopped, onProfilesRefresh, onPreviewChange }: AgentTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalIdRef = useRef<string>();
  const terminalRef = useRef<Terminal>();
  const [status, setStatus] = useState<"starting" | "running" | "exited" | "failed">("starting");
  const [error, setError] = useState<string>();
  const [restartNonce, setRestartNonce] = useState(0);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string>();
  const onContinueInChatRef = useRef(onContinueInChat);
  const onHandoffConsumedRef = useRef(onHandoffConsumed);
  const onChatHandoffConsumedRef = useRef(onChatHandoffConsumed);
  const onProfileStartedRef = useRef(onProfileStarted);
  const onProfileStoppedRef = useRef(onProfileStopped);
  const onProfilesRefreshRef = useRef(onProfilesRefresh);
  const lastTerminalHandoffRef = useRef("");
  const pendingHandoffRef = useRef(pendingHandoff);
  const browserProfilesRef = useRef(browserProfiles);
  const userInputSinceChatHandoffRef = useRef(false);
  const terminalReadyRef = useRef(false);
  const queuedInputRef = useRef("");
  const inputWriteQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const currentLineInputRef = useRef("");
  const lastBrowserContextRef = useRef(browserContext || "");
  const onPreviewChangeRef = useRef(onPreviewChange);
  const attachmentsRef = useRef(attachments);
  onContinueInChatRef.current = onContinueInChat;
  onHandoffConsumedRef.current = onHandoffConsumed;
  onChatHandoffConsumedRef.current = onChatHandoffConsumed;
  onProfileStartedRef.current = onProfileStarted;
  onProfileStoppedRef.current = onProfileStopped;
  onProfilesRefreshRef.current = onProfilesRefresh;
  onPreviewChangeRef.current = onPreviewChange;
  attachmentsRef.current = attachments;
  pendingHandoffRef.current = pendingHandoff;
  browserProfilesRef.current = browserProfiles;

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
    userInputSinceChatHandoffRef.current = false;
    terminalReadyRef.current = false;
    queuedInputRef.current = "";
    inputWriteQueueRef.current = Promise.resolve();
    currentLineInputRef.current = "";
    lastBrowserContextRef.current = browserContext || "";
    let disposed = false;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;
    let removeProfileStarted: (() => void) | undefined;
    let removeProfileStopped: (() => void) | undefined;
    let lastObservedBrowserSession = "";
    let lastEscapeAt = 0;
    let startupOutput = "";
    let readinessTimer: ReturnType<typeof setTimeout> | undefined;
    let previewTimer: ReturnType<typeof setTimeout> | undefined;

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
    const showContextMenu = (event: MouseEvent) => {
      event.preventDefault();
      void invoke("terminal_context_menu", { text: terminal.getSelection() });
    };
    host.addEventListener("contextmenu", showContextMenu);
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
        const id = terminalIdRef.current;
        // Esc still reaches the interactive agent, while the host also stops
        // any active nextctl/nbc subtree so a cancelled turn cannot keep
        // reopening a browser behind the terminal.
        if (id) void invoke("terminal_interrupt", { id });
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
    const writeInput = (id: string, data: string) => {
      inputWriteQueueRef.current = inputWriteQueueRef.current
        .catch(() => undefined)
        .then(() => invoke("terminal_input", { id, data }));
    };
    const forwardInput = (data: string) => {
      const id = terminalIdRef.current;
      if (!id) return;
      const pending = pendingHandoffRef.current;
      const bufferedMessage = currentLineInputRef.current.trimStart();
      const attachmentContext = terminalAttachmentContext(attachmentsRef.current);
      const scopeContext = bufferedMessage.startsWith("/")
        ? undefined
        : terminalBrowserScopeContext(browserProfilesRef.current ?? []);
      const combinedContext = [scopeContext, pending?.text, attachmentContext].filter(Boolean).join("\n\n") || undefined;
      const attachmentOnlyMessage = attachmentContext && data.includes("\r") && !currentLineInputRef.current
        ? "Please inspect the attached file(s)."
        : currentLineInputRef.current;
      const deferred = terminalInputWithDeferredContext(combinedContext, data, attachmentOnlyMessage);
      if (pending && deferred.consumed) {
        pendingHandoffRef.current = undefined;
        userInputSinceChatHandoffRef.current = true;
        onHandoffConsumedRef.current(pending.id);
      }
      if (attachmentContext && deferred.consumed) setAttachments([]);
      if (deferred.userInput) userInputSinceChatHandoffRef.current = true;
      currentLineInputRef.current = deferred.consumed ? "" : terminalLineBufferAfter(currentLineInputRef.current, data);
      writeInput(id, deferred.data);
    };
    const markReady = () => {
      if (disposed || terminalReadyRef.current) return;
      terminalReadyRef.current = true;
      setStatus("running");
      const queued = queuedInputRef.current;
      queuedInputRef.current = "";
      if (queued) forwardInput(queued);
      requestAnimationFrame(() => {
        resize();
        terminal.focus();
      });
    };
    const input = terminal.onData((data) => {
      if (!terminalReadyRef.current) {
        if (!terminalInputShouldQueueBeforeReady(data)) return;
        queuedInputRef.current = (queuedInputRef.current + data).slice(-64_000);
        return;
      }
      forwardInput(data);
    });

    void (async () => {
      removeData = await listen<[string, string]>("terminal:data", ({ payload: [id, data] }) => {
        if (id !== terminalIdRef.current) return;
        terminal.write(data);
        startupOutput = (startupOutput + data).slice(-64_000);
        // MCP browser starts happen inside the terminal process, outside the
        // Electron command bridge that normally emits profile lifecycle events.
        // Observe the successful session payload and reconcile the sidebar with
        // authoritative nextctl status instead of leaving it visually stopped.
        const observed = terminalBrowserSession(
          startupOutput.slice(-8_000),
          browserProfiles?.map((profile) => profile.name) ?? [],
        );
        if (observed && observed.signal !== lastObservedBrowserSession) {
          lastObservedBrowserSession = observed.signal;
          onProfileStartedRef.current?.(observed.name);
          onProfilesRefreshRef.current?.();
        }
        if (!terminalReadyRef.current && terminalAgentReady(agentId, startupOutput)) markReady();
        if (previewTimer) clearTimeout(previewTimer);
        previewTimer = setTimeout(() => onPreviewChangeRef.current?.(terminalActivityPreview(startupOutput)), 750);
      });
      removeExit = await listen<[string, number, number]>("terminal:exit", ({ payload: [id, exitCode] }) => {
        if (id !== terminalIdRef.current) return;
        if (readinessTimer) clearTimeout(readinessTimer);
        terminalReadyRef.current = true;
        queuedInputRef.current = "";
        terminal.write(`\r\n\x1b[90mProcess exited (${exitCode}).\x1b[0m\r\n`);
        setStatus("exited");
      });
      removeProfileStarted = await listen<[string, string]>("profile:host-started", ({ payload: [profile, ownerId] }) => {
        if (ownerId === conversationId) onProfileStartedRef.current?.(profile);
      });
      removeProfileStopped = await listen<[string, string]>("profile:host-stopped", ({ payload: [profile, ownerId] }) => {
        if (ownerId === conversationId) onProfileStoppedRef.current?.(profile);
      });
      const id = await invoke<string>("terminal_start", {
        agentId,
        conversationId: conversationId || "",
        workspaceId: workspaceId || "",
        workingDir: workingDir || null,
        browserContext: browserContext || "",
        browserProfiles: browserProfiles || [],
        cols: terminal.cols,
        rows: terminal.rows,
      });
      if (disposed) {
        await invoke("terminal_kill", { id });
        return;
      }
      terminalIdRef.current = id;
      await invoke("terminal_ready", { id });
      // Agent CLIs may still be initializing MCP after the PTY transport is
      // ready. Input is queued until their first real prompt appears.
      readinessTimer = setTimeout(markReady, 35_000);
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
      if (readinessTimer) clearTimeout(readinessTimer);
      if (previewTimer) clearTimeout(previewTimer);
      host.removeEventListener("contextmenu", showContextMenu);
      themeObserver.disconnect();
      input.dispose();
      removeData?.();
      removeExit?.();
      removeProfileStarted?.();
      removeProfileStopped?.();
      const id = terminalIdRef.current;
      terminalIdRef.current = undefined;
      terminalRef.current = undefined;
      if (id) void invoke("terminal_kill", { id });
      terminal.dispose();
    };
  // A terminal is the interactive state of one chat, not a global agent
  // process. Restart it when the selected conversation changes so pending
  // input, scrollback, or an unfinished prompt cannot leak into another chat.
  }, [agentId, conversationId, workspaceId, workingDir, restartNonce]);

  const browserProfilesFingerprint = JSON.stringify(browserProfiles ?? []);
  useEffect(() => {
    const id = terminalIdRef.current;
    const nextContext = browserContext || "";
    if (!id || nextContext === lastBrowserContextRef.current) return;
    lastBrowserContextRef.current = nextContext;
    void invoke("terminal_update_context", {
      id,
      workspaceId: workspaceId || "",
      workingDir: workingDir || null,
      browserContext: nextContext,
      browserProfiles: browserProfiles || [],
      conversationId: conversationId || "",
    });
  }, [browserContext, browserProfilesFingerprint, conversationId, status, workspaceId, workingDir]);

  useEffect(() => {
    if (!handoffToChatRequest || status !== "running") return;
    if (!userInputSinceChatHandoffRef.current) {
      onChatHandoffConsumedRef.current(handoffToChatRequest);
      return;
    }
    const value = transcript();
    const fingerprint = handoffFingerprint(value);
    if (value && fingerprint !== lastTerminalHandoffRef.current) {
      lastTerminalHandoffRef.current = fingerprint;
      onContinueInChatRef.current(value);
    }
    userInputSinceChatHandoffRef.current = false;
    onChatHandoffConsumedRef.current(handoffToChatRequest);
  }, [handoffToChatRequest, status]);

  const attachFiles = async () => {
    setAttachmentError(undefined);
    try {
      const selected = await invoke<ChatAttachment[]>("select_terminal_files", {
        conversationId: conversationId || "terminal",
      });
      setAttachments((current) => {
        const byPath = new Map(current.map((file) => [file.path, file]));
        for (const file of selected) byPath.set(file.path, file);
        return [...byPath.values()];
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setAttachmentError(message.replace(/^Error invoking remote method '[^']+': Error:\s*/, ""));
    } finally {
      requestAnimationFrame(() => terminalRef.current?.focus());
    }
  };

  const removeAttachment = async (file: ChatAttachment) => {
    await invoke("remove_terminal_file", { path: file.path });
    setAttachments((current) => current.filter((item) => item.path !== file.path));
    requestAnimationFrame(() => terminalRef.current?.focus());
  };

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
        <button
          className="mini terminal-attach-file"
          disabled={status !== "running"}
          onClick={() => void attachFiles()}
          title="Attach local files to the next terminal prompt"
          aria-label="Attach local files to the next terminal prompt"
        >
          <Icon name="paperclip" size={13} />
        </button>
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
      {attachments.length > 0 && (
        <div className="terminal-attachments" aria-label="Files attached to the next terminal prompt">
          {attachments.map((file) => (
            <span className="attachment-chip" key={file.path} title={file.path}>
              <Icon name="paperclip" size={12} />
              <span>{file.name}</span>
              <button
                className="attachment-remove"
                aria-label={`Remove ${file.name}`}
                onClick={() => void removeAttachment(file)}
              >×</button>
            </span>
          ))}
        </div>
      )}
      {attachmentError && (
        <div className="terminal-attachment-error error small" role="alert">
          {attachmentError}
        </div>
      )}
      <div ref={hostRef} className="agent-terminal-host" />
    </section>
  );
}
