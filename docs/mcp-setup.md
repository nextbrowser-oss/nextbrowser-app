# MCP setup in Nextbrowser

Open **Extensions → MCP**. The browser MCP remains managed by the app.

Under **Settings → Agent**, turn on **Prefer WebMCP** to discover website actions in the active document. This takes effect on the next Nextbrowser agent or Codex chat turn, or when opening a new Codex terminal. Standard controls are the default. See [in-tab tools and runtime support](in-tab-mcp.md).

**Use Harness²** lets a project agent compare two strategies at any decision point, including during initial planning. The agent can repeat the comparison when new evidence changes the decision. The setting applies to newly started chat turns and terminals.

The built-in agent can call `harness2_compare` directly. It asks its current model to propose two strategies, assess them separately against the same observations and select a next step. Each comparison uses up to four additional model requests. A repeating browser action can also trigger a comparison automatically.

Codex and Claude Code receive `harness2_propose`, `harness2_probe` and `harness2_compose` on the scoped desktop MCP. Their own model proposes the alternatives and evaluates each one. Nextbrowser records the shared evidence and requires both assessments before accepting a conclusion. Other chat adapters receive the same comparison procedure in the task prompt. The agent uses its ordinary permissions to execute the selected next step. This workflow adapts the propose, probe and compose stages of [Google Research Harness²](https://github.com/google-research/harness2).

- **Discover** reads current entries from the official MCP Registry, with search and pagination. Select Configure to review a package version, command, environment variables or remote endpoint before running it. Registry entries are third-party metadata, not an endorsement or a promise of free service.
- **Add custom** accepts one launch command, a `command` / `args` / `env` object, one `mcpServers` entry, or a Streamable HTTP `url` with optional `headers`. Node.js/npx or uvx must already be installed for packages that require them. Shell pipelines and implicit shell evaluation are not supported.
- **Import from GitHub** reads public `server.json`, `.mcp.json`, `mcp.json`, or explicit JSON configuration blocks in README.md. It does not execute repository instructions. Unsupported manifests, multiple entries, missing runtime arguments and authorization requirements must be resolved in the editable configuration before connecting.
- **Connect & save** runs the reviewed server, initializes MCP, lists its tools (including pagination), closes the check connection, and saves the configuration encrypted with the OS credential store. A successful check does not assert that every tool is authorized or that a service will never fail.
- Installed servers show their last check, available tools, an enable/disable control, connection test, and removal. They belong to the current workspace on this computer. Restart an ongoing agent task to pick up changes.

The Nextbrowser API agent and Codex receive enabled servers on each non-plain chat turn. Browser tools keep their existing workspace and proxy rules. Custom tool names are namespaced. Plain drafting runs receive no external tools. Other CLI agent adapters do not consume this list yet; the UI says so explicitly.

**Use a free model** reuses the OpenRouter setup flow and backend-managed key. It only changes the agent/model when the user saves that setup. The default choice leaves the current agent unchanged. It does not make paid MCP services free.

Remote connections support Streamable HTTP with JSON or SSE responses and static headers. Interactive OAuth and legacy HTTP+SSE are not implemented; authenticate separately and supply supported headers when appropriate.

Secrets are kept in `mcp-servers.enc`, not renderer storage or agent configuration files. Third-party stdio servers inherit a minimal OS/runtime environment, plus only the explicitly configured values. Codex uses a per-process environment reference and stdio bridge so credentials are not included in command-line arguments. Error messages do not forward raw server stderr. Emergency local data reset removes the encrypted file with the rest of app data.

Protocol references: [MCP transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [tools and pagination](https://modelcontextprotocol.io/specification/2025-06-18/server/tools), [Registry API](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/generic-registry-api.md).

Validation: Node tests cover real stdio and HTTP connections, SSE, pagination, tool invocation, external-agent bridging, encrypted persistence, workspace isolation and credential filtering. UI tests cover explicit installation, catalog review, failure recovery, and free-model setup without silently changing the default agent.

## Built-in workspace tools

In **Settings → Agent → Agent permissions**, choose a preset or set each permission individually. **Extensions → MCP → Permissions** opens the same controls. Settings belong to the signed-in account and workspace on this device. Changes also apply to active requests. Start a new chat turn to discover newly enabled tools.

**Autonomous** lets the agent read and edit files inside the selected folder, inspect Android devices and repeat approved shell commands. **Default** restores per-action approvals for reads, terminal and Android, turns off file edits and forgets remembered commands. Both presets keep new MCP connections subject to review.

- **Terminal** uses Bash by default, including Git Bash on Windows. Automatic selection uses PowerShell if Bash is unavailable. Choose a different default under **Default shell**. In **Remember approved commands** mode, a new command prompts with its shell, working folder and exact text. Choose **Allow once** or **Remember this exact command**. Remembered commands run as the OS user and may execute project scripts that change over time. Changing the working folder or leaving this mode clears approvals. **Forget commands** clears them immediately.
- **Android** works with connected development phones and emulators. **Allow device inspection** automatically lists devices and reads SDK versions. APK installation and instrumentation tests still require approval. Nextbrowser discovers adb in the SDK or on PATH. For a custom installation use **Choose SDK folder**. Install [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) if adb is missing.
- **Workspace files** can list directories and read UTF-8 text files up to 512 KiB. Choose **Ask every time**, **Allow in selected folder** or **Off**. Both listing and reading support continuation offsets. Links outside the selected directory are rejected.
- **Workspace edits** controls directory creation and UTF-8 text writes of up to 64 KiB. Replacing an existing file requires its current content hash from a prior read. Existing installations keep their read preferences and start with edits off.
- **MCP setup** lets the agent search the public registry and prepare an editable configuration. The user supplies credentials and selects **Connect & save**. The server's tools are available on the next turn. Switch setup to **Off** to disable both agent actions.

These permissions govern the stock tools of the built-in agent. Independently connected third-party servers and external agent CLIs have their own permissions.

To exercise the desktop flow, build the renderer, set `NEXTCTL_BIN` to the local CLI executable and run `node scripts/test-stock-mcp.mjs`. The scenario uses a temporary profile, a local model fixture, a real shell, and a local MCP server.
