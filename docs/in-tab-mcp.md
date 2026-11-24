# In-tab MCP tools

**Settings → Agent → Prefer in-tab MCP tools** selects the default for new Nextbrowser agent and Codex turns and new Codex terminals on this installation. It starts off. Plain drafting runs have no browser tools.

| Approach | What the agent can do | Requirements |
| --- | --- | --- |
| Standard Nextbrowser MCP | Navigate, inspect the page, click, type, select and use other browser controls. | Uses the managed profile and its runtime transport, including CDP for Chromium and Playwright for Camoufox. Works on ordinary sites. |
| mcp-chrome | Control an existing Chromium browser through extension APIs, including navigation, screenshots, history and bookmarks. | Its published setup installs an extension and registers a separate local bridge. Nextbrowser already owns profile selection and an authenticated browser connection. [Project documentation](https://github.com/hangwin/mcp-chrome) |
| Native WebMCP | Discover a site's named tools and input schemas, then invoke a matching action in its document. Site code implements the action. | Requires site adoption, a secure context and a runtime exposing the discovery and invocation API. Chrome announced an origin trial beginning in 149 and described Gemini integration as upcoming at I/O. Availability in a Chrome-branded assistant does not establish availability in a Chromium fork. [WebMCP proposal](https://github.com/webmachinelearning/webmcp) · [Chrome availability](https://developer.chrome.com/docs/ai/webmcp) · [I/O announcement](https://developer.chrome.com/blog/chrome-at-io26) |

Nextbrowser adds two tools to its existing stdio connection when the preference is on. The agent calls `tab_tools_list` with the workspace profile, then `tab_tool_call` with the returned document handle, tool name and JSON input. The host submits a fixed adapter to the active document over the scoped browser connection. A native call runs the site's registered handler. On Chromium this path uses CDP and needs no separate extension or Playwright process.

- **Native tools** appear as `site/<name>`. Discovery uses the document's default same-origin scope. Ambiguous duplicate names and developer-only tools are omitted.
- **Annotated search forms** work even when the browser API is unavailable. This adapter accepts same-origin GET forms with `toolname`, `tooldescription` and named text/search inputs. It fills the form and submits only when the site declares `toolautosubmit`. Otherwise it leaves submission to the user.
- **Ordinary websites** offer `page/read` for their title, visible text and up to 30 same-site links. The agent can follow a listed link by its unique visible label using `page/follow_link`. Other interactions use existing browser controls. An internal browser page is outside the tab adapter's scope.

Registration is discovered on demand. Switching tabs, navigating or reloading can invalidate a handle. A failed invocation may already have changed the site, so the agent should inspect the page before retrying. The toggle selects a preference. It does not enable experimental browser flags or install an extension in users' profiles.

### Verification and trade-offs

The Windows fixture exercised Clawbrowser 151.0.7922.109 and the managed CLI 1.2.40. On an ordinary launch the test origin exposed no native WebMCP API. Reading the page and submitting its annotated search form worked. With WebMCP testing enabled in an isolated profile, the agent discovered and executed a JavaScript tool and the test checked the resulting page text. Changing the page invalidated the earlier handle. The workspace rejected a different profile.

Discovery costs one MCP round trip per page of schemas. A matching call supplies structured input and returns a bounded result, which can replace multiple state reads and gestures. On a site with no suitable tool the probe adds overhead. Latency, token savings and success rates across production sites have not been benchmarked.

For the repeatable check, set `NBC_TEST_CLI` and `NBC_TEST_BROWSER` to installed executables, and `NEXTBROWSER_CONFIG_DIR` to the authenticated CLI configuration if needed. Run `node scripts/test-tab-mcp.mjs`. Browser sessions and pages are temporary. Playwright launches the test browser and verifies the rendered outcome. Browser actions under test travel through Nextbrowser MCP. The agent-loop test scripts the model responses.
