import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "../electronBridge";
import {
  clearAllMultiloginSelections,
  clearMultiloginSelection,
  multiloginSelectionForWorkspace,
  setMultiloginSelection,
  type MultiloginProfileKind,
  type MultiloginProfileSelection,
} from "../lib/multiloginSelection";
import {
  multiloginProfileSelected,
  multiloginWorkspaceLabel,
  previewMultiloginConnectionStatus,
  type MultiloginConnectionStatus,
  type MultiloginFolder,
  type MultiloginProfileSummary,
} from "../lib/multiloginProfiles";
import { openMultiloginApp } from "../lib/multiloginApp";
import { MULTILOGIN_TOKEN_EXPIRED, userFacingMultiloginError } from "../lib/userFacingMultiloginError";
import { getPreviewMode } from "../preview";
import { Icon, Spinner } from "./Icon";

const MULTILOGIN_URL = "https://app.multilogin.com";
const MULTILOGIN_TOKEN_GUIDE_URL = "https://multilogin.com/help/en_US/help/retrieving-the-token";

export type { MultiloginConnectionStatus, MultiloginProfileSummary } from "../lib/multiloginProfiles";

export type MultiloginTokenSource = "app" | "web";

interface MultiloginConnectorViewProps {
  status: MultiloginConnectionStatus | null;
  checking: boolean;
  busy: boolean;
  dialogOpen: boolean;
  bearerToken: string;
  error?: string;
  confirmDisconnect: boolean;
  reconnecting: boolean;
  folders: MultiloginFolder[];
  foldersLoading: boolean;
  profileKind: MultiloginProfileKind;
  tokenSource: MultiloginTokenSource;
  selection?: MultiloginProfileSelection;
  workspaceName?: string;
  onOpen: () => void;
  onClose: () => void;
  onBearerTokenChange: (value: string) => void;
  onConnect: (event: FormEvent) => void;
  onDisconnectRequest: () => void;
  onDisconnectCancel: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onReconnectCancel: () => void;
  onSelectFolder: (kind: MultiloginProfileKind, folderId: string) => void;
  onOpenMultilogin: () => void;
  onOpenMultiloginApp: () => void;
  onOpenGuide: () => void;
  onProfileKindChange: (kind: MultiloginProfileKind) => void;
  onTokenSourceChange: (source: MultiloginTokenSource) => void;
  onSelectProfile: (kind: MultiloginProfileKind, profile: MultiloginProfileSummary) => void;
  onClearSelection: () => void;
  onRetryStatus?: () => void;
  loginWindowOpen?: boolean;
  onOpenLogin?: () => void;
  onCompleteLogin?: () => void;
}

