const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { agentWorkspaceDir } = require("./agent-workspace.cjs");
const { resolveScopedProfile } = require("./agent-control-scope.cjs");

test("host control resolves only an authorized exact or sole profile", () => {
  const sole = new Map([["Worker", { runtime: "clawbrowser" }]]);
  assert.equal(resolveScopedProfile(sole, "Worker"), "Worker");
  assert.equal(resolveScopedProfile(sole, "Automation Demo Workspace"), "Worker");
  assert.equal(resolveScopedProfile(sole, ""), "Worker");

  const multiple = new Map([["Worker", {}], ["Research", {}]]);
  assert.equal(resolveScopedProfile(multiple, "Worker"), "Worker");
  assert.equal(resolveScopedProfile(multiple, "Automation Demo Workspace"), "");
  assert.equal(resolveScopedProfile(multiple, ""), "");
});

test("agent workspace stays outside macOS Library and protected user folders", () => {
  const workspace = agentWorkspaceDir("/Users/alice");

  assert.equal(workspace, path.join("/Users/alice", ".nextbrowser", "workspace"));
  assert.equal(workspace.includes(`${path.sep}Library${path.sep}`), false);
  for (const protectedFolder of ["Documents", "Downloads", "Desktop", "Music", "Pictures"]) {
    assert.equal(workspace.includes(`${path.sep}${protectedFolder}${path.sep}`), false);
  }
});

test("agent workspace requires an explicit home directory", () => {
  assert.throws(() => agentWorkspaceDir(""), /home directory/i);
});

test("terminal Codex keeps workspace isolation while allowing Clawbrowser network calls", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /"--profile", CODEX_TERMINAL_PROFILE/);
  assert.match(main, /"--sandbox", "workspace-write"/);
  assert.match(main, /sandbox_workspace_write\.network_access=true/);
  assert.match(main, /CLAWBROWSER_BIN: clawbrowserBin/);
  assert.match(main, /default_tools_approval_mode = "approve"/);
  assert.match(main, /\[plugins\."browser@openai-bundled"\][\s\S]*enabled = false/);
  assert.match(main, /ensureCodexTerminalProfile\(\)/);
  assert.match(main, /const nextctlBin = await resolveOrInstallNextctl\(\)/);
  assert.match(main, /plugins\."clawbrowser@clawctl-local"\.enabled=false/);
  assert.match(main, /mcp_servers\.nextbrowser\.command=/);
  assert.match(main, /mcp_servers\.nextbrowser\.args=/);
  assert.match(main, /mcp_servers\.nextbrowser\.env=/);
  assert.match(main, /mcp_servers\.nextbrowser\.env_vars=.*MULTILOGIN_TOKEN/);
  assert.match(main, /mcp_servers\.nextbrowser\.env_vars=.*NEXTBROWSER_AUTOMATION_TRACE_FILE/);
  assert.match(main, /mcp_servers\.nextbrowser\.env_vars=.*NEXTBROWSER_CONTROL_URL/);
  assert.match(main, /mcp_servers\.nextbrowser\.env_vars=.*NEXTBROWSER_CONTROL_TOKEN/);
  assert.match(main, /nextctlHasAutomationTrace\(nextctlBin\)/);
  assert.match(main, /codexClawbrowserMCPArgs\(nextctlBin, supportedTraceFile\)/);
  assert.match(main, /automationTraceFile \? \["NEXTBROWSER_AUTOMATION_TRACE_FILE"\] : \[\]/);
  assert.match(main, /automationTraceFile \? \["--automation-trace-file", automationTraceFile\] : \[\]/);
  assert.doesNotMatch(main, /mcpEnvKeys\.push\("MULTILOGIN_TOKEN"\)/);
  assert.match(main, /plugins\."clawbrowser@clawctl-local"\.mcp_servers\.clawbrowser\.enabled=false/);
  assert.match(main, /plugins\."clawbrowser@nbc-local"\.enabled=false/);
  assert.match(main, /mcp_servers\.nextbrowser\.default_tools_approval_mode=approve/);
  assert.match(main, /"--add-dir", dir/);
  assert.match(main, /\.cache", "clawbrowser"/);
  assert.match(main, /\.local", "share", "clawbrowser"/);
  assert.match(main, /\.local", "state", "clawbrowser"/);
  assert.match(main, /"Application Support", "Dasbrowser"/);
  assert.doesNotMatch(main, /path\.join\(home\(\), "Library", "Application Support"\),/);
  assert.match(main, /path\.join\(home\(\), "\.nextbrowser", "runtime"\)/);
  assert.match(main, /managedNextctlRoot\(\), \.\.\.searchDirs\(\)/);
  assert.doesNotMatch(main, /dangerously-bypass-approvals-and-sandbox/);
});

test("Codex chat uses the managed Clawbrowser MCP configuration", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /case "agent_run":[\s\S]*args\.agentId === "codex"/);
  assert.match(main, /case "agent_run":[\s\S]*resolveOrInstallNextctl\(\)/);
  assert.match(main, /case "agent_run":[\s\S]*nextctlHasAutomationTrace\(nextctlBin\)/);
  assert.match(main, /case "agent_run":[\s\S]*codexClawbrowserMCPArgs\(nextctlBin, supportedTraceFile\)/);
});

