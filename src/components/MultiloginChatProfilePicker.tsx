import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { invoke } from "../electronBridge";
import {
  clearMultiloginSelection,
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

interface MultiloginChatProfilePickerViewProps {
  status: MultiloginConnectionStatus | null;
  selection?: MultiloginProfileSelection;
  open: boolean;
  checking: boolean;
  refreshing: boolean;
  profileKind: MultiloginProfileKind;
  query: string;
  error?: string;
  onToggle: () => void;
  onClose: () => void;
  onRefresh: () => void;
  onProfileKindChange: (kind: MultiloginProfileKind) => void;
  onQueryChange: (query: string) => void;
  onSelect: (kind: MultiloginProfileKind, profile: MultiloginProfileSummary) => void;
  onClear: () => void;
  onManage: () => void;
  searchRef?: RefObject<HTMLInputElement>;
}

function filteredProfiles(profiles: MultiloginProfileSummary[], query: string): MultiloginProfileSummary[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return profiles;
  return profiles.filter((profile) => profile.name.toLocaleLowerCase().includes(normalized));
}

export function MultiloginChatProfilePickerView({
  status,
  selection,
  open,
  checking,
  refreshing,
  profileKind,
  query,
  error,
  onToggle,
  onClose,
  onRefresh,
  onProfileKindChange,
  onQueryChange,
  onSelect,
  onClear,
  onManage,
  searchRef,
}: MultiloginChatProfilePickerViewProps) {
  // A persisted selection can be rendered without unlocking its credential.
  // Validate it only when the person explicitly opens the picker.
  const connected = status == null ? Boolean(selection) : Boolean(status.connected && status.valid);
  if (!selection && !status?.connected) return null;

  const browserProfiles = status?.browserProfiles ?? [];
  const cloudPhones = status?.cloudPhones ?? [];
  const activeProfiles = profileKind === "browser" ? browserProfiles : cloudPhones;
  const visibleProfiles = filteredProfiles(activeProfiles, query);
  const profileError = profileKind === "browser" ? status?.browserProfilesError : status?.cloudPhonesError;
  const connectionError = error || (!connected ? status?.error || "Reconnect Multilogin to load profiles." : undefined);
  const triggerLabel = selection?.name || (connected ? "Multilogin" : "Reconnect");

  return (
    <div className="multilogin-chat-picker">
      <button
        type="button"
        className={`profile-pill multilogin-profile-trigger${selection ? " is-selected" : ""}${open ? " is-open" : ""}${!connected ? " is-warning" : ""}`}
        title={selection ? `Change Multilogin profile · ${selection.name}` : "Choose a Multilogin profile"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onToggle}
      >
        <img src="./multilogin-icon.svg" alt="" />
        <span>{triggerLabel}</span>
        {checking ? <Spinner size={10} /> : <Icon name="chevron.down" size={10} className="multilogin-profile-chevron" />}
      </button>

      {open && (
        <div className="multilogin-chat-menu" role="dialog" aria-label="Choose Multilogin profile">
          <div className="multilogin-chat-menu-head">
            <span>
              <strong>Multilogin profile</strong>
              <small>Used by this chat</small>
            </span>
            <button type="button" className="plain-icon-btn" onClick={onRefresh} disabled={refreshing} aria-label="Refresh Multilogin profiles">
              {refreshing ? <Spinner size={13} /> : <Icon name="arrow.clockwise" size={13} />}
            </button>
            <button type="button" className="plain-icon-btn" onClick={onClose} aria-label="Close profile picker">
              <Icon name="xmark" size={14} />
            </button>
          </div>

          <div className="multilogin-chat-tabs" role="tablist" aria-label="Multilogin profile type">
            <button
              type="button"
              role="tab"
              aria-selected={profileKind === "browser"}
              className={profileKind === "browser" ? "active" : ""}
              onClick={() => onProfileKindChange("browser")}
            >
              Browsers <span>{browserProfiles.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={profileKind === "mobile"}
              className={profileKind === "mobile" ? "active" : ""}
              onClick={() => onProfileKindChange("mobile")}
            >
              Phones <span>{cloudPhones.length}</span>
            </button>
          </div>

          <label className="multilogin-chat-search">
            <Icon name="magnifyingglass" size={13} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder={profileKind === "browser" ? "Search browser profiles" : "Search cloud phones"}
              aria-label={profileKind === "browser" ? "Search browser profiles" : "Search cloud phones"}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </label>

          {connectionError && <div className="multilogin-chat-error">{connectionError}</div>}
          {!connectionError && profileError && <div className="multilogin-chat-error">{profileError}</div>}

          {!connectionError && (
            <div className="multilogin-chat-options" role="listbox" aria-label={profileKind === "browser" ? "Browser profiles" : "Cloud phones"}>
              {visibleProfiles.map((profile) => {
                const selected = multiloginProfileSelected(selection, profileKind, profile);
                return (
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={`multilogin-chat-option${selected ? " selected" : ""}`}
                    key={`${profile.folderId || ""}:${profile.id}`}
                    onClick={() => onSelect(profileKind, profile)}
                  >
                    <span className="multilogin-chat-radio">{selected && <Icon name="checkmark" size={10} />}</span>
                    <span>
                      <strong>{profile.name}</strong>
                      <small>{profile.status || (profileKind === "browser" ? "Mimic browser" : "Cloud phone")}</small>
                    </span>
                  </button>
                );
              })}
              {!visibleProfiles.length && (
                <div className="multilogin-chat-empty">
                  {query.trim() ? "No matching profiles" : `No ${profileKind === "browser" ? "browser profiles" : "cloud phones"} found`}
                </div>
              )}
            </div>
          )}

          <div className="multilogin-chat-menu-foot">
            {selection && <button type="button" onClick={onClear}>Clear selection</button>}
            <span className="spacer" />
            <button type="button" onClick={onManage}>Manage connector</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function MultiloginChatProfilePicker({
  workspaceId,
  selection,
  onSelectAsAgentDefault,
  onManage,
}: {
  workspaceId?: string;
  selection?: MultiloginProfileSelection;
  onSelectAsAgentDefault: () => void;
  onManage: () => void;
}) {
  const preview = getPreviewMode();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<MultiloginConnectionStatus | null>(() => preview ? previewMultiloginConnectionStatus() : null);
  const [checking, setChecking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  const [profileKind, setProfileKind] = useState<MultiloginProfileKind>(selection?.kind ?? "browser");
  const [query, setQuery] = useState("");

  const loadStatus = useCallback(async (refresh = false) => {
    if (preview) {
      setStatus(previewMultiloginConnectionStatus());
      return;
    }
    if (refresh) setRefreshing(true);
    else setChecking(true);
    setError(undefined);
    try {
      setStatus(await invoke<MultiloginConnectionStatus>("multilogin_status"));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : String(statusError));
    } finally {
      setChecking(false);
      setRefreshing(false);
    }
  }, [preview]);

  useEffect(() => {
    if (selection) setProfileKind(selection.kind);
  }, [selection]);

  useEffect(() => {
    setOpen(false);
    setQuery("");
  }, [workspaceId]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!workspaceId) return null;

  return (
    <div ref={rootRef} className="multilogin-chat-picker-root">
      <MultiloginChatProfilePickerView
        status={status}
        selection={selection}
        open={open}
        checking={checking}
        refreshing={refreshing}
        profileKind={profileKind}
        query={query}
        error={error}
        onToggle={() => {
          setOpen((current) => !current);
          setQuery("");
          if (!open) void loadStatus(true);
        }}
        onClose={() => setOpen(false)}
        onRefresh={() => void loadStatus(true)}
        onProfileKindChange={(kind) => { setProfileKind(kind); setQuery(""); }}
        onQueryChange={setQuery}
        onSelect={(kind, profile) => {
          if (!workspaceId) return;
          onSelectAsAgentDefault();
          setMultiloginSelection(workspaceId, { kind, id: profile.id, name: profile.name, folderId: profile.folderId });
          setOpen(false);
        }}
        onClear={() => {
          clearMultiloginSelection(workspaceId);
          setOpen(false);
        }}
        onManage={() => { setOpen(false); onManage(); }}
        searchRef={searchRef}
      />
    </div>
  );
}
