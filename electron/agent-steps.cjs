// A chat turn used to show nothing but "Working on your request…" until the
// agent finished: `claude -p` prints only the final answer, and Codex's step
// log went to a label nobody could read. Both decoders here turn an agent's
// own progress output into short step lines the chat lists under the reply.

const { StringDecoder } = require("node:string_decoder");

const STEP_LIMIT = 160;

function oneLine(value, limit = STEP_LIMIT) {
  const line = String(value ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean) ?? "";
  const plain = line.replace(/\*\*/g, "").replace(/`/g, "").trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}

function baseName(file) {
  return String(file ?? "").split(/[\\/]/).filter(Boolean).pop() ?? "";
}

// The arguments that make an MCP browser call recognisable at a glance.
function browserCallTarget(input) {
  if (!input || typeof input !== "object") return "";
  for (const key of ["url", "profile", "selector", "text", "query", "country"]) {
    if (typeof input[key] === "string" && input[key].trim()) return input[key].trim();
  }
  return "";
}

function claudeToolStep(name, input = {}) {
  const tool = String(name ?? "");
  const mcp = tool.match(/^mcp__(.+?)__(.+)$/);
  if (mcp) {
    const target = browserCallTarget(input);
    return oneLine(`${mcp[1]}: ${mcp[2].replace(/_/g, " ")}${target ? ` ${target}` : ""}`);
  }
  switch (tool) {
    case "Bash":
      return oneLine(input.description ? `${input.description} — ${input.command ?? ""}` : `Ran ${input.command ?? ""}`);
    case "Read":
      return oneLine(`Read ${baseName(input.file_path)}`);
    case "Write":
      return oneLine(`Wrote ${baseName(input.file_path)}`);
    case "Edit":
    case "MultiEdit":
      return oneLine(`Edited ${baseName(input.file_path)}`);
    case "Grep":
      return oneLine(`Searched for ${input.pattern ?? ""}`);
    case "Glob":
      return oneLine(`Listed ${input.pattern ?? "files"}`);
    case "WebFetch":
      return oneLine(`Fetched ${input.url ?? ""}`);
    case "WebSearch":
      return oneLine(`Searched the web for ${input.query ?? ""}`);
    case "Task":
    case "Agent":
      return oneLine(`Delegated: ${input.description ?? input.prompt ?? ""}`);
    case "TodoWrite":
      return "Updated its plan";
    default:
      return oneLine(tool);
  }
}

function toolResultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part.text === "string" ? part.text : "")).join("\n");
  }
  return "";
}

/**
 * Decodes `claude -p --output-format stream-json --verbose`. Only the final
 * result reaches `onText`, so the reply reads exactly as it did in text mode;
 * the turn's narration, tool calls and failed tool results go to `onStep`.
 */
function createClaudeStreamDecoder({ onText, onStep }) {
  // Pipe chunks can end inside a multi-byte character (Cyrillic replies).
  const utf8 = new StringDecoder("utf8");
  let buffer = "";
  let finalText;
  let lastNarration = "";
  // Narration is held back one event: the turn's last text block is the
  // answer itself, and listing it again as a step would only repeat it.
  let heldNarration = "";

  const flushNarration = () => {
    if (heldNarration) onStep(heldNarration);
    heldNarration = "";
  };

  const handle = (event) => {
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type === "text" && block.text?.trim()) {
          flushNarration();
          lastNarration = block.text.trim();
          heldNarration = oneLine(block.text);
        } else if (block?.type === "thinking" && block.thinking?.trim()) {
          flushNarration();
          onStep(`Thinking: ${oneLine(block.thinking, STEP_LIMIT - 10)}`);
        } else if (block?.type === "tool_use") {
          flushNarration();
          onStep(claudeToolStep(block.name, block.input));
        }
      }
    } else if (event.type === "user" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block?.type === "tool_result" && block.is_error) {
          const detail = oneLine(toolResultText(block.content), STEP_LIMIT - 8);
          if (detail) onStep(`Failed: ${detail}`);
        }
      }
    } else if (event.type === "result") {
      const text = typeof event.result === "string" && event.result.trim() ? event.result : lastNarration;
      if (heldNarration && oneLine(text) !== heldNarration) flushNarration();
      heldNarration = "";
      finalText = text;
      if (text) onText(text);
    }
  };

  const consumeLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      // Anything that is not an event (an older CLI, a crash banner) is
      // still output the user has to see.
      onText(`${line}\n`);
      finalText = `${finalText ?? ""}${line}\n`;
      return;
    }
    if (event && typeof event === "object") handle(event);
  };

  return {
    write(chunk) {
      buffer += typeof chunk === "string" ? chunk : utf8.write(chunk);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    /** Returns the reply text the turn ended with. */
    end() {
      buffer += utf8.end();
      if (buffer) consumeLine(buffer);
      buffer = "";
      // A stopped or crashed turn never sends its result event; keep the
      // last thing the agent said rather than an empty reply.
      if (finalText === undefined && lastNarration) {
        heldNarration = "";
        finalText = lastNarration;
        onText(lastNarration);
      }
      return finalText ?? "";
    },
  };
}

const CODEX_SECTION = /^(thinking|codex|exec|user|tokens used)$/;

function codexCommandStep(line) {
  const command = line
    .replace(/\s+in\s+\S.*$/, "")
    .replace(/^(?:\/bin\/)?(?:ba|z)?sh\s+-l?c\s+/, "")
    .replace(/^(['"])([\s\S]*)\1$/, "$2");
  return oneLine(`Ran ${command}`);
}

/**
 * Decodes the human-readable log `codex exec` writes to stderr: section
 * headers (`thinking`, `codex`, `exec`) followed by their content, and one-line
 * `tool server.name(...)` MCP calls.
 */
function createCodexStepDecoder({ onStep }) {
  const utf8 = new StringDecoder("utf8");
  let buffer = "";
  let section = "";
  let sectionLines = 0;
  let heldNarration = "";

  const flushNarration = () => {
    if (heldNarration) onStep(heldNarration);
    heldNarration = "";
  };

  const consumeLine = (raw) => {
    const line = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/^\[[^\]]+\]\s*/, "").trimEnd();
    const trimmed = line.trim();
    if (!trimmed) return;
    if (CODEX_SECTION.test(trimmed)) {
      section = trimmed;
      sectionLines = 0;
      return;
    }
    const tool = trimmed.match(/^tool\s+([\w-]+)\.([\w-]+)\((.*)\)\s*$/);
    if (tool) {
      flushNarration();
      let target = "";
      try { target = browserCallTarget(JSON.parse(tool[3] || "{}")); } catch { /* arguments are not JSON */ }
      onStep(oneLine(`${tool[1]}: ${tool[2].replace(/_/g, " ")}${target ? ` ${target}` : ""}`));
      section = "";
      return;
    }
    sectionLines += 1;
    if (sectionLines !== 1) return;
    if (section === "exec") {
      flushNarration();
      onStep(codexCommandStep(trimmed));
    } else if (section === "thinking") {
      flushNarration();
      onStep(`Thinking: ${oneLine(trimmed, STEP_LIMIT - 10)}`);
    } else if (section === "codex") {
      flushNarration();
      heldNarration = oneLine(trimmed);
    }
  };

  return {
    write(chunk) {
      buffer += typeof chunk === "string" ? chunk : utf8.write(chunk);
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    },
    end() {
      buffer += utf8.end();
      if (buffer) consumeLine(buffer);
      buffer = "";
      // The last `codex` section is the answer, which the reply already shows.
      heldNarration = "";
    },
  };
}

module.exports = { createClaudeStreamDecoder, createCodexStepDecoder, claudeToolStep };
