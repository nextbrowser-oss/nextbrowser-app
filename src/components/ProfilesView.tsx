import { type FormEvent, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import { countryFlag, countryLabel } from "../lib/countryFlag";
import { manualProxyDefaultName, parseManualProxyUrl, type ParsedManualProxyUrl } from "../lib/manualProxy";
import { Icon, Spinner } from "./Icon";

export function ProfilesView() {
  const s = useStore();
  const profiles = s.filteredProfiles();
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultIdentity = s.profileIdentities.__default;
  const showDefaultProfile = defaultKnown && !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = s.profiles.length + (showDefaultProfile ? 1 : 0);
  const [manualProxyOpen, setManualProxyOpen] = useState(false);
  const [manualProxyUrl, setManualProxyUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const createName = (input: ParsedManualProxyUrl) => {
    const base = manualName.trim() || manualProxyDefaultName(input);
    const existing = new Set(s.profiles.map((p) => p.name));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const submitManualProxy = async (event: FormEvent) => {
    event.preventDefault();
    setManualSaving(true);
    setManualError(null);
    try {
      const parsed = parseManualProxyUrl(manualProxyUrl);
      await s.createManualProxyProfile({ ...parsed, name: createName(parsed) });
      setManualProxyUrl("");
      setManualName("");
      setManualProxyOpen(false);
    } catch (error) {
      setManualError(error instanceof Error ? error.message : String(error));
    } finally {
      setManualSaving(false);
    }
  };

  return (
    <div className="page profiles-page">
      <div className="page-head">
        <div>
          <h2>Profiles</h2>
          <p className="muted">Start browser profiles, inspect proxy identity, and open Live view.</p>
        </div>
        <span className="spacer" />
        <button className="secondary" title="Refresh profiles" disabled={s.isRefreshing} onClick={() => s.refreshSessions()}>
          {s.isRefreshing ? <Spinner size={13} /> : <Icon name="arrow.clockwise" size={13} />}
          Refresh
        </button>
        <button className="primary" title="Add manual proxy profile" onClick={() => setManualProxyOpen(true)}>
          <Icon name="network" size={14} />
          Proxy
        </button>
      </div>

      <div className="profiles-toolbar">
        <button
          className="btn-bordered"
          title={s.selectedProfile ? `Start selected profile: ${s.selectedProfile}` : "Start default profile"}
          disabled={s.isRefreshing}
          onClick={() => void (s.selectedProfile ? s.startProfile(s.selectedProfile) : s.startDefaultSession())}
        >
          <Icon name="play.fill" size={14} />
          {s.selectedProfile ? "Start selected profile" : "Start default profile"}
        </button>
        <div className="search-box profiles-search-box">
          <Icon name="magnifyingglass" size={12} className="muted" />
          <input
            className="search-inline"
            placeholder="Search profiles..."
            value={s.profileSearch}
            onChange={(e) => s.setProfileSearch(e.target.value)}
          />
        </div>
        <span className="status-pill">{visibleProfileCount}</span>
      </div>

      <div className="profiles-page-list claw-card">
        {visibleProfileCount === 0 && (
          <div className="inline-empty">
            <Icon name="person.crop.circle" size={20} className="muted" />
            <strong>No profiles yet</strong>
          </div>
        )}
        {visibleProfileCount === 0 && !s.proxy && (
          <button className="btn-bordered empty-action-button" title="Sign in to create managed profiles" onClick={() => s.setDashboardKeyPromptOpen(true)}>
            <Icon name="lock" size={14} />
            Sign in to create profiles
          </button>
        )}
        {showDefaultProfile && (
          <ProfileRow
            name="default"
            status={defaultStatus}
            selected={!s.selectedProfile}
            busy={defaultBusy}
            running={defaultRunning}
            country={defaultIdentity?.country}
            city={defaultIdentity?.city}
            ip={defaultIdentity?.ip}
            onSelect={() => s.selectProfile(undefined)}
            onStart={() => s.startDefaultSession()}
            onStop={() => s.stopDefaultSession()}
            onLive={() => { s.selectProfile(undefined); s.setTab("live"); }}
          />
        )}
        {s.profiles.length > 0 && profiles.length === 0 && (
          <div className="muted small">No matches for “{s.profileSearch}”.</div>
        )}
        {profiles.map((p) => {
          const status = s.statuses[p.name] ?? "unknown";
          const running = status === "running";
          const busy = ["starting", "stopping", "rotating"].includes(status);
          const identity = s.profileIdentities[p.name];
          const country = p.country ?? identity?.country;
          return (
            <ProfileRow
              key={p.name}
              name={p.name}
              status={status}
              selected={s.selectedProfile === p.name}
              busy={busy}
              running={running}
              country={country}
              city={p.city ?? identity?.city}
              ip={identity?.ip}
              manual={p.proxy_mode === "manual"}
              onSelect={() => s.selectProfile(s.selectedProfile === p.name ? undefined : p.name)}
              onStart={() => s.startProfile(p.name)}
              onStop={() => s.stopProfile(p.name)}
              onLive={() => { s.selectProfile(p.name); s.setTab("live"); }}
              onRotate={() => s.rotateProfile(p.name)}
              onDelete={() => setConfirmDelete(p.name)}
            />
          );
        })}
      </div>

      {manualProxyOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => !manualSaving && setManualProxyOpen(false)}>
          <form className="modal-card manual-proxy-modal" onSubmit={submitManualProxy} onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">
              <Icon name="network" size={16} className="accent-icon" />
              <span className="profile-menu-name">Manual proxy</span>
            </div>
            <label className="modal-field">
              <span>Proxy URL</span>
              <input value={manualProxyUrl} onChange={(e) => setManualProxyUrl(e.target.value)} placeholder="http://user:pass@host:8080" autoFocus />
            </label>
            <label className="modal-field">
              <span>Name (optional)</span>
              <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="generated from proxy URL" />
            </label>
            {manualError && <div className="error manual-proxy-error">{manualError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={manualSaving} onClick={() => setManualProxyOpen(false)}>Cancel</button>
              <button type="submit" className="primary" disabled={manualSaving}>{manualSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />} Create</button>
            </div>
          </form>
        </div>
      ), document.body)}

      {confirmDelete && createPortal((
        <div className="modal-overlay">
          <div className="modal-card">
            <p>Delete profile “{confirmDelete}”?</p>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="primary danger" onClick={() => { s.deleteProfile(confirmDelete); setConfirmDelete(null); }}>Delete</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function ProfileRow({
  name,
  status,
  selected,
  busy,
  running,
  country,
  city,
  ip,
  manual,
  onSelect,
  onStart,
  onStop,
  onLive,
  onRotate,
  onDelete,
}: {
  name: string;
  status: string;
  selected: boolean;
  busy: boolean;
  running: boolean;
  country?: string | null;
  city?: string | null;
  ip?: string | null;
  manual?: boolean;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onLive: () => void;
  onRotate?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className={"profile-row profiles-page-row" + (selected ? " selected" : "")} onClick={onSelect}>
      <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
      <span className="profile-main">
        <span className="profile-title-line">
          <span className="profile-name">{name}</span>
          {country && <span className="badge profile-country-badge" title={countryLabel(country, city)}>{countryFlag(country)} {country.toUpperCase()}</span>}
          {manual && <span className="badge manual-proxy-badge">MANUAL</span>}
        </span>
        <span className="profile-meta">{ip ? `${status} · ${ip}` : country ? countryLabel(country, city) : status}</span>
      </span>
      <span className="spacer" />
      <div className="profile-actions">
        {running ? (
          <>
            <button className="plain-icon-btn" title={`Stop ${name}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void onStop(); }}><Icon name="stop.fill" size={16} /></button>
            <button className="plain-icon-btn" title="Live view" onClick={(e) => { e.stopPropagation(); onLive(); }}><Icon name="video.fill" size={16} /></button>
          </>
        ) : (
          <button className="plain-icon-btn" title={`Start ${name}`} disabled={busy} onClick={(e) => { e.stopPropagation(); void onStart(); }}><Icon name="play.fill" size={16} /></button>
        )}
        {onRotate && <button className="plain-icon-btn" title="Rotate IP" disabled={busy} onClick={(e) => { e.stopPropagation(); void onRotate(); }}><Icon name="arrow.triangle.2.circlepath" size={16} /></button>}
        {onDelete && <button className="plain-icon-btn" title="Delete profile" disabled={busy} onClick={(e) => { e.stopPropagation(); onDelete(); }}><Icon name="trash" size={15} /></button>}
      </div>
    </div>
  );
}
