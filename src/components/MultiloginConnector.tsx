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

interface MultiloginConnectorViewProps {
  status: MultiloginConnectionStatus | null;
  checking: boolean;
  busy: boolean;
  dialogOpen: boolean;
  bearerToken: string;
  error?: string;
  confirmDisconnect: boolean;
  profileKind: MultiloginProfileKind;
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
                <div className="connector-token-steps">
                  <div><span>1</span><p><button type="button" onClick={onOpenMultilogin}>Open Multilogin</button> and sign in.</p></div>
                  <div><span>2</span><p>Open DevTools with <kbd>⌘ ⇧ Fn F12</kbd> on macOS or <kbd>Ctrl ⇧ F12</kbd> on Windows/Linux.</p></div>
                  <div><span>3</span><p>Storage → Local or Session storage → <code>wails</code> → copy the full <code>token</code> value.</p></div>
                </div>
                <button type="button" className="connector-text-link connector-guide-link" onClick={onOpenGuide}>
                  Multilogin token guide <Icon name="arrow.up.forward.app" size={12} />
                </button>
                <label className="modal-field connector-token-field">
                  <span>Bearer token</span>
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
                  <span className="muted small">Bearer is discarded after exchange.</span>
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
      onSelectProfile={selectProfile}
      onClearSelection={clearSelection}
    />
  );
}
