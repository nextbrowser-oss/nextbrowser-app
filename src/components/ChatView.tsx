import { CommandList, FileDropArea, IconButton, OverlayScrollArea, Tooltip } from "../shared/ui";
import "./chat.css";
import { type ClipboardEvent, useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import { SCRIPTS } from "../skillsCatalog";
import { MarkdownText } from "./MarkdownText";
import { Icon, Spinner } from "./Icon";
import type { ChatAttachment, ChatMessage } from "../types";
import { filePathForFile, invoke } from "../electronBridge";
import { AGENTS, agentById, agentInvocation, isBuiltinAgent, type AgentSpec } from "../agents";
import { OPEN_AGENT_SETTINGS_EVENT } from "../lib/appNavigation";
import { trackEvent } from "../lib/analytics";
import { needsSupportLink } from "../lib/userFacingError";
import { userFacingBrowserError } from "../lib/userFacingBrowserError";
import { UserFacingError } from "./UserFacingError";
import { AgentInstallLink } from "./AgentInstallLink";
import { takeGuideDraft } from "../lib/guideDraft";
import { entityNameLimits } from "../lib/entityValidation";
import { shouldDismissModalWithEscape } from "../lib/modalKeyboard";
import { RecentProjects } from "./RecentProjects";
import { matchingAgentChatCommands, parseAgentChatCommand } from "../lib/agentChatCommands";
import { uid } from "../lib/ids";
import {
  capturedWorkflowDomain,
  workflowInstructions,
  workflowQuality,
  workflowTitle,
  workflowCapability,
  workflowRecipe,
} from "../lib/workflowCapture";
import {
  parseDistilledWorkflow,
  workflowDistillationPrompt,
  type DistilledWorkflow,
} from "../lib/workflowDistillation";
import { chatPromptWithDeferredContext, terminalToChatHandoff } from "../lib/contextHandoff";
import {
  MULTILOGIN_SELECTION_EVENT,
  activeMultiloginSelectionForWorkspace,
  type MultiloginProfileSelection,
} from "../lib/multiloginSelection";
import { MultiloginChatProfilePicker } from "./MultiloginChatProfilePicker";

async function authorWorkflowWithAgent(agent: AgentSpec, workingDir: string, fallback: DistilledWorkflow): Promise<DistilledWorkflow | undefined> {
  const prompt = workflowDistillationPrompt(fallback);
  const invocation = agentInvocation(agent, prompt);
  const { args, stdin } = agent.id === "codex"
    ? { args: ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "-"], stdin: prompt }
    : agent.id === "claude"
      ? { args: ["-p", "--permission-mode", "dontAsk", "--tools", ""], stdin: prompt }
      : invocation;
  try {
    const result = await invoke<{ code: number; stdout: string }>("workflow_author_run", {
      agentId: agent.id, binary: agent.binary, envVar: agent.envVar, args,
      stdinText: stdin ?? null, workingDir: workingDir || null,
    });
    return result.code === 0 ? parseDistilledWorkflow(result.stdout, fallback) : undefined;
  } catch {
    return undefined;
  }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(m: ChatMessage): string {
  switch (m.status) {
    case "queued":
      return "Queued";
    case "streaming":
      return m.activityLabel ?? "Streaming…";
    case "done":
      return "agent";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Stopped";
    case "timedOut":
      return "Timed out";
    default:
      return "";
  }
}

// Condense a long agent error into a one-line summary for the collapsed view.
function errorSummary(text: string): string {
  const firstMeaningful =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && l !== "…[earlier output truncated]") ?? text.trim();
  const cleaned = firstMeaningful.replace(/^\[[^\]]*error\]\s*/i, "").replace(/^\[error\]\s*/i, "");
  return cleaned.length > 140 ? cleaned.slice(0, 140) + "…" : cleaned;
}