test("Terminal Chat restarts onto the active Recorder trace", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  assert.match(main, /case "terminal_start":[\s\S]*activeAutomationTraceFile\(\)/);
  assert.match(main, /case "terminal_start":[\s\S]*codexClawbrowserArgs\(nextctlBin, supportedTraceFile\)/);
  assert.match(terminal, /AUTOMATION_RECORDING_EVENT/);
  assert.match(terminal, /activeAutomationRecording\(\)\?\.id/);
  assert.match(terminal, /setRestartNonce\(\(value\) => value \+ 1\)/);
});

test("active Recorder requires a replayable final data-collection call", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "src", "store.ts"), "utf8");
  assert.match(store, /NextBrowser Recorder is active for this task/);
  assert.match(store, /Prefer navigate_extract/);
  assert.match(store, /call extract or paginate_extract/);
  assert.match(store, /call evaluate once with a read-only expression/);
  assert.match(store, /open that exact API URL in the listed browser profile/);
  assert.match(store, /Never leave the final request hidden in curl, fetch, or an uncaptured shell action/);
  assert.match(store, /Do not finish with state as the only data-collection step/);
  assert.match(main, /artifact_saved_recording_incomplete/);
  assert.match(main, /artifactScope\.pendingArtifact/);
  assert.match(main, /confirm without creating a duplicate/);
});

test("artifact saving remains local and independent from recorder trace support", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /"--automation-trace-file", "nextbrowser-capability-probe"/);
  assert.match(main, /automation trace file must be an absolute path/);
  assert.match(main, /API_KEY_REQUIRED/);
  assert.match(main, /saveAgentArtifact\(\{/);
  assert.doesNotMatch(main, /recording_requires_deterministic_data_action/);
  assert.doesNotMatch(main, /recorderTraceRequired/);
  assert.match(main, /artifact_content_missing/);
  assert.match(main, /attach a heredoc or stdin body to the same command/);
});

test("project chat receives scoped host control for stopped browser profiles", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "src", "store.ts"), "utf8");
  assert.match(store, /case "agent_run"|invoke<AgentDone>\("agent_run"/);
  assert.match(store, /browserProfiles,/);
  assert.match(store, /browserContext,/);
  assert.match(store, /conversationId: item\.conversationId/);
  assert.match(store, /workspaceId: conversationWorkspaceId/);
  assert.match(main, /case "agent_run":[\s\S]*ensureAgentControlServer\(\)/);
  assert.match(main, /case "agent_run":[\s\S]*NEXTBROWSER_CONTROL_URL/);
  assert.match(main, /case "agent_run":[\s\S]*NEXTBROWSER_CONTROL_TOKEN/);
  assert.match(main, /case "agent_run":[\s\S]*NEXTBROWSER_ALLOWED_PROFILES_JSON/);
  assert.match(main, /case "agent_run":[\s\S]*agentControlScopes\.delete\(controlToken\)/);
  assert.match(main, /case "agent_run":[\s\S]*agentControlArtifactScopes\.set\(controlToken/);
  assert.match(main, /case "agent_run":[\s\S]*agentControlArtifactScopes\.delete\(controlToken\)/);
  assert.match(main, /request\.url === "\/artifact\/save"/);
  assert.match(main, /workspaceId: artifactScope\.workspaceId/);
  assert.match(main, /case "agent_run":[\s\S]*fs\.unlink\(profileScopeFile\)/);
});

