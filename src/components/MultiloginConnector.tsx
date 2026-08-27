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
  previewMultiloginConnectionStatus,
  type MultiloginConnectionStatus,
  type MultiloginProfileSummary,
} from "../lib/multiloginProfiles";
import { getPreviewMode } from "../preview";
import { Icon, Spinner } from "./Icon";

const MULTILOGIN_URL = "https://app.multilogin.com";
const MULTILOGIN_TOKEN_GUIDE_URL = "https://multilogin.com/help/en_US/retrieving-the-token";

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
  onOpenMultilogin: () => void;
  onOpenGuide: () => void;
  onProfileKindChange: (kind: MultiloginProfileKind) => void;
  onTokenSourceChange: (source: MultiloginTokenSource) => void;
  onSelectProfile: (kind: MultiloginProfileKind, profile: MultiloginProfileSummary) => void;
  onClearSelection: () => void;
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
  onOpenMultilogin,
  onOpenGuide,
  onProfileKindChange,
  onTokenSourceChange,
  onSelectProfile,
  onClearSelection,
}: MultiloginConnectorViewProps) {
  const connected = Boolean(status?.connected && status.valid);
  const needsReconnect = Boolean(status?.connected && !status.valid);
  const visibleError = error || status?.error;
  const statusLabel = connectionLabel(status, checking);
  const browserProfiles = status?.browserProfiles ?? [];
  const cloudPhones = status?.cloudPhones ?? [];
  const activeProfiles = profileKind === "browser" ? browserProfiles : cloudPhones;
  const activeProfilesError = profileKind === "browser" ? status?.browserProfilesError : status?.cloudPhonesError;

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
          disabled={checking || !status?.secureStorageAvailable}
          onClick={onOpen}
        >
          {connected ? "Manage" : needsReconnect ? "Reconnect" : "Connect"}
        </button>
        {status && !status.secureStorageAvailable && (
          <span className="error small connector-card-error">Unlock your system credential store, then reopen NextBrowser.</span>
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
                <strong id="multilogin-connector-title">{connected ? "Multilogin connected" : "Connect Multilogin"}</strong>
                <small>{connected ? "Available to nbc and your agents" : "One-time setup"}</small>
              </span>
              <span className="spacer" />
              <button type="button" className="plain-icon-btn" onClick={onClose} disabled={busy} aria-label="Close Multilogin connector">
                <Icon name="xmark" size={17} />
              </button>
            </div>

            {connected ? (
              <div className="connector-connected-view">
                <div className="connector-connected-summary">
                  <span className="connector-status is-connected"><span className="connector-status-dot" />Connected</span>
                  <span className="muted small">No-expiration token · encrypted on this device</span>
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
                    <div><span>1</span><p>Open the Multilogin desktop app and sign in.</p></div>
                    <div><span>2</span><p>Click <strong>Info</strong> in the bottom-left corner of the profile list.</p></div>
                    <div><span>3</span><p>In the Information dialog, press <strong>Copy</strong> next to <strong>API token</strong>, then paste it below.</p></div>
                    <MultiloginAppTokenFigure />
                  </div>
                ) : (
                  <>
                    <div className="connector-token-steps" role="tabpanel">
                      <div><span>1</span><p><button type="button" onClick={onOpenMultilogin}>Open Multilogin</button> and sign in.</p></div>
                      <div><span>2</span><p>Open DevTools with <kbd>⌘ ⌥ I</kbd> on macOS or <kbd>F12</kbd> on Windows/Linux.</p></div>
                      <div><span>3</span><p><strong>Application</strong> → <strong>Local storage</strong> → <code>https://app.multilogin.com</code> → copy the <code>token</code> value.</p></div>
                      <MultiloginWebTokenFigure />
                    </div>
                    <button type="button" className="connector-text-link connector-guide-link" onClick={onOpenGuide}>
                      Multilogin token guide <Icon name="arrow.up.forward.app" size={12} />
                    </button>
                  </>
                )}
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
                  <button type="button" className="secondary" disabled={busy} onClick={onClose}>Cancel</button>
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

function MultiloginAppTokenFigure() {
  return (
    <figure className="connector-token-figure" aria-hidden="true">
      <svg viewBox="0 0 424 132" role="presentation" focusable="false">
        <defs>
          <marker id="ml-token-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 1 L7 4 L0 7 Z" fill="var(--accent)" />
          </marker>
        </defs>

        {/* Multilogin window — Info lives in the bottom-left corner */}
        <rect x="1" y="6" width="192" height="120" rx="9" fill="var(--surface-2)" stroke="var(--line-strong)" />
        <rect x="11" y="16" width="52" height="11" rx="5" fill="var(--surface-4)" />
        <rect x="11" y="38" width="170" height="9" rx="4" fill="var(--surface-3)" />
        <rect x="11" y="54" width="170" height="9" rx="4" fill="var(--surface-3)" />
        <rect x="11" y="70" width="170" height="9" rx="4" fill="var(--surface-3)" />
        <line x1="1" y1="92" x2="193" y2="92" stroke="var(--line-strong)" />
        <rect x="11" y="101" width="58" height="20" rx="10" fill="var(--accent-soft)" stroke="var(--accent)" />
        <circle cx="24" cy="111" r="4.5" fill="none" stroke="var(--accent-text)" strokeWidth="1.2" />
        <line x1="24" y1="110" x2="24" y2="113.5" stroke="var(--accent-text)" strokeWidth="1.2" strokeLinecap="round" />
        <circle cx="24" cy="108.2" r="0.7" fill="var(--accent-text)" />
        <text x="34" y="114" fontSize="9.5" fill="var(--accent-text)">Info</text>
        <path d="M120 78 Q 104 112 78 111" fill="none" stroke="var(--accent)" strokeWidth="1.3" markerEnd="url(#ml-token-arrow)" />

        {/* then: the Information dialog */}
        <path d="M203 60 L211 66 L203 72" fill="none" stroke="var(--muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />

        <rect x="223" y="6" width="200" height="120" rx="9" fill="var(--surface-2)" stroke="var(--line-strong)" />
        <text x="235" y="27" fontSize="10" fontWeight="600" fill="var(--text)">Information</text>
        <line x1="404" y1="19" x2="411" y2="26" stroke="var(--muted)" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="411" y1="19" x2="404" y2="26" stroke="var(--muted)" strokeWidth="1.2" strokeLinecap="round" />
        <line x1="223" y1="36" x2="423" y2="36" stroke="var(--line-strong)" />
        <text x="235" y="53" fontSize="9" fill="var(--muted)">App version</text>
        <text x="411" y="53" fontSize="9" fill="var(--muted)" textAnchor="end">12.10.1</text>
        <rect x="229" y="61" width="188" height="24" rx="7" fill="var(--accent-soft)" stroke="var(--accent)" />
        <text x="237" y="77" fontSize="9" fill="var(--text)">API token</text>
        <rect x="357" y="66" width="52" height="14" rx="4" fill="var(--surface-5)" />
        <text x="383" y="76" fontSize="8.5" fill="var(--text)" textAnchor="middle">Copy</text>
        <text x="235" y="103" fontSize="9" fill="var(--muted)">Workspace ID</text>
        <text x="411" y="103" fontSize="9" fill="var(--muted)" textAnchor="end">Copy</text>
        <path d="M300 112 Q 356 110 380 88" fill="none" stroke="var(--accent)" strokeWidth="1.3" markerEnd="url(#ml-token-arrow)" />
      </svg>
    </figure>
  );
}

function MultiloginWebTokenFigure() {
  return (
    <figure className="connector-token-figure" aria-hidden="true">
      <svg viewBox="0 0 424 126" role="presentation" focusable="false">
        <rect x="1" y="4" width="422" height="118" rx="9" fill="var(--surface-2)" stroke="var(--line-strong)" />
        <text x="14" y="21" fontSize="8.5" fill="var(--muted)">Elements</text>
        <text x="58" y="21" fontSize="8.5" fill="var(--muted)">Console</text>
        <text x="100" y="21" fontSize="8.5" fill="var(--accent-text)" fontWeight="600">Application</text>
        <line x1="98" y1="26" x2="152" y2="26" stroke="var(--accent)" strokeWidth="1.5" />
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
}: {
  workspace?: { id: string; name: string };
  onSelectAsAgentDefault?: () => void;
}) {
  const preview = getPreviewMode();
  const previewWorkspace = preview ? { id: "preview", name: "Current workspace" } : undefined;
  const selectionWorkspace = workspace ?? previewWorkspace;
  const [status, setStatus] = useState<MultiloginConnectionStatus | null>(() => preview ? previewMultiloginConnectionStatus() : null);
  const [checking, setChecking] = useState(!preview);
  const [busy, setBusy] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bearerToken, setBearerToken] = useState("");
  const [error, setError] = useState<string>();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [profileKind, setProfileKind] = useState<MultiloginProfileKind>("browser");
  const [tokenSource, setTokenSource] = useState<MultiloginTokenSource>("app");
  const [selection, setSelection] = useState<MultiloginProfileSelection>();

  useEffect(() => {
    const nextSelection = multiloginSelectionForWorkspace(selectionWorkspace?.id);
    setSelection(nextSelection);
    if (nextSelection) setProfileKind(nextSelection.kind);
  }, [selectionWorkspace?.id]);

  useEffect(() => {
    if (preview) return undefined;
    let cancelled = false;
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
  }, [preview]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !bearerToken.trim()) return;
    const copiedBearerToken = bearerToken;
    setBearerToken("");
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await invoke<MultiloginConnectionStatus>("multilogin_connect", { bearerToken: copiedBearerToken });
      setStatus(nextStatus);
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
    setDialogOpen(false);
    setBearerToken("");
    setError(undefined);
    setConfirmDisconnect(false);
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
      profileKind={profileKind}
      tokenSource={tokenSource}
      selection={selection}
      workspaceName={selectionWorkspace?.name}
      onOpen={() => { setDialogOpen(true); setError(undefined); }}
      onClose={closeDialog}
      onBearerTokenChange={setBearerToken}
      onConnect={(event) => void connect(event)}
      onDisconnectRequest={() => setConfirmDisconnect(true)}
      onDisconnectCancel={() => setConfirmDisconnect(false)}
      onDisconnect={() => void disconnect()}
      onOpenMultilogin={() => openExternal(MULTILOGIN_URL)}
      onOpenGuide={() => openExternal(MULTILOGIN_TOKEN_GUIDE_URL)}
      onProfileKindChange={setProfileKind}
      onTokenSourceChange={setTokenSource}
      onSelectProfile={selectProfile}
      onClearSelection={clearSelection}
    />
  );
}