export function ChatView() {
  const s = useStore();
  const agentId = s.agentId;
  const builtinAgent = isBuiltinAgent(agentId);
  const conv = s.activeConversation();
  const messages = conv?.messages ?? [];
  const remoteOnly = conv?.executionTarget === "vps";
  const ready = s.agentReady();
  const agentDetected = !!s.agentVersion();
  const agentNeedsLogin = agentDetected && s.agentLoggedIn() === false;
  const agentError = s.agentError();
  // Scope the running state to the active conversation: an agent-global reply
  // in another chat must not hide this composer's Send button.
  const runningReplyId = s.runtime[agentId]?.runningReplyId;
  const running = !!runningReplyId && messages.some((message) => message.id === runningReplyId);
  const latestCompletedAssistantId = [...messages].reverse().find((message) =>
    message.role === "assistant" && message.status === "done" && message.text.trim(),
  )?.id;

  const [draft, setDraft] = useState("");
  const [guideDraftLoaded, setGuideDraftLoaded] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [scriptOpen, setScriptOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [commandNotice, setCommandNotice] = useState<string>();
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [commandIndex, setCommandIndex] = useState(0);
  const commandMenuId = useId();
  const commandMatches = commandMenuDismissed ? [] : matchingAgentChatCommands(draft);
  const activeCommand = commandMatches[Math.min(commandIndex, commandMatches.length - 1)];
  const [editingReply, setEditingReply] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [actionError, setActionError] = useState<string>();
  const [promptDetail, setPromptDetail] = useState<string | null>(null);
  const [projectCreatorOpen, setProjectCreatorOpen] = useState(false);
  const [projectAgentId, setProjectAgentId] = useState(s.agentId);
  const [projectName, setProjectName] = useState("");
  const [workflowDraft, setWorkflowDraft] = useState<{ task: string; answer: ChatMessage; prepared: DistilledWorkflow } | null>(null);
  const [preparingWorkflowId, setPreparingWorkflowId] = useState<string | null>(null);
  const [workflowRejection, setWorkflowRejection] = useState<string | null>(null);
  const [multiloginSelection, setMultiloginSelection] = useState<MultiloginProfileSelection>();

  useEffect(() => {
    const refreshSelection = () => setMultiloginSelection(activeMultiloginSelectionForWorkspace(conv?.workspaceId));
    refreshSelection();
    window.addEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
    return () => window.removeEventListener(MULTILOGIN_SELECTION_EVENT, refreshSelection);
  }, [conv?.workspaceId]);

  useEffect(() => {
    const openProjectCreator = () => {
      setProjectAgentId(useStore.getState().agentId);
      setProjectName("");
      setProjectCreatorOpen(true);
    };
    window.addEventListener("nextbrowser:create-project", openProjectCreator);
    return () => window.removeEventListener("nextbrowser:create-project", openProjectCreator);
  }, []);
  useEffect(() => {
    if (!projectCreatorOpen) return;
    const dismissProjectCreator = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setProjectCreatorOpen(false);
    };
    window.addEventListener("keydown", dismissProjectCreator);
    return () => window.removeEventListener("keydown", dismissProjectCreator);
  }, [projectCreatorOpen]);
  const legacyContextSent = useRef(new Set<string>());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scriptWrapRef = useRef<HTMLDivElement>(null);
  const scriptMenuRef = useRef<HTMLDivElement>(null);
  const conversationKey = `${agentId}:${conv?.id ?? "new"}`;

  useEffect(() => {
    // Pending attachments and an unsent draft belong to the previous chat.
    setAttachments([]);
    setDraft("");
    setGuideDraftLoaded(false);
    setProjectMenuOpen(false);
    setCommandNotice(undefined);
    setCommandMenuDismissed(false);
    // Menus and workflow modals belong to the chat they were opened in.
    setScriptOpen(false);
    setWorkflowDraft(null);
    setWorkflowRejection(null);
  }, [conversationKey]);

  useEffect(() => {
    if (!editingReply) return;
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setActionError(undefined);
      setEditingReply(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [editingReply]);

  useEffect(() => {
    if (promptDetail === null) return;
    const dismiss = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setPromptDetail(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [promptDetail]);

  useEffect(() => {
    if (!scriptOpen) return;
    const dismissOutside = (event: PointerEvent) => {
      if (scriptWrapRef.current?.contains(event.target as Node)) return;
      setScriptOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (!shouldDismissModalWithEscape(event)) return;
      event.preventDefault();
      setScriptOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    window.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      window.removeEventListener("keydown", dismissWithEscape);
    };
  }, [scriptOpen]);

  useEffect(() => {
    const stageDraft = (value: string) => {
      const next = value.trim();
      if (!next) return;
      setDraft(next);
      setGuideDraftLoaded(true);
      window.requestAnimationFrame(() => composerRef.current?.focus());
    };
    const stored = takeGuideDraft(localStorage);
    if (stored) stageDraft(stored);
    const onGuideDraft = (event: Event) => {
      const staged = takeGuideDraft(localStorage);
      if (event instanceof CustomEvent) stageDraft(staged ?? String(event.detail ?? ""));
    };
    window.addEventListener("nextbrowser:guide-draft", onGuideDraft);
    return () => window.removeEventListener("nextbrowser:guide-draft", onGuideDraft);
  }, []);

  const enqueueInChat = (text: string, files: ChatAttachment[] = []) => {
    const previous = !legacyContextSent.current.has(conversationKey) && conv?.terminalPreview
      ? terminalToChatHandoff(conv.terminalPreview, s.selectedProfile) : undefined;
    s.enqueue(text, undefined, undefined, files, chatPromptWithDeferredContext(previous, text));
    if (previous) legacyContextSent.current.add(conversationKey);
  };
  const acceptCommand = (name: string) => {
    setDraft("/" + name + " "); setCommandMenuDismissed(true); composerRef.current?.focus();
  };
  const runChatCommand = (parsed: NonNullable<ReturnType<typeof parseAgentChatCommand>>) => {
    setActionError(undefined); setCommandNotice(undefined);
    if (attachments.length) { setActionError("Send or remove attached files before using a chat command."); return; }
    const { name, args, rawName } = parsed;
    if (!name) { setActionError("/" + rawName + " is not supported by this chat adapter. Use /help for available commands."); return; }
    if (args && !["new", "title", "help"].includes(name)) { setActionError("Use /" + name + " without arguments in this chat."); return; }
    switch (name) {
      case "help": setDraft("/" + args); setCommandMenuDismissed(false); setCommandIndex(0); window.requestAnimationFrame(() => composerRef.current?.focus()); return;
      case "new": {
        const id = s.newChat();
        if (args) s.renameConversation(id, args.slice(0, entityNameLimits.project));
        break;
      }
      case "sessions": setProjectMenuOpen(true); break;
      case "title":
        if (args && conv) s.renameConversation(conv.id, args.slice(0, entityNameLimits.project));
        else setCommandNotice("Project: " + (conv?.title ?? "New project"));
        break;
      case "stop":
        if (running) s.stopRunning();
        else setCommandNotice("This project has no running response.");
        break;
      case "retry": {
        if (running) { setActionError("Wait for this response or use /stop before retrying."); return; }
        const last = [...messages].reverse().find(message => message.role === "user");
        if (!last) { setActionError("There is no user message to retry yet."); return; }
        enqueueInChat(last.text, last.attachments); break;
      }
      case "history": composerRef.current?.closest(".chat")?.querySelector<HTMLElement>(".messages")?.scrollTo({ top: 0 }); break;
      case "model": case "config": openAgentSettings(); break;
      case "skills": s.setTab("skills"); break;
      case "scripts": setScriptOpen(true); break;
      case "usage": s.setTab("usage"); break;
      case "version": setCommandNotice(agentById(agentId).name + ": " + (s.agentVersion() ?? "not connected")); break;
      case "status": setCommandNotice(agentById(agentId).name + " · " + (running ? "responding" : ready ? "ready" : "not connected") + " · " + s.queuedCount() + " queued"); break;
    }
    setDraft(""); setGuideDraftLoaded(false); setCommandMenuDismissed(true);
  };
  const send = () => {
    const t = draft.trim();
    if (!t && attachments.length === 0) return;
    if (t === "/") { setCommandMenuDismissed(false); return; }
    const parsed = parseAgentChatCommand(t);
    if (parsed) { runChatCommand(parsed); return; }
    setCommandNotice(undefined);
    setActionError(undefined);
    const visiblePrompt = t || "Please inspect the attached file(s).";
    setDraft("");
    setGuideDraftLoaded(false);
    enqueueInChat(visiblePrompt, attachments);
    setAttachments([]);
  };

  const attachFiles = async () => {
    setActionError(undefined);
    try {
      const selected = await invoke<ChatAttachment[]>("select_chat_files");
      trackEvent("chat_files_selected", {
        attachment_count: selected.length,
        total_size_bucket: Math.min(
          100_000_000,
          Math.ceil(selected.reduce((total, file) => total + file.size, 0) / 1_000_000) * 1_000_000,
        ),
      });
      setAttachments((current) => {
        const byPath = new Map(current.map((file) => [file.path, file]));
        for (const file of selected) byPath.set(file.path, file);
        return [...byPath.values()];
      });
    } catch {
      setActionError("Could not attach files. Try again.");
    }
  };

  const addAttachmentFiles = (files: Iterable<File>, source: "paste" | "drop") => {
    const next: ChatAttachment[] = [];
    for (const file of files) {
      const path = filePathForFile(file);
      if (!path) continue;
      next.push({ name: file.name || path.split(/[\\/]/).pop() || "file", path, size: file.size });
    }
    if (!next.length) return false;
    trackEvent("chat_files_selected", {
      source,
      attachment_count: next.length,
      total_size_bucket: Math.min(
        100_000_000,
        Math.ceil(next.reduce((total, file) => total + file.size, 0) / 1_000_000) * 1_000_000,
      ),
    });
    setAttachments((current) => {
      const byPath = new Map(current.map((file) => [file.path, file]));
      for (const file of next) byPath.set(file.path, file);
      return [...byPath.values()];
    });
    return true;
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.length) return;
    if (addAttachmentFiles(files, "paste")) event.preventDefault();
  };

  const handleDroppedFiles = (files: File[]) => {
    setActionError(undefined);
    if (!addAttachmentFiles(files, "drop")) setActionError("Could not attach these files. Try the Attach button.");
  };

  const looksLikeDomain = (text: string) =>
    text.length > 0 && text.length <= 100 && !text.includes(" ") && text.includes(".");

  const customScripts = s.customScripts;
  const officialScripts = [...SCRIPTS, ...s.appliedScripts].filter(
    (script, index, all) => all.findIndex((candidate) => candidate.id === script.id) === index,
  );
  useLayoutEffect(() => {
    if (!scriptOpen) return;
    const anchor = scriptWrapRef.current;
    const menu = scriptMenuRef.current;
    const area = anchor?.closest(".overlay-scroll-area");
    if (!anchor || !menu || !area) return;
    const place = () => {
      const trigger = anchor.getBoundingClientRect();
      const bounds = area.getBoundingClientRect();
      const left = Math.max(8, bounds.left + 8);
      const right = Math.min(window.innerWidth - 8, bounds.right - 8);
      menu.style.setProperty("--script-menu-width", `${Math.max(0, right - left)}px`);
      menu.style.setProperty("--script-menu-room", `${Math.max(0, trigger.top - Math.max(8, bounds.top + 8) - 8)}px`);
      const x = Math.max(left, Math.min(trigger.left, right - menu.offsetWidth));
      menu.style.setProperty("--script-menu-shift", `${x - trigger.left}px`);
    };
    place();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(place);
    observer?.observe(area);
    window.addEventListener("resize", place);
    return () => { observer?.disconnect(); window.removeEventListener("resize", place); };
  }, [scriptOpen, officialScripts.length, customScripts.length]);
  const openScriptCreator = () => {
    setScriptOpen(false);
    localStorage.setItem("openMyScriptsEditor", "1");
    s.setTab("skills");
  };
  const queuedReplyForMessage = (message: ChatMessage): ChatMessage | undefined => {
    if (message.role === "assistant") return message.status === "queued" ? message : undefined;
    if (message.role !== "user") return undefined;
    const index = messages.findIndex((candidate) => candidate.id === message.id);
    const next = messages[index + 1];
    return next?.role === "assistant" && next.status === "queued" ? next : undefined;
  };

  const agentSpec = agentById(agentId);
  const agentName = agentSpec.name;
  const openAgentSettings = () => window.dispatchEvent(new CustomEvent(OPEN_AGENT_SETTINGS_EVENT));
  const prepareWorkflow = async (task: string, answer: ChatMessage, sourceId: string) => {
    if (preparingWorkflowId) return;
    setPreparingWorkflowId(sourceId);
    const toolTrace = (answer.toolEvents ?? []).map((event) =>
      `Called ${event.name}${event.detail ? `(${event.detail})` : ""}`,
    ).join("\n");
    const evidence = [toolTrace, answer.text].filter(Boolean).join("\n");
    const capturedAnswer = { ...answer, text: evidence };
    const domain = capturedWorkflowDomain(task, evidence);
    const quality = workflowQuality(task, evidence, domain);
    const fallback = {
      title: workflowTitle(task, domain), domain,
      instructions: workflowInstructions(task, evidence),
      ...quality,
      capability: workflowCapability(task, evidence),
      parametersSchema: { type: "object", properties: { task: { type: "string", default: task } } },
      outputSchema: { type: "object", properties: { success: { type: "boolean" }, results: { type: "array" } } },
      recipe: workflowRecipe(task, evidence),
    };
    const authored = quality.reusable && ready ? await authorWorkflowWithAgent(agentSpec, s.workingDir, fallback) : undefined;
    const prepared = authored ?? fallback;
    if (!prepared.reusable) setWorkflowRejection(prepared.reason);
    else setWorkflowDraft({ task, answer: capturedAnswer, prepared });
    setPreparingWorkflowId(null);
  };
  const showDefaultSession =
    !s.selectedProfile && !multiloginSelection && s.defaultSession?.status === "running";

  return (
    <div className="chat-layout">
      <FileDropArea className="chat" onFiles={handleDroppedFiles} disabled={!ready}
        unavailableLabel="Connect an agent to attach files">
        <div className="chat-header">
          <RecentProjects key={conversationKey} title={conv?.title ?? "New project"} activeId={conv?.id} open={projectMenuOpen} onOpenChange={setProjectMenuOpen} />
          <span className="spacer" />
          {remoteOnly && (
            <Tooltip content={conv?.vpsConnectionLabel
                ? `Remote target: ${conv.vpsConnectionLabel}`
                : "This chat runs Clawbrowser commands on a VPS"}><span
              className="vps-target-pill"
            >
              <Icon name="terminal" size={12} />
              <span>VPS{conv?.vpsConnectionLabel ? ` · ${conv.vpsConnectionLabel}` : ""}</span>
            </span></Tooltip>
          )}
          {!remoteOnly && s.selectedProfile && (
            <span className="profile-pill">
              <Icon name="person.crop.circle" size={12} />
              {s.selectedProfile}
            </span>
          )}
          {!remoteOnly && (
            <MultiloginChatProfilePicker
              workspaceId={conv?.workspaceId}
              selection={multiloginSelection}
              onSelectAsAgentDefault={() => s.selectProfile(undefined)}
              onManage={() => s.setTab("connectors")}
              onReconnect={() => s.openConnectorPrompt("multilogin")}
            />
          )}
          {!remoteOnly && showDefaultSession && (
            <Tooltip content="Local browser session without a named profile"><span
              className="default-session-pill"
              tabIndex={0}
            >
              <Icon name="globe" size={12} />
              default
            </span></Tooltip>
          )}
        </div>
          <OverlayScrollArea contentClassName="messages" overlayClassName="chat-composer-dock" endButtonLabel="Scroll to latest message" autoFollow resetKey={conversationKey} overlay={
            <>
              {!ready && messages.length > 0 && (
                <div className="chat-agent-error small" role="status">
                  <span>{agentName} · {agentNeedsLogin ? "Sign-in required" : builtinAgent ? "Not set up" : "Not connected"}</span>{" "}
                  {builtinAgent ? (
                    <button className="btn-bordered" onClick={openAgentSettings}>Set up {agentName}</button>
                  ) : (
                    <button className="btn-bordered" disabled={s.runtime[agentId]?.authorizing}
                      onClick={() => agentNeedsLogin ? s.loginAgent() : s.authorizeAgent()}>
                      {s.runtime[agentId]?.authorizing ? "Checking…" : agentNeedsLogin ? `Sign in to ${agentName}` : `Connect ${agentName}`}
                    </button>
                  )}
                </div>
              )}
              {!ready && agentError && messages.length > 0 && (
                <div className="chat-agent-error error small">
                  <UserFacingError message={agentError} surface="agent_chat" />
                  <AgentInstallLink agent={agentSpec} error={agentError} surface="agent_chat" />
                </div>
              )}
              {guideDraftLoaded && (
                <div className="guide-draft-notice" role="status">
                  <Icon name="doc.text" size={14} />
                  <span>
                    <strong>Example loaded.</strong>{" "}
                    {ready ? "Review it, then send when ready." : "Connect an agent before sending."}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("");
                      setGuideDraftLoaded(false);
                    }}
                  >
                    Clear
                  </button>
                </div>
              )}
              {attachments.length > 0 && (
                <div className="pending-attachments">
                  {attachments.map((file) => (
                    <Tooltip key={file.path} content={file.path}><span className="attachment-chip">
                      <Icon name="paperclip" size={12} />
                      <span>{file.name}</span>
                      <button
                        className="attachment-remove"
                        aria-label={`Remove ${file.name}`}
                        onClick={() => {
                          trackEvent("chat_file_removed");
                          setAttachments((items) => items.filter((item) => item.path !== file.path));
                        }}
                      >×</button>
                    </span></Tooltip>
                  ))}
                </div>
              )}
              {actionError && !editingReply && (
                <div className="chat-action-error error small" role="alert">{actionError}</div>
              )}
              {commandNotice && <div className="chat-command-notice" role="status">{commandNotice}</div>}
              <div className="composer">
                {activeCommand && <CommandList id={commandMenuId} label="Agent commands" activeId={activeCommand.name} anchor={composerRef.current?.closest<HTMLElement>(".composer")}
                  options={commandMatches.map(command => ({ id: command.name, title: "/" + command.name, description: command.description }))}
                  onChoose={acceptCommand} />}
                <textarea
                  ref={composerRef}
                  aria-label={`Message ${agentName}`}
                  rows={2}
                  role={activeCommand ? "combobox" : undefined}
                  aria-autocomplete="list"
                  aria-haspopup={activeCommand ? "listbox" : undefined}
                  aria-expanded={!!activeCommand}
                  aria-controls={activeCommand ? commandMenuId : undefined}
                  aria-activedescendant={activeCommand ? commandMenuId + "-" + activeCommand.name : undefined}
                  value={draft}
                  placeholder={
                    ready
                      ? `Message ${agentName} — / for commands`
                      : "Connect an agent first"
                  }
                  disabled={!ready}
                  onChange={(e) => { setDraft(e.target.value); setCommandIndex(0); setCommandMenuDismissed(false); }}
                  onFocus={() => setCommandMenuDismissed(false)}
                  onBlur={event => { if (!event.currentTarget.closest(".composer")?.contains(event.relatedTarget as Node)) setCommandMenuDismissed(true); }}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (activeCommand) {
                      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setCommandMenuDismissed(true); return; }
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault(); setCommandIndex((Math.max(0, commandMatches.findIndex(command => command.name === activeCommand.name)) + (e.key === "ArrowDown" ? 1 : -1) + commandMatches.length) % commandMatches.length); return;
                      }
                      if ((e.key === "Tab" && !e.shiftKey) || (e.key === "Enter" && !e.shiftKey)) { e.preventDefault(); acceptCommand(activeCommand.name); return; }
                    }
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-actions">
                  <IconButton
                    label="Attach local files to the next message"
                    appearance="embedded"
                    size="small"
                    text="Attach"
                    disabled={!ready}
                    onClick={() => void attachFiles()}
                  >
                    <Icon name="paperclip" size={14} />
                  </IconButton>
                  <div className="script-wrap" ref={scriptWrapRef}>
                    <IconButton
                      label="Open scripts menu"
                      appearance="embedded"
                      size="small"
                      text="Scripts"
                      aria-haspopup="true"
                      aria-expanded={scriptOpen}
                      onClick={() => setScriptOpen((o) => !o)}
                    >
                      <Icon name="scroll" size={14} />
                    </IconButton>
                    {scriptOpen && (
                      <div className="script-menu" ref={scriptMenuRef}>
                        {officialScripts.length > 0 && <div className="section">OFFICIAL SCRIPTS</div>}
                        {officialScripts.map((sc) => (
                          <Tooltip key={sc.id} content={`Run ${sc.title}`}><button
                            onClick={() => {
                              setScriptOpen(false);
                              const domain = looksLikeDomain(draft.trim()) ? draft.trim() : "";
                              if (domain) setDraft("");
                              s.runScript(sc, domain);
                            }}
                          >
                            {sc.title}
                          </button></Tooltip>
                        ))}
                        {customScripts.length > 0 && (
                          <>
                            <div className="section">MY SCRIPTS</div>
                            {customScripts.map((cs) => (
                              <Tooltip key={cs.id} content={`Run ${cs.title}`}><button
                                onClick={() => {
                                  setScriptOpen(false);
                                  const domain = looksLikeDomain(draft.trim()) ? draft.trim() : "";
                                  if (domain) setDraft("");
                                  s.runCustomScript({ ...cs, domain: domain || cs.domain });
                                }}
                              >
                                {cs.title}
                              </button></Tooltip>
                            ))}
                          </>
                        )}
                        {officialScripts.length === 0 && customScripts.length === 0 && (
                          <Tooltip content="Create a custom script"><button onClick={openScriptCreator}>
                            <Icon name="plus" size={13} /> Create script
                          </button></Tooltip>
                        )}
                        {(officialScripts.length > 0 || customScripts.length > 0) && (
                          <Tooltip content="Create a new custom script"><button onClick={openScriptCreator}>
                            <Icon name="plus" size={13} /> Create script
                          </button></Tooltip>
                        )}
                      </div>
                    )}
                  </div>
                  {running ? (
                    <IconButton label="Stop the running agent response" appearance="embedded" onClick={() => s.stopRunning()}>
                      <Icon name="stop.fill" size={16} />
                    </IconButton>
                  ) : (
                    <IconButton
                      label="Send message to the selected agent"
                      appearance="embedded"
                      disabled={!ready || (!draft.trim() && attachments.length === 0)}
                      onClick={send}
                    >
                      <Icon name="arrow.up" size={21} />
                    </IconButton>
                  )}
                </div>
              </div>
            </>
          }>
          {conv?.terminalPreview && <details className="chat-legacy-activity">
            <summary>Previous terminal activity</summary><pre>{conv.terminalPreview}</pre>
          </details>}
          {messages.length === 0 && (
            <div className="empty-state chat-empty-state">
              <div className="empty-state-mark">
                <Icon name="cursorarrow" size={24} />
              </div>
              <div>
                <strong>{agentNeedsLogin ? `Sign in to ${agentName}` : ready ? "Agent connected" : `Connect ${agentName}`}</strong>
                <p className="muted">
                  Choose a browser profile and start it. Website actions stay blocked until its connection check passes.
                </p>
              </div>
              {!ready && agentError && <div className="error small" role="status">
                <UserFacingError message={agentError} surface="agent_chat" />
                <AgentInstallLink agent={agentSpec} error={agentError} surface="agent_chat" />
              </div>}
              {conv && !remoteOnly && conv.chatMode !== "terminal" && !conv.terminalPreview && (
                <label className="modal-field">
                  <span>Agent for this project</span>
                  <select aria-label="Agent for this project" value={agentId} disabled={s.runtime[agentId]?.authorizing}
                    onChange={(event) => s.changeEmptyProjectAgent(conv.id, event.target.value)}>
                    {AGENTS.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                  <small className="muted">You can change the agent while this chat is empty.</small>
                </label>
              )}
              <div className="empty-actions">
                {!ready && builtinAgent && (
                  <Tooltip content="Choose a model provider and add its key"><button
                    className="btn-bordered-prominent"
                    onClick={openAgentSettings}
                  >
                    <Icon name="bolt.fill" size={14} />
                    Set up {agentName}
                  </button></Tooltip>
                )}
                {!ready && !builtinAgent && (
                  <Tooltip content={agentNeedsLogin ? `Log in to ${agentName}` : "Connect the selected agent CLI"}><button
                    className="btn-bordered-prominent"
                    disabled={s.runtime[agentId]?.authorizing}
                    onClick={() => agentNeedsLogin ? s.loginAgent() : s.authorizeAgent()}
                  >
                    <Icon name="bolt.fill" size={14} />
                    {s.runtime[agentId]?.authorizing ? "Checking…" : agentNeedsLogin ? `Sign in to ${agentName}` : agentError ? "Check again" : `Connect ${agentName}`}
                  </button></Tooltip>
                )}
                <Tooltip content="Open Skills"><button className="btn-bordered" onClick={() => s.setTab("skills")}>
                  <Icon name="square.grid.2x2.fill" size={14} />
                  Open Skills
                </button></Tooltip>
                {s.proxy ? (
                  <Tooltip content="Choose a profile in this workspace"><button className="btn-bordered" onClick={() => window.dispatchEvent(new CustomEvent("nextbrowser:start-selected-profile"))}>
                    <Icon name="play.fill" size={14} />
                    Start session
                  </button></Tooltip>
                ) : (
                  <Tooltip content="Sign in to create managed profiles"><button className="btn-bordered" onClick={() => s.setDashboardKeyPromptOpen(true)}>
                    <Icon name="lock" size={14} />
                    Create first profile
                  </button></Tooltip>
                )}
              </div>
              <div className="empty-suggestion-grid">
                <Tooltip content="Start the active browser profile and verify its connection country and IP"><button
                  className="empty-suggestion"
                  onClick={() =>
                    s.tryGuidePrompt(
                      "Using the nextctl CLI, start the active browser profile with verification and confirm its current proxy country and IP.",
                    )
                  }
                >
                  <Icon name="globe" size={15} />
                  <span>
                    <strong>Proxy check</strong>
                    <span className="muted small">Verify proxy country and IP</span>
                  </span>
                </button></Tooltip>
                <Tooltip content="Open the Live tab to inspect a running browser session"><button
                  className="empty-suggestion"
                  onClick={() => s.setTab("live")}
                >
                  <Icon name="video.fill" size={15} />
                  <span>
                    <strong>Open live view</strong>
                    <span className="muted small">Inspect the running browser</span>
                  </span>
                </button></Tooltip>
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              canQueue={!!queuedReplyForMessage(m) && s.canManageQueuedReply(queuedReplyForMessage(m)!.id)}
              onCancel={() => {
                const reply = queuedReplyForMessage(m);
                if (reply) s.cancelQueuedReply(reply.id);
              }}
              onEdit={() => {
                const reply = queuedReplyForMessage(m);
                const replyIndex = reply ? messages.findIndex((x) => x.id === reply.id) : -1;
                const user = m.role === "user" ? m : replyIndex > 0 ? messages[replyIndex - 1] : null;
                if (reply && user) {
                  setActionError(undefined);
                  setEditingReply(reply.id);
                  setEditText(user.text);
                }
              }}
              onStop={() => s.stopRunning()}
              onRetry={() => {
                const index = messages.findIndex((candidate) => candidate.id === m.id);
                const user = [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user");
                if (!user) return;
                setDraft(user.text);
                setAttachments(user.attachments ?? []);
                window.requestAnimationFrame(() => composerRef.current?.focus());
              }}
              running={running && m.status === "streaming"}
              queuedReplyId={m.role === "user" ? queuedReplyForMessage(m)?.id : undefined}
              onShowPrompt={() => {
                trackEvent("chat_prompt_detail_opened", {
                  prompt_length_bucket: Math.min(5000, Math.ceil(m.text.length / 250) * 250),
                });
                setPromptDetail(m.text);
              }}
              onSaveWorkflow={() => {
                const index = messages.findIndex((candidate) => candidate.id === m.id);
                const user = [...messages.slice(0, index)].reverse().find((candidate) => candidate.role === "user");
                void prepareWorkflow(user?.text ?? "", m, m.id);
              }}
              savingWorkflow={preparingWorkflowId === m.id}
              showSaveWorkflow={m.id === latestCompletedAssistantId}
            />
          ))}
          </OverlayScrollArea>
      </FileDropArea>
      {projectCreatorOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => setProjectCreatorOpen(false)}>
          <form
            className="modal-card project-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-create-title"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const projectId = s.createProject(projectName, "chat", projectAgentId);
              if (projectId) window.dispatchEvent(new CustomEvent("nextbrowser:project-created", { detail: { id: projectId } }));
              setProjectCreatorOpen(false);
            }}
          >
            <div className="profile-menu-head">
              <span id="project-create-title" className="profile-menu-name">New project</span>
              <span className="spacer" />
              <button type="button" className="plain-icon-btn" aria-label="Close" onClick={() => setProjectCreatorOpen(false)}>
                <Icon name="xmark" size={17} />
              </button>
            </div>
            <p className="muted small project-create-explainer">
              Each project has its own agent chat and context. Browser profiles are shared by projects in this workspace.
            </p>
            <label className="modal-field">
              <span className="modal-field-heading"><span>Project name</span><small>Max {entityNameLimits.project}</small></span>
              <input autoFocus value={projectName} maxLength={entityNameLimits.project} onChange={(event) => setProjectName(event.target.value)} placeholder="Product research" />
            </label>
            <label className="modal-field">
              <span>Agent</span>
              <select value={projectAgentId} onChange={(event) => setProjectAgentId(event.target.value)}>
                {AGENTS.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
              <small className="muted">{s.runtime[projectAgentId]?.ready && s.runtime[projectAgentId]?.loggedIn !== false
                ? "Connected" : s.runtime[projectAgentId]?.loggedIn === false ? "Sign-in required — you can sign in after creating the project."
                : "Not connected — you can connect after creating the project."}</small>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setProjectCreatorOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={!projectName.trim()}>Create project</button>
            </div>
          </form>
        </div>
      ), document.body)}

      {editingReply && (
        <div className="modal-overlay">
          <div className="modal-card" role="dialog" aria-modal="true" aria-label="Edit queued message">
            <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} />
            {actionError && <div className="error small" role="alert">{actionError}</div>}
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <button className="secondary" onClick={() => { setActionError(undefined); setEditingReply(null); }}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  if (!s.editQueuedReply(editingReply, editText)) {
                    setActionError("Could not update this queued message. It may have already started or been removed.");
                    return;
                  }
                  setActionError(undefined);
                  setEditingReply(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {promptDetail !== null && (
        <div className="modal-overlay" onMouseDown={() => setPromptDetail(null)}>
          <div className="modal-card prompt-detail-card" role="dialog" aria-modal="true" aria-label="Prompt sent to agent" onMouseDown={(e) => e.stopPropagation()}>
            <strong>Prompt sent to agent</strong>
            <pre className="prompt-detail-text">{promptDetail}</pre>
            <div className="row" style={{ marginTop: 8, gap: 8 }}>
              <span className="spacer" />
              <button className="secondary" onClick={() => setPromptDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {workflowDraft && (
        <SaveWorkflowModal
          task={workflowDraft.task}
          answer={workflowDraft.answer}
          prepared={workflowDraft.prepared}
          onClose={() => setWorkflowDraft(null)}
          onSave={(title, domain, instructions) => {
            void s.saveLocalSkill({
              id: uid(), title, domain, task: workflowDraft.task, instructions,
              actions: workflowDraft.prepared.recipe.actions,
              capability: workflowDraft.prepared.capability,
              parametersSchema: workflowDraft.prepared.parametersSchema,
              outputSchema: workflowDraft.prepared.outputSchema,
              recipe: workflowDraft.prepared.recipe,
              createdAt: Date.now(), updatedAt: Date.now(),
            });
            setWorkflowDraft(null);
            localStorage.setItem("openSkillsCategory", "my-skills");
            s.setTab("skills");
          }}
        />
      )}

      {workflowRejection && (
        <div className="modal-overlay" onMouseDown={() => setWorkflowRejection(null)}>
          <div className="modal-card workflow-quality-modal" onMouseDown={(event) => event.stopPropagation()}>
            <strong>Nothing reusable to save yet</strong>
            <p className="muted">{workflowRejection}</p>
            <p className="muted small">Complete a browser search, extraction, form, or posting task successfully, then try again.</p>
            <div className="row"><span className="spacer" /><button className="primary" onClick={() => setWorkflowRejection(null)}>OK</button></div>
          </div>
        </div>
      )}

    </div>
  );
}

function MessageBubble({
  message: m,
  canQueue,
  onCancel,
  onEdit,
  onStop,
  onRetry,
  running,
  queuedReplyId,
  onShowPrompt,
  onSaveWorkflow,
  savingWorkflow,
  showSaveWorkflow,
}: {
  message: ChatMessage;
  canQueue: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onStop: () => void;
  onRetry: () => void;
  running: boolean;
  queuedReplyId?: string;
  onShowPrompt: () => void;
  onSaveWorkflow: () => void;
  savingWorkflow: boolean;
  showSaveWorkflow: boolean;
}) {
  const [clock, setClock] = useState(Date.now());
  const [showErrorDetails, setShowErrorDetails] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const runMessageAction = async (action: () => Promise<unknown>, message: string) => {
    setActionError(undefined);
    try { await action(); } catch { setActionError(message); }
  };
  useEffect(() => {
    if (m.status !== "streaming") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [m.status]);

  const elapsed = (start?: number) => {
    const seconds = Math.max(0, Math.floor((clock - (start ?? m.createdAt)) / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  };

  if (m.role === "system") {
    const systemText = m.status === "failed" || m.status === "timedOut" ? userFacingBrowserError(m.text) : m.text;
    const visibleText = /^.+ connected — .+/.test(systemText)
      ? systemText.replace(/ — .+?(?=\. You're|\.$)/, "")
      : systemText;
    return (
      <div className="msg msg-system">
        <div className="msg-body">
          <UserFacingError message={visibleText} surface="chat_system" />
        </div>
      </div>
    );
  }

  if (m.role === "user") {
    return (
      <div className="msg-user-wrap">
        <div className="msg-user-inner">
          {m.commandChip ? (
            <Tooltip content="Show full prompt sent to the agent"><button className="user-command-chip" onClick={onShowPrompt}>
              <span className="user-command-icon">
                <Icon
                  name={m.commandChip.kind === "skill" ? "sparkles" : "scroll.fill"}
                  size={14}
                />
              </span>
              <div>
                <div className="chip-kind">
                  {m.commandChip.kind === "skill" ? "Use skill" : "Run script"}
                </div>
                <strong>{m.commandChip.title}</strong>
                {m.commandChip.detail && (
                  <div className="muted small">{m.commandChip.detail}</div>
                )}
              </div>
              <Icon name="info.circle" size={12} className="muted" />
            </button></Tooltip>
          ) : (
            <div className="msg-user-bubble">{m.text}</div>
          )}
          {m.attachments && m.attachments.length > 0 && (
            <div className="message-attachments">
              {m.attachments.map((file) => (
                <Tooltip key={file.path} content={file.path}><button
                  className="message-attachment"
                  onClick={() => void runMessageAction(() => invoke("open_path", { path: file.path }), "Could not open this attachment. Check that the file still exists.")}
                >
                  <Icon name="doc" size={14} />
                  <span>{file.name}</span>
                </button></Tooltip>
              ))}
            </div>
          )}
          <div className="msg-user-meta muted small">
            {actionError && <span role="alert">{actionError}</span>}
            {queuedReplyId && (
              <>
                <span className="queue-badge">Waiting</span>
                {canQueue && (
                  <>
                    <Tooltip content="Edit queued message"><button className="plain-icon-btn plain-icon-btn-compact" onClick={onEdit}>
                      <Icon name="pencil" size={12} />
                    </button></Tooltip>
                    <Tooltip content="Remove queued message"><button className="plain-icon-btn plain-icon-btn-compact" onClick={onCancel}>
                      <Icon name="trash" size={12} className="error" />
                    </button></Tooltip>
                  </>
                )}
              </>
            )}
            <Tooltip content="Copy message"><button
              className="plain-icon-btn plain-icon-btn-compact"
              onClick={() => void runMessageAction(() => navigator.clipboard.writeText(m.text), "Could not copy the message. Try again.")}
            >
              <Icon name="doc.on.doc" size={12} />
            </button></Tooltip>
            <span>{formatTime(m.createdAt)}</span>
          </div>
        </div>
      </div>
    );
  }

  const bubbleClass =
    "assistant-bubble" +
    (m.status === "failed" ? " bubble-failed" : "") +
    (m.status === "timedOut" ? " bubble-warn" : "");
  const visibleText = m.status === "failed" || m.status === "timedOut" ? userFacingBrowserError(m.text) : m.text;

  return (
    <div className="msg-assistant-wrap">
      <div className={bubbleClass}>
        <div className="msg-meta">
          <span className={"status-badge status-" + m.status}>
            {m.status === "streaming"
              ? m.stalled
                ? `Still working · ${elapsed(m.runStartedAt)}`
                : `${m.activityLabel ?? "Thinking"} · ${elapsed(m.runStartedAt)}`
              : statusLabel(m)}
          </span>
          {running && m.status === "streaming" && (
            <Tooltip content="Stop this request"><button className="stop-inline" onClick={onStop} aria-label="Stop this request">
              <Icon name="stop.fill" size={9} />
              <span>Stop</span>
            </button></Tooltip>
          )}
        </div>
        {m.toolEvents && m.toolEvents.length > 0 && (
          <AgentSteps steps={m.toolEvents} live={m.status === "streaming"} />
        )}
        <div className="msg-body">
          {needsSupportLink(visibleText) ? (
            <UserFacingError message={visibleText} surface="agent_turn" />
          ) : (m.status === "failed" || m.status === "timedOut") && visibleText.length > 180 ? (
            <div className="error-collapse">
              <div className="error-summary">
                <Icon name="exclamationmark.triangle.fill" size={13} className="error" />
                <span>{errorSummary(visibleText)}</span>
              </div>
              <button className="error-toggle" onClick={() => setShowErrorDetails((v) => !v)}>
                {showErrorDetails ? "Hide details" : "Show details"}
              </button>
              {showErrorDetails && <pre className="error-details">{visibleText}</pre>}
            </div>
          ) : (
            <MarkdownText text={visibleText || (m.status === "streaming" ? "Working on your request…" : "")} />
          )}
        </div>
      </div>
      {m.text && (
        <div className="msg-assistant-meta muted small">
          {actionError && <span role="alert">{actionError}</span>}
          <Tooltip content="Copy message"><button
            className="plain-icon-btn plain-icon-btn-compact"
            onClick={() => void runMessageAction(() => navigator.clipboard.writeText(visibleText), "Could not copy the message. Try again.")}
          >
            <Icon name="doc.on.doc" size={12} />
          </button></Tooltip>
          {m.status === "done" && showSaveWorkflow && (
            <Tooltip content="Save this browser workflow as a local skill"><button className="save-workflow-btn" disabled={savingWorkflow} onClick={onSaveWorkflow}>
              {savingWorkflow && <Spinner size={11} />} {savingWorkflow ? "Preparing…" : "Save as skill"}
            </button></Tooltip>
          )}
          {(m.status === "failed" || m.status === "timedOut") && (
            <Tooltip content="Review the original request before sending it again"><button className="save-workflow-btn" onClick={onRetry}>Retry</button></Tooltip>
          )}
          <span>{formatTime(m.createdAt)}</span>
        </div>
      )}
    </div>
  );
}

// What the agent is doing, as it does it: the latest step stays visible while
// the reply runs, and the whole trail opens on demand. Without it a long turn
// that starts browsers and updates toolsets looks like the app acting alone.
function AgentSteps({ steps, live }: { steps: NonNullable<ChatMessage["toolEvents"]>; live: boolean }) {
  const [open, setOpen] = useState(false);
  const latest = steps[steps.length - 1];
  const failed = (detail?: string) => /^Failed:/.test(detail ?? "");
  return (
    <div className={"agent-steps" + (live ? " is-live" : "")}>
      <Tooltip content={open ? "Hide the agent's steps" : "Show every step the agent took"}><button
        type="button"
        className="agent-steps-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? "chevron.down" : "chevron.right"} size={11} />
        <span className="agent-steps-count">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
        {!open && (
          <Tooltip content={latest.detail}><span className={"agent-steps-latest" + (failed(latest.detail) ? " is-failed" : "")}>
            {latest.detail ?? latest.name}
          </span></Tooltip>
        )}
      </button></Tooltip>
      {open && (
        <ol className="agent-steps-list">
          {steps.map((step) => (
            <Tooltip key={step.id} content={step.detail}><li className={failed(step.detail) ? "is-failed" : undefined}>
              <Icon name={step.name === "nextctl" ? "terminal" : step.name === "step" ? "chevron.right" : "wrench"} size={10} />
              <span>{step.detail ?? step.name}</span>
            </li></Tooltip>
          ))}
        </ol>
      )}
    </div>
  );
}

function SaveWorkflowModal({ prepared, onClose, onSave }: {
  task: string;
  answer: ChatMessage;
  prepared: DistilledWorkflow;
  onClose: () => void;
  onSave: (title: string, domain: string, instructions: string) => void;
}) {
  const [title, setTitle] = useState(prepared.title);
  const [domain, setDomain] = useState(prepared.domain);
  const [instructions, setInstructions] = useState(prepared.instructions);
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal-card workflow-save-modal" onMouseDown={(event) => event.stopPropagation()}>
        <strong>Save as skill</strong>
        <p className="muted small">Saved locally first, then backed up privately to your account.</p>
        <label className="field-label">Skill name</label>
        <input value={title} autoFocus onChange={(event) => setTitle(event.target.value)} />
        <label className="field-label">Website</label>
        <input value={domain} placeholder="example.com (optional)" onChange={(event) => setDomain(event.target.value)} />
        <label className="field-label">Reusable instructions</label>
        <textarea rows={10} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
        <div className="row" style={{ marginTop: 10, gap: 8 }}>
          <span className="spacer" />
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!title.trim() || !instructions.trim()} onClick={() => onSave(title.trim(), domain.trim(), instructions.trim())}>Save skill</button>
        </div>
      </div>
    </div>
  );
}