test("profile starts require visible first-install consent and Camoufox downloads remain cancellable", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "App.tsx"), "utf8");

  assert.match(main, /case "browser_runtime_available"/);
  assert.match(main, /requestId: options\.requestId/);
  assert.match(sidebar, /Download &amp; start/);
  assert.match(sidebar, /browser_runtime_available/);
  assert.match(app, /Stop download/);
  assert.match(app, /nextctl_cancel/);
});

test("terminal chat is isolated by conversation", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  const chat = fs.readFileSync(path.join(__dirname, "..", "src", "components", "ChatView.tsx"), "utf8");
  assert.match(terminal, /\[agentId, conversationId, workspaceId, workingDir, restartNonce\]/);
  assert.match(chat, /conversationId=\{conv\?\.id\}/);
  assert.match(terminal, /terminal_context_menu/);
  assert.match(terminal, /workspaceId: workspaceId \|\| ""/);
  assert.match(chat, /workspaceId=\{conv\?\.workspaceId\}/);
  assert.match(main, /case "terminal_start"[\s\S]*agentControlArtifactScopes\.set\(controlToken/);
  assert.match(main, /case "terminal_update_context"[\s\S]*agentControlArtifactScopes\.set\(record\.controlToken/);
});

test("terminal attachments are staged inside the sandboxed workspace", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const terminal = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AgentTerminal.tsx"), "utf8");
  assert.match(main, /case "select_terminal_files"/);
  assert.match(main, /agentWorkspaceDir\(home\(\)\), "\.attachments", conversation/);
  assert.match(main, /stat\.size > 30 \* 1024 \* 1024/);
  assert.match(main, /totalSize > 600 \* 1024 \* 1024/);
  assert.match(main, /COPYFILE_FICLONE/);
  assert.match(main, /case "remove_terminal_file"/);
  assert.match(terminal, /terminalAttachmentContext\(attachmentsRef\.current\)/);
  assert.match(terminal, /select_terminal_files/);
  assert.match(terminal, /setAttachmentError/);
  assert.match(terminal, /Please inspect the attached file\(s\)\./);
});

test("manual proxy operations use the isolated NextBrowser account configuration", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /listPersonalProxies\(\{ env: childEnv\(\) \}\)/);
  assert.match(main, /createPersonalProxy\(args\.proxy, \{ env: childEnv\(\) \}\)/);
  assert.match(main, /deletePersonalProxy\(args\.id, \{ env: childEnv\(\) \}\)/);
  assert.equal((main.match(/resolvePersonalProxy\(args\.proxyId, \{ env: childEnv\(\) \}\)/g) || []).length, 2);
});

test("ordinary app startup does not unlock the optional Multilogin credential", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const startup = main.slice(main.indexOf("app.whenReady()"), main.indexOf('app.on("open-url"'));
  assert.doesNotMatch(startup, /initializeMultiloginCredential/);
  assert.match(main, /async function multiloginStatus\(\)[\s\S]*initializeMultiloginCredential\(\)/);
});

