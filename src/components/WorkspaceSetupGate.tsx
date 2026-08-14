import { useState, type FormEvent } from "react";
import { ROTATION_COUNTRIES } from "../lib/countryFlag";
import { internalError } from "../lib/userFacingError";
import { useStore } from "../store";
import { CountrySelect } from "./CountrySelect";
import { Icon, Spinner } from "./Icon";

export function WorkspaceSetupGate() {
  const s = useStore();
  const workspace = s.workspaces.find((item) => item.id === s.activeWorkspaceId);
  const chats = workspace ? s.conversations.filter((chat) => chat.workspaceId === workspace.id) : [];
  const [workspaceName, setWorkspaceName] = useState("");
  const [chatName, setChatName] = useState("");
  const [chatMode, setChatMode] = useState<"chat" | "terminal">("chat");
  const [profileName, setProfileName] = useState("");
  const [country, setCountry] = useState("US");
  const [direct, setDirect] = useState(false);
  const [toolset, setToolset] = useState<"clawbrowser" | "dasbrowser">("clawbrowser");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(undefined);
    try {
      if (!workspace) {
        await s.createWorkspace(workspaceName);
      } else if (chats.length === 0) {
        s.createProject(chatName, chatMode);
      } else {
        const name = profileName.trim();
        await s.createManagedProfile(name, country, { runtime: toolset, direct });
        s.assignProfileToProject(name, toolset, workspace.id);
        s.completeWorkspaceSetup();
      }
    } catch (cause) {
      console.error("[WORKSPACE_SETUP_FAILED]", cause);
      setError(internalError("We couldn't complete workspace setup.", "WORKSPACE_SETUP_FAILED"));
    } finally {
      setSaving(false);
    }
  };

  const step = !workspace ? 1 : chats.length === 0 ? 2 : 3;
  return (
    <div className="modal-overlay workspace-setup-overlay">
      <form className="modal-card workspace-setup-card" onSubmit={submit}>
        <div className="workspace-setup-progress" aria-label={`Setup step ${step} of 3`}>
          {[1, 2, 3].map((value) => <span key={value} className={value <= step ? "active" : ""} />)}
        </div>
        <div className="workspace-setup-heading">
          <Icon name={step === 1 ? "square.grid.2x2.fill" : step === 2 ? "bubble.left.and.bubble.right.fill" : "globe"} size={20} />
          <div>
            <small>Step {step} of 3</small>
            <h2>{step === 1 ? "Create your workspace" : step === 2 ? "Create the first chat" : "Create the first browser profile"}</h2>
          </div>
        </div>
        <p className="muted workspace-setup-copy">
          {step === 1 && "A workspace keeps related chats and browser profiles together."}
          {step === 2 && "Each chat has its own agent context inside this workspace."}
          {step === 3 && "Profiles belong to the workspace and can be used by one running chat at a time."}
        </p>
        {step === 1 && <label className="modal-field"><span>Workspace name</span><input autoFocus value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder="My workspace" /></label>}
        {step === 2 && <>
          <label className="modal-field"><span>Chat name</span><input autoFocus value={chatName} onChange={(event) => setChatName(event.target.value)} placeholder="First chat" /></label>
          <fieldset className="project-mode-field"><legend>Interface</legend>
            <label className={"project-mode-option" + (chatMode === "chat" ? " is-selected" : "")}><input type="radio" checked={chatMode === "chat"} onChange={() => setChatMode("chat")} /><Icon name="bubble.left.and.bubble.right.fill" size={16} /><span><strong>Chat</strong><small>Regular conversation UI</small></span></label>
            <label className={"project-mode-option" + (chatMode === "terminal" ? " is-selected" : "")}><input type="radio" checked={chatMode === "terminal"} onChange={() => setChatMode("terminal")} /><Icon name="terminal" size={16} /><span><strong>Terminal</strong><small>Persistent agent terminal</small></span></label>
          </fieldset>
        </>}
        {step === 3 && <>
          <label className="modal-field"><span>Profile name</span><input autoFocus value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Browser profile" /></label>
          <fieldset className="project-mode-field"><legend>Connection</legend>
            <label className={"project-mode-option" + (direct ? " is-selected" : "")}><input type="radio" checked={direct} onChange={() => setDirect(true)} /><Icon name="network" size={16} /><span><strong>No proxy</strong><small>Direct internet connection</small></span></label>
            <label className={"project-mode-option" + (!direct ? " is-selected" : "")}><input type="radio" checked={!direct} onChange={() => setDirect(false)} /><Icon name="globe" size={16} /><span><strong>Managed proxy</strong><small>Choose a country</small></span></label>
          </fieldset>
          {!direct && <div className="modal-field"><span>Proxy country</span><CountrySelect countries={s.proxyCountries.length ? s.proxyCountries : ROTATION_COUNTRIES} value={country} onChange={setCountry} ariaLabel="Proxy country" /></div>}
          <fieldset className="project-mode-field"><legend>Browser</legend>
            <label className={"project-mode-option" + (toolset === "clawbrowser" ? " is-selected" : "")}><input type="radio" checked={toolset === "clawbrowser"} onChange={() => setToolset("clawbrowser")} /><Icon name="globe" size={16} /><span><strong>ClawBrowser</strong><small>Managed browser runtime</small></span></label>
            <label className={"project-mode-option" + (toolset === "dasbrowser" ? " is-selected" : "")}><input type="radio" checked={toolset === "dasbrowser"} onChange={() => setToolset("dasbrowser")} /><Icon name="safari" size={16} /><span><strong>DasBrowser</strong><small>Multi-account browser</small></span></label>
          </fieldset>
        </>}
        {error && <div className="error small">{error}</div>}
        <button className="primary workspace-setup-submit" disabled={saving || (step === 1 ? !workspaceName.trim() : step === 2 ? !chatName.trim() : !profileName.trim())}>
          {saving ? <Spinner size={13} /> : <Icon name="arrow.right" size={13} />}
          {step === 3 ? "Finish setup" : "Continue"}
        </button>
      </form>
    </div>
  );
}
