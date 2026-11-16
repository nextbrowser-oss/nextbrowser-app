# MCP setup in Nextbrowser

Open **Extensions → MCP**. The browser MCP remains managed by the app.

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