test("automation artifacts are persisted only in local app storage", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
  assert.match(main, /case "artifact_list"/);
  assert.match(main, /localAutomationArtifacts\(\)\.list/);
  assert.match(main, /case "artifact_import"/);
  assert.match(main, /localAutomationArtifacts\(\)\.importFile/);
  assert.match(main, /case "artifact_open"/);
  assert.match(main, /localAutomationArtifacts\(\)\.resolvePath/);
  assert.match(main, /case "artifact_reveal"[\s\S]*shell\.showItemInFolder\(target\)/);
  assert.match(studio, /Show in File Explorer/);
  assert.match(studio, /Show in Finder/);
  assert.match(main, /case "artifact_delete"/);
  assert.match(main, /localAutomationArtifacts\(\)\.delete/);
  assert.doesNotMatch(main, /listAutomationArtifacts|uploadAutomationArtifact|downloadAutomationArtifact|deleteAutomationArtifact/);
  assert.match(studio, /section === "artifacts" && workspaceId[\s\S]*loadArtifacts\(\)/);
});

test("automation recordings support backend deletion", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /case "automation_recording_delete"/);
  assert.match(main, /deleteAutomationRecording/);
});

test("unfinished recording attempts are never persisted as library entities", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
  assert.doesNotMatch(studio, /status: "recording"/);
  assert.doesNotMatch(sidebar, /automation_recording_delete/);
  assert.doesNotMatch(studio, /RecordingFilter|Clear stopped|STOPPED|No recordings in this view/);
  assert.match(studio, /items\.filter\(\(item\) => !!item\.document\.run\)/);
  assert.match(studio, /Start recording/);
  assert.match(studio, /Stop recording/);
  assert.match(studio, /Capture from Project Chat/);
  assert.match(studio, /Stop &amp; open workflow/);
  assert.match(studio, /startRecording\("workflow", "hybrid"\)/);
  assert.match(studio, /automation_page_recording_start/);
  assert.match(studio, /automation_page_recording_stop/);
  assert.match(sidebar, /nextbrowser:automation-stop-request/);
  assert.match(studio, /nextbrowser:request-stop-recording/);
  assert.doesNotMatch(sidebar, /status: "recording"/);
  assert.match(sidebar, /automation_recording_put[\s\S]*status: "completed"/);
  assert.doesNotMatch(studio, /else \{\s*s\.setTab\("live"\)/);
  assert.match(studio, /if \(s\.terminalChat\) s\.setTerminalChat\(false\);\s*s\.setTab\("chat"\)/);
  assert.match(studio, /s\.setTab\("chat"\);\s*await invoke\("app_focus"\)/);
  assert.match(main, /case "app_focus":[\s\S]*focusMainWindow\(\)/);
  assert.match(main, /case "app_focus":[\s\S]*setTimeout\(\(\) => focusMainWindow\(\), 400\)/);
  assert.match(main, /process\.platform === "darwin"\) app\.focus\(\{ steal: true \}\)/);
  assert.match(main, /window\.show\(\);\s*window\.moveTop\(\);\s*window\.focus\(\)/);
  assert.match(studio, /Open browser/);
  assert.match(studio, /Open Project Chat/);
  assert.doesNotMatch(studio, />Pause recording</);
});

test("automation studio gives newcomers a complete path and runs unsaved edits safely", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  assert.match(studio, /Record a task you can perform once/);
  assert.match(studio, /Build an editable, predictable automation/);
  assert.match(studio, /Keep automation files on this computer/);
  assert.match(studio, /Save &amp; run/);
  assert.match(studio, /min_rows: count/);
  assert.match(studio, /replaceTopCount\(artifactArguments\.name\)/);
  assert.match(studio, /const workflow = draftDirty \? await saveDraft\(\) : draft/);
  assert.match(studio, /still contains “\{\{\$\{missingInput\}\}\}”/);
  assert.doesNotMatch(studio, /disabled=\{draftDirty \|\| executionBusy/);
  assert.doesNotMatch(studio, /className="automation-mode-note"/);
});