function connectionLabel(status: MultiloginConnectionStatus | null, checking: boolean): string {
  if (checking) return "Checking";
  if (status?.connected && status.valid) return "Connected";
  if (status?.connected) return "Reconnect";
  return "Not connected";
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function MultiloginConnectorView({
  status,
  checking,
  busy,
  dialogOpen,
  bearerToken,
  error,
  confirmDisconnect,
  reconnecting,
  folders,
  foldersLoading,
  profileKind,
  tokenSource,
  selection,
  workspaceName,
  onOpen,
  onClose,
  onBearerTokenChange,
  onConnect,
  onDisconnectRequest,
  onDisconnectCancel,
  onDisconnect,
  onReconnect,
  onReconnectCancel,
  onSelectFolder,
  onOpenMultilogin,
  onOpenMultiloginApp,
  onOpenGuide,
  onProfileKindChange,
  onTokenSourceChange,
  onSelectProfile,
  onClearSelection,
  onRetryStatus,
  loginWindowOpen,
  onOpenLogin,
  onCompleteLogin,
}: MultiloginConnectorViewProps) {
  const workspaceLabel = multiloginWorkspaceLabel(status?.account);
  const kindFolders = folders.filter((folder) => folder.kind === profileKind);
  const connected = Boolean(status?.connected && status.valid);
  const needsReconnect = Boolean(status?.connected && !status.valid);
  useEffect(() => {
    if (!dialogOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || busy) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [dialogOpen, busy, onClose]);

  // A refused token reads as "expired, reconnect" next to the Reconnect button rather than as nbc's wording.
  const visibleError = error || (status?.error ? userFacingMultiloginError(status.error) : undefined);
  const statusLabel = connectionLabel(status, checking);
  const browserProfiles = status?.browserProfiles ?? [];
  const cloudPhones = status?.cloudPhones ?? [];
  const activeProfiles = profileKind === "browser" ? browserProfiles : cloudPhones;
  const rawProfilesError = profileKind === "browser" ? status?.browserProfilesError : status?.cloudPhonesError;
  const activeProfilesError = rawProfilesError ? userFacingMultiloginError(rawProfilesError, profileKind) : undefined;

  return (
    <>
      <div className="connector-card">
        <span className="connector-logo">
          <img src="./multilogin-icon.svg" alt="" />
        </span>
        <span className="connector-copy">
          <strong>Multilogin</strong>
          <span>Mimic browser profiles and Android cloud phones</span>
        </span>
        <span className={`connector-status${connected ? " is-connected" : needsReconnect ? " is-warning" : ""}`}>
          {checking && <Spinner size={11} />}
          {!checking && <span className="connector-status-dot" />}
          {statusLabel}
        </span>
        <button
          type="button"
          className={connected ? "secondary connector-action" : "primary connector-action"}
          disabled={checking || (!status?.secureStorageAvailable && !visibleError)}
          onClick={onOpen}
        >
          {connected ? "Manage" : needsReconnect ? "Reconnect" : "Connect"}
        </button>
        {status && !status.secureStorageAvailable && (
          <span className="error small connector-card-error">Unlock your system credential store, then reopen Nextbrowser.</span>
        )}
        {!checking && visibleError && (
          <span className="error small connector-card-error" role="alert">
            {visibleError}
            {onRetryStatus && visibleError !== MULTILOGIN_TOKEN_EXPIRED && (
              <>
                {" "}
                <button type="button" className="connector-text-link" onClick={onRetryStatus}>Retry</button>
              </>
            )}
          </span>
        )}
      </div>

      {dialogOpen && (
        <div className="modal-overlay connector-modal-overlay" onMouseDown={() => !busy && onClose()}>
          <div
            className={`modal-card connector-modal${connected ? " connector-modal-connected" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="multilogin-connector-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="connector-modal-head">
              <span className="connector-logo connector-logo-small"><img src="./multilogin-icon.svg" alt="" /></span>
              <span>
                <strong id="multilogin-connector-title">
                  {reconnecting ? "Connect another workspace" : connected ? "Multilogin connected" : "Connect Multilogin"}
                </strong>
                <small>
                  {reconnecting
                    ? "Replaces the saved token"
                    : connected ? "Available to nbc and your agents" : "One-time setup"}
                </small>
              </span>
              <span className="spacer" />
              <button type="button" className="plain-icon-btn" onClick={onClose} disabled={busy} aria-label="Close Multilogin connector">
                <Icon name="xmark" size={17} />
              </button>
            </div>

            {connected && !reconnecting ? (
              <div className="connector-connected-view">
                <div className="connector-connected-summary">
                  <span className="connector-status is-connected"><span className="connector-status-dot" />Connected</span>
                  <span className="muted small">No-expiration token · encrypted on this device</span>
                </div>

                {/* A token opens exactly one workspace, so name it: shared workspaces look like your own otherwise. */}
                <div className="connector-account-row">
                  <span>
                    <small>{workspaceLabel || "Multilogin account"}</small>
                    <strong>{status?.account?.email || "Unknown account"}</strong>
                  </span>
                  <button type="button" className="connector-text-link" disabled={busy} onClick={onReconnect}>
                    Use another token
                  </button>
                </div>

                <div className="connector-profile-tabs" role="tablist" aria-label="Multilogin profile types">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={profileKind === "browser"}
                    className={profileKind === "browser" ? "active" : ""}
                    onClick={() => onProfileKindChange("browser")}
                  >
                    <span>Browser profiles</span>
                    <strong>{browserProfiles.length}</strong>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={profileKind === "mobile"}
                    className={profileKind === "mobile" ? "active" : ""}
                    onClick={() => onProfileKindChange("mobile")}
                  >
                    <span>Cloud phones</span>
                    <strong>{cloudPhones.length}</strong>
                  </button>
                </div>

                {/* Without a choice the CLI picks the workspace's only folder, or asks for one when several exist. */}
                <label className="modal-field connector-folder-field">
                  <span>Folder</span>
                  <select
                    value={status?.folders?.[profileKind] ?? ""}
                    disabled={busy || foldersLoading}
                    aria-label={profileKind === "browser" ? "Browser profile folder" : "Cloud phone folder"}
                    onChange={(event) => onSelectFolder(profileKind, event.target.value)}
                  >
                    <option value="">{foldersLoading ? "Loading folders…" : "All folders"}</option>
                    {kindFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}{folder.profilesCount ? ` (${folder.profilesCount})` : ""}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="connector-profile-picker" role="tabpanel">
                  <div className="connector-profile-picker-head">
                    <span>
                      <strong>{profileKind === "browser" ? "Mimic browser profiles" : "Android cloud phones"}</strong>
                      <small>{workspaceName ? `Choose the default for ${workspaceName}` : "Select a workspace to choose a default"}</small>
                    </span>
                    <span className="muted small">
                      {profileKind === "browser"
                        ? countLabel(browserProfiles.length, "profile", "profiles")
                        : countLabel(cloudPhones.length, "phone", "phones")}
                    </span>
                  </div>
                  <div className="connector-profile-list">
                    {activeProfiles.map((profile) => {
                      const selected = multiloginProfileSelected(selection, profileKind, profile);
                      return (
                        <button
                          type="button"
                          key={`${profile.folderId || ""}:${profile.id}`}
                          className={`connector-profile-row${selected ? " selected" : ""}`}
                          aria-pressed={selected}
                          disabled={!workspaceName}
                          onClick={() => onSelectProfile(profileKind, profile)}
                        >
                          <span className="connector-profile-radio">{selected && <Icon name="checkmark" size={11} />}</span>
                          <span>
                            <strong>{profile.name}</strong>
                            <small>{profile.status || (profileKind === "browser" ? "Mimic browser" : "Cloud phone")}</small>
                          </span>
                          {selected && <span className="connector-profile-default">Default</span>}
                        </button>
                      );
                    })}
                    {!activeProfiles.length && !activeProfilesError && (
                      <div className="connector-profile-empty">
                        No {profileKind === "browser" ? "browser profiles" : "cloud phones"} found.
                      </div>
                    )}
                    {activeProfilesError && <div className="error small connector-profile-error">{activeProfilesError}</div>}
                  </div>
                </div>

                {selection && (
                  <div className="connector-selection-summary">
                    <span>
                      <small>Agent default{workspaceName ? ` · ${workspaceName}` : ""}</small>
                      <strong>{selection.name}</strong>
                    </span>
                    <button type="button" className="connector-text-link" onClick={onClearSelection}>Clear</button>
                  </div>
                )}

                <div className="connector-connected-actions">
                  <button type="button" className="connector-text-link" onClick={onOpenMultilogin}>
                    Open Multilogin <Icon name="arrow.up.forward.app" size={12} />
                  </button>
                  <span className="spacer" />
                  {confirmDisconnect ? (
                    <div className="connector-disconnect-confirm">
                      <span className="small">Remove the saved token?</span>
                      <button type="button" className="secondary" disabled={busy} onClick={onDisconnectCancel}>Cancel</button>
                      <button type="button" className="secondary danger-text" disabled={busy} onClick={onDisconnect}>
                        {busy ? "Removing…" : "Disconnect"}
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="connector-disconnect" disabled={busy} onClick={onDisconnectRequest}>Disconnect</button>
                  )}
                </div>
              </div>
            ) : (
              <form onSubmit={onConnect}>
                {onOpenLogin && <div className="connector-sign-in">
                  <strong>Connect without copying a token</strong>
                  <p className="muted small">Sign in to Multilogin, select the workspace you want to use, then return here to connect.</p>
                  <div className="row">
                    <button type="button" className={loginWindowOpen ? "secondary" : "primary"} disabled={busy} onClick={onOpenLogin}>{loginWindowOpen ? "Reopen Multilogin sign-in" : "Open Multilogin sign-in"}</button>
                    {loginWindowOpen && <button type="button" className="primary" disabled={busy} onClick={onCompleteLogin}>{busy ? "Connecting…" : "Connect selected workspace"}</button>}
                  </div>
                </div>}
                <p className="muted small">Or connect with a token:</p>
                <div className="connector-profile-tabs connector-source-tabs" role="tablist" aria-label="Where to copy the Multilogin token from">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tokenSource === "app"}
                    className={tokenSource === "app" ? "active" : ""}
                    onClick={() => onTokenSourceChange("app")}
                  >
                    <span>Desktop app</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tokenSource === "web"}
                    className={tokenSource === "web" ? "active" : ""}
                    onClick={() => onTokenSourceChange("web")}
                  >
                    <span>Web</span>
                  </button>
                </div>
                {tokenSource === "app" ? (
                  <div className="connector-token-steps connector-token-steps-plain" role="tabpanel">
                    <div><span>1</span><p><button type="button" onClick={onOpenMultiloginApp}>Open the Multilogin desktop app</button> and sign in.</p></div>
                    <div><span>2</span><p>Select your workspace. Open DevTools: <kbd>Ctrl + Shift + F12</kbd> on Windows/Linux or <kbd>Cmd + Shift + Fn + F12</kbd> on macOS.</p></div>
                    <div><span>3</span><p>Open <strong>Application</strong> (Windows) or <strong>Storage</strong> (macOS/Linux) → <strong>Local storage</strong> → <code>wails</code>. Copy the <code>token</code> value. If it is missing, check <strong>Session storage</strong>.</p></div>
                    <p className="muted small">If your version has an Info menu, you can also copy its API token there.</p>
                  </div>
                ) : (
                  <>
                    <div className="connector-token-steps" role="tabpanel">
                      <div><span>1</span><p><button type="button" onClick={onOpenMultilogin}>Open Multilogin</button>, sign in and select your workspace.</p></div>
                      <div><span>2</span><p>Open DevTools with <kbd>⌘ ⌥ I</kbd> on macOS or <kbd>F12</kbd> on Windows/Linux.</p></div>
                      <div><span>3</span><p><strong>Application</strong> in Chrome, <strong>Storage</strong> in Firefox and Safari → <strong>Local storage</strong> → <code>https://app.multilogin.com</code> → copy the <code>token</code> value. If it is missing, check <strong>Session storage</strong>.</p></div>
                      <MultiloginWebTokenFigure />
                    </div>
                  </>
                )}
                <button type="button" className="connector-text-link connector-guide-link" onClick={onOpenGuide}>
                  Multilogin token guide <Icon name="arrow.up.forward.app" size={12} />
                </button>
                <label className="modal-field connector-token-field">
                  <span>{tokenSource === "app" ? "API token" : "Bearer token"}</span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={bearerToken}
                    placeholder="eyJ…"
                    disabled={busy}
                    onChange={(event) => onBearerTokenChange(event.target.value)}
                  />
                </label>
                {visibleError && <div className="error small connector-error">{visibleError}</div>}
                <div className="modal-actions connector-modal-actions">
                  <span className="muted small">Token is discarded after exchange.</span>
                  <span className="spacer" />
                  <button type="button" className="secondary" disabled={busy} onClick={reconnecting ? onReconnectCancel : onClose}>Cancel</button>
                  <button type="submit" className="primary" disabled={busy || !bearerToken.trim()}>
                    {busy ? <><Spinner size={12} /> Connecting…</> : "Connect"}
                  </button>
                </div>
              </form>
            )}

            {connected && visibleError && <div className="error small connector-error">{visibleError}</div>}
          </div>
        </div>
      )}
    </>
  );
}

function MultiloginWebTokenFigure() {
  return (
    <figure className="connector-token-figure" aria-hidden="true">
      <svg viewBox="0 0 424 126" role="presentation" focusable="false">
        <rect x="1" y="4" width="422" height="118" rx="9" fill="var(--surface-2)" stroke="var(--line-strong)" />
        {/* Only tab names every browser shares; the panel itself is Application in Chrome, Storage elsewhere. */}
        <text x="14" y="21" fontSize="8.5" fill="var(--muted)">Console</text>
        <text x="56" y="21" fontSize="8.5" fill="var(--muted)">Network</text>
        <text x="100" y="21" fontSize="8.5" fill="var(--accent-text)" fontWeight="600">Application</text>
        <line x1="98" y1="26" x2="152" y2="26" stroke="var(--accent)" strokeWidth="1.5" />
        <text x="158" y="21" fontSize="8" fill="var(--muted)">or Storage</text>
        <line x1="1" y1="30" x2="423" y2="30" stroke="var(--line-strong)" />
        <line x1="152" y1="30" x2="152" y2="122" stroke="var(--line-strong)" />

        {/* Storage tree */}
        <text x="14" y="47" fontSize="8.5" fill="var(--text)">Local storage</text>
        <rect x="20" y="54" width="124" height="17" rx="5" fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x="27" y="66" fontSize="8" fill="var(--accent-text)">app.multilogin.com</text>
        <text x="14" y="88" fontSize="8.5" fill="var(--muted)">Session storage</text>
        <text x="14" y="105" fontSize="8.5" fill="var(--muted)">Cookies</text>

        {/* Key / value table */}
        <text x="164" y="47" fontSize="8" fill="var(--muted)">Key</text>
        <text x="272" y="47" fontSize="8" fill="var(--muted)">Value</text>
        <line x1="158" y1="53" x2="414" y2="53" stroke="var(--line)" />
        <text x="164" y="68" fontSize="8" fill="var(--muted)">email</text>
        <text x="272" y="68" fontSize="8" fill="var(--muted)">you@example.com</text>
        <rect x="158" y="76" width="256" height="20" rx="5" fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x="165" y="89" fontSize="8.5" fill="var(--text)" fontWeight="600">token</text>
        <text x="272" y="89" fontSize="8" fill="var(--accent-text)">eyJhbGciOiJIUzI1…</text>
        <path d="M196 116 Q 240 114 250 99" fill="none" stroke="var(--accent)" strokeWidth="1.3" markerEnd="url(#ml-web-arrow)" />
        <defs>
          <marker id="ml-web-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 1 L7 4 L0 7 Z" fill="var(--accent)" />
          </marker>
        </defs>
      </svg>
    </figure>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function MultiloginConnector({
  workspace,
  onSelectAsAgentDefault,
  autoOpen,
  onConnected,
  onDismiss,
}: {
  workspace?: { id: string; name: string };
  onSelectAsAgentDefault?: () => void;
  autoOpen?: boolean;
  onConnected?: () => void;
  onDismiss?: () => void;
}) {
  const preview = getPreviewMode();
  const previewWorkspace = preview ? { id: "preview", name: "Current workspace" } : undefined;
  const selectionWorkspace = workspace ?? previewWorkspace;
  const [status, setStatus] = useState<MultiloginConnectionStatus | null>(() => preview ? previewMultiloginConnectionStatus() : null);
  const [checking, setChecking] = useState(!preview);
  const [statusRetry, setStatusRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bearerToken, setBearerToken] = useState("");
  const [error, setError] = useState<string>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [folders, setFolders] = useState<MultiloginFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [profileKind, setProfileKind] = useState<MultiloginProfileKind>("browser");
  const [tokenSource, setTokenSource] = useState<MultiloginTokenSource>("app");
  const [loginWindowOpen, setLoginWindowOpen] = useState(false);
  const [selection, setSelection] = useState<MultiloginProfileSelection>();

  useEffect(() => () => { void invoke("multilogin_login_cancel").catch(() => {}); }, []);

  const openLogin = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await invoke("multilogin_login_open");
      setLoginWindowOpen(true);
    } catch (loginError) {
      setLoginWindowOpen(false);
      setError(errorMessage(loginError));
    } finally { setBusy(false); }
  };

  const completeLogin = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await invoke<MultiloginConnectionStatus>("multilogin_login_complete");
      setStatus(nextStatus);
      setBearerToken("");
      setReconnecting(false);
      setLoginWindowOpen(false);
      if (nextStatus.connected && nextStatus.valid) onConnected?.();
    } catch (loginError) { setError(errorMessage(loginError)); }
    finally { setBusy(false); }
  };

  // Another flow can send someone here purely to finish the one-time setup.
  useEffect(() => {
    if (autoOpen) setDialogOpen(true);
  }, [autoOpen]);

  useEffect(() => {
    const nextSelection = multiloginSelectionForWorkspace(selectionWorkspace?.id);
    setSelection(nextSelection);
    if (nextSelection) setProfileKind(nextSelection.kind);
  }, [selectionWorkspace?.id]);

  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
    setChecking(true);
    invoke<MultiloginConnectionStatus>("multilogin_status")
      .then((nextStatus) => {
        if (!cancelled) setStatus(nextStatus);
      })
      .catch((statusError) => {
        if (!cancelled) setError(errorMessage(statusError));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [preview, statusRetry]);

  // Folders are only needed once the dialog is open, and only for a live connection.
  useEffect(() => {
    if (preview || !dialogOpen || !status?.connected || !status.valid) return undefined;
    let cancelled = false;
    setFoldersLoading(true);
    invoke<MultiloginFolder[]>("multilogin_folders_list")
      .then((loaded) => { if (!cancelled) setFolders(Array.isArray(loaded) ? loaded : []); })
      .catch(() => { if (!cancelled) setFolders([]); })
      .finally(() => { if (!cancelled) setFoldersLoading(false); });
    return () => { cancelled = true; };
  }, [preview, dialogOpen, status?.connected, status?.valid]);

  const selectFolder = async (kind: MultiloginProfileKind, folderId: string) => {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await invoke<MultiloginConnectionStatus>("multilogin_folder_select", { kind, folderId }));
    } catch (selectError) {
      setError(errorMessage(selectError));
    } finally {
      setBusy(false);
    }
  };

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !bearerToken.trim()) return;
    const copiedBearerToken = bearerToken;
    setBearerToken("");
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await invoke<MultiloginConnectionStatus>("multilogin_connect", { bearerToken: copiedBearerToken });
      await invoke("multilogin_login_cancel").catch(() => {});
      setLoginWindowOpen(false);
      setStatus(nextStatus);
      setReconnecting(false);
      if (nextStatus.connected && nextStatus.valid) onConnected?.();
    } catch (connectError) {
      setError(errorMessage(connectError));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await invoke<MultiloginConnectionStatus>("multilogin_disconnect");
      clearAllMultiloginSelections();
      setSelection(undefined);
      setStatus(nextStatus);
      setConfirmDisconnect(false);
      setDialogOpen(false);
    } catch (disconnectError) {
      setError(errorMessage(disconnectError));
    } finally {
      setBusy(false);
    }
  };

  const selectProfile = (kind: MultiloginProfileKind, profile: MultiloginProfileSummary) => {
    if (!selectionWorkspace) return;
    const nextSelection = { kind, id: profile.id, name: profile.name, folderId: profile.folderId };
    onSelectAsAgentDefault?.();
    setMultiloginSelection(selectionWorkspace.id, nextSelection);
    setSelection(nextSelection);
  };

  const clearSelection = () => {
    clearMultiloginSelection(selectionWorkspace?.id);
    setSelection(undefined);
  };

  const openExternal = (url: string) => {
    void invoke("open_external", { url }).catch(() => window.open(url, "_blank", "noopener,noreferrer"));
  };


  const closeDialog = () => {
    if (busy) return;
    void invoke("multilogin_login_cancel").catch(() => {});
    setLoginWindowOpen(false);
    onDismiss?.();
    setDialogOpen(false);
    setBearerToken("");
    setError(undefined);
    setConfirmDisconnect(false);
    setReconnecting(false);
  };

  return (
    <MultiloginConnectorView
      status={status}
      checking={checking}
      busy={busy}
      dialogOpen={dialogOpen}
      bearerToken={bearerToken}
      error={error}
      confirmDisconnect={confirmDisconnect}
      reconnecting={reconnecting}
      folders={folders}
      foldersLoading={foldersLoading}
      profileKind={profileKind}
      tokenSource={tokenSource}
      loginWindowOpen={loginWindowOpen}
      onOpenLogin={() => void openLogin()}
      onCompleteLogin={() => void completeLogin()}
      selection={selection}
      workspaceName={selectionWorkspace?.name}
      onOpen={() => { setDialogOpen(true); setError(undefined); }}
      onClose={closeDialog}
      onBearerTokenChange={setBearerToken}
      onConnect={(event) => void connect(event)}
      onDisconnectRequest={() => setConfirmDisconnect(true)}
      onDisconnectCancel={() => setConfirmDisconnect(false)}
      onDisconnect={() => void disconnect()}
      onReconnect={() => { setReconnecting(true); setBearerToken(""); setError(undefined); }}
      onReconnectCancel={() => {
        void invoke("multilogin_login_cancel").catch(() => {});
        setLoginWindowOpen(false);
        setReconnecting(false); setBearerToken(""); setError(undefined);
      }}
      onSelectFolder={(kind, folderId) => void selectFolder(kind, folderId)}
      onOpenMultilogin={() => openExternal(MULTILOGIN_URL)}
      onOpenMultiloginApp={() => void openMultiloginApp()}
      onOpenGuide={() => openExternal(MULTILOGIN_TOKEN_GUIDE_URL)}
      onProfileKindChange={setProfileKind}
      onTokenSourceChange={setTokenSource}
      onSelectProfile={selectProfile}
      onClearSelection={clearSelection}
      onRetryStatus={() => { setError(undefined); setStatusRetry((count) => count + 1); }}
    />
  );
}