test("workflow editing can collapse and restore the workflow library", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
  assert.match(studio, /setWorkflowListCollapsed\(true\)/);
  assert.match(studio, /workflow-list-collapsed/);
  assert.match(studio, /Collapse workflow list/);
  assert.match(studio, /className="workflow-list-restore"/);
  assert.doesNotMatch(studio, /Show workflows|Hide workflows/);
  assert.match(styles, /\.workflow-builder\.workflow-list-collapsed/);
});

test("workflow list exposes the same actions from a right-click menu", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(__dirname, "..", "src", "styles.css"), "utf8");
  assert.match(studio, /onContextMenu=\{\(event\) => openWorkflowContextMenu\(event, skill\.id\)\}/);
  assert.match(studio, /className="workflow-context-menu" role="menu"/);
  assert.match(studio, /Duplicate workflow<\/button>/);
  assert.match(studio, /Delete workflow<\/button>/);
  assert.match(styles, /\.workflow-context-menu/);
});

test("recordings and workflows replay deterministically with explicit AI repair", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.join(__dirname, "..", "src", "components", "Sidebar.tsx"), "utf8");
  const store = fs.readFileSync(path.join(__dirname, "..", "src", "store.ts"), "utf8");

  assert.match(main, /case "automation_recipe_execute"/);
  assert.match(main, /case "automation_recipe_cancel"/);
  assert.match(store, /runAutomationRecipe: async/);
  assert.match(store, /invoke<AutomationRecipeResult>\("automation_recipe_execute"/);
  assert.match(studio, /s\.runAutomationRecipe\(/);
  assert.match(studio, /Choose the browser profile that should run this automation\./);
  assert.match(studio, /phase: "cancelled", detail: "Execution stopped by user\."/);
  assert.match(studio, /Repair & run with AI/);
  assert.match(studio, /AI is adding the missing starting page before this automation runs/);
  assert.match(studio, /Automatic repair could not start\. Original failure:/);
  assert.match(studio, /canRepairMissingStart \? "Repair & run" : "Run again"/);
  assert.match(studio, /runLocalSkill\(repairWorkflow, repairTask\)/);
  assert.match(studio, /workflowSnapshot: workflow/);
  assert.match(studio, /failedExecution\.workflowSnapshot/);
  assert.match(sidebar, /item\.name === automationExecution\.expectedArtifactName/);
  assert.match(sidebar, /"artifact_validate"/);
  assert.match(sidebar, /automation_workflow_put/);
  assert.match(sidebar, /AI repaired the fast path and saved it for future runs/);
  assert.match(sidebar, /automation_run_update[\s\S]*engine: "hybrid"/);
  assert.match(sidebar, /The workflow result was not accepted\./);
  const deterministicRun = store.slice(store.indexOf("runAutomationRecipe: async"), store.indexOf("runLocalSkill: async"));
  assert.doesNotMatch(deterministicRun, /prepareLocalSession/);
});

test("a stopped recording remains recoverable when its backend save fails", () => {
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  assert.match(studio, /let capturedForRetry: CapturedRun \| undefined/);
  assert.match(studio, /capturedForRetry = captured/);
  assert.match(studio, /The recording stopped, but was not saved/);
  assert.match(studio, /Retry save/);
  assert.match(studio, /clearActiveAutomationRecording\(\);[\s\S]*setRecordingReview\(\{/);
});

test("workflow builder selects page elements visually without exposing CSS inputs", () => {
  const main = fs.readFileSync(path.join(__dirname, "main.cjs"), "utf8");
  const studio = fs.readFileSync(path.join(__dirname, "..", "src", "components", "AutomationStudio.tsx"), "utf8");
  assert.match(main, /case "automation_element_pick"/);
  assert.match(main, /case "automation_element_pick_cancel"/);
  assert.match(studio, /Select on page/);
  assert.match(studio, /Select row on page/);
  assert.doesNotMatch(studio, /placeholder="css=/);
  assert.doesNotMatch(studio, /pickElement[\s\S]{0,1200}await s\.start(?:DefaultSession|Profile)/);
  assert.match(studio, /actions\[index\] = \{ tool, arguments: defaultActionArguments\(tool\) \}/);
});
