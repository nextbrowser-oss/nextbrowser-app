import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore, type ManualProxyProfileInput } from "../store";
import { agentById } from "../agents";
import { BrandHeader, BrandLogo } from "./BrandLogo";
import { Icon, Spinner } from "./Icon";
import { withLocalScripts } from "../skillsCatalog";
import { countryFlag, countryLabel, ROTATION_COUNTRIES } from "../lib/countryFlag";
import { guideProfileTarget } from "../lib/guideQuickStart";
import { manualProxyDefaultName, parseManualProxyUrl, type ManualProxyScheme } from "../lib/manualProxy";
import { internalError, needsSupportLink } from "../lib/userFacingError";
import { cancelNextctlRun } from "../nextctl";
import { conversationPreview, type AppTab } from "../types";
import { CountrySelect } from "./CountrySelect";
import { UserFacingError } from "./UserFacingError";
import { VPSSetupModal } from "./VPSSetupModal";

type ManualProxyInputMode = "url" | "fields";
const PROFILE_CREATE_TIMEOUT_MS = 30_000;

interface SidebarProps {
  onOpenAgentSettings: () => void;
  onHome: () => void;
}

const NAV_ITEMS: Array<{ id: AppTab; label: string; icon: string }> = [
  { id: "skills", label: "Skills", icon: "square.grid.2x2.fill" },
  { id: "scheduled", label: "Scheduled", icon: "clock.arrow.circlepath" },
  { id: "guide", label: "Guide", icon: "book.fill" },
];

export function Sidebar({ onOpenAgentSettings, onHome }: SidebarProps) {
  const s = useStore();
  const [menuProfile, setMenuProfile] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [manualProxyOpen, setManualProxyOpen] = useState(false);
  const [manualProxyMode, setManualProxyMode] = useState<ManualProxyInputMode>("url");
  const [manualProxyUrl, setManualProxyUrl] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualScheme, setManualScheme] = useState<ManualProxyScheme>("http");
  const [manualHost, setManualHost] = useState("");
  const [manualPort, setManualPort] = useState("8080");
  const [manualUsername, setManualUsername] = useState("");
  const [manualPassword, setManualPassword] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSaving, setManualSaving] = useState(false);
  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [vpsSetupOpen, setVPSSetupOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileCountry, setProfileCountry] = useState("US");
  const [profileToolset, setProfileToolset] = useState<"clawbrowser" | "dasbrowser">("clawbrowser");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileActionError, setProfileActionError] = useState<string | null>(null);
  const [dragOverProject, setDragOverProject] = useState<string | null>(null);
  const [dragOverProfile, setDragOverProfile] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("collapsedProjects") ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  const [profileGuideFocus, setProfileGuideFocus] = useState(false);
  const [logoutPending, setLogoutPending] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const profileCreateRequestRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const runProfileAction = (label: string, action: () => Promise<void>) => {
    setProfileActionError(null);
    void action().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message.trim() : String(error ?? "").trim();
      setProfileActionError(detail ? `${label} ${detail}` : label);
    });
  };

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      localStorage.setItem("collapsedProjects", JSON.stringify([...next]));
      return next;
    });
  };

  const agentName = agentById(s.agentId).name;
  const ready = s.agentReady();
  const searchQuery = s.profileSearch.trim();
  const normalizedSearch = searchQuery.toLowerCase();
  const profiles = s.profiles;
  const projects = s.conversationsForAgent(s.agentId);
  const activeProject = s.activeConversation();
  const assignedProfileNames = new Set(projects.flatMap((project) => project.profileNames ?? []));
  const projectGroups = projects.flatMap((project) => {
    const profileByName = new Map(profiles.map((profile) => [profile.name, profile]));
    const owned = (project.profileNames ?? []).flatMap((name) => {
      const profile = profileByName.get(name);
      return profile ? [profile] : [];
    });
    const unassigned = project.id === activeProject?.id
      ? profiles.filter((profile) => !assignedProfileNames.has(profile.name))
      : [];
    const groupProfiles = [...owned, ...unassigned];
    if (!normalizedSearch) return [{ project, profiles: groupProfiles }];
    const projectMatches = project.title.toLowerCase().includes(normalizedSearch);
    const matchingProfiles = groupProfiles.filter((profile) => profile.name.toLowerCase().includes(normalizedSearch));
    if (!projectMatches && matchingProfiles.length === 0) return [];
    return [{ project, profiles: projectMatches ? groupProfiles : matchingProfiles }];
  });
  useEffect(() => {
    const handleProjectShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      const index = Number.parseInt(event.key, 10) - 1;
      if (index < 0 || index >= Math.min(projects.length, 9)) return;
      event.preventDefault();
      s.selectConversation(projects[index].id);
      s.setTab("chat");
    };
    window.addEventListener("keydown", handleProjectShortcut);
    return () => window.removeEventListener("keydown", handleProjectShortcut);
  }, [projects, s]);
  const skillCount = withLocalScripts(s.skillCategories).reduce((total, category) => total + category.entries.length, 0);
  const defaultStatus = s.defaultSession?.status ?? "unknown";
  const defaultKnown = !!s.defaultSession?.session?.name || defaultStatus !== "unknown";
  const defaultRunning = defaultStatus === "running";
  const defaultBusy = s.nextctlUpdating || ["starting", "stopping", "rotating"].includes(defaultStatus);
  const defaultSessionDuplicate = defaultRunning && Object.values(s.profileSessions).some((session) =>
    session.status === "running" && (
      (!!session.pid && session.pid === s.defaultSession?.pid) ||
      (!!session.session?.endpoint && session.session.endpoint === s.defaultSession?.session?.endpoint)
    ),
  );
  const showDefaultProfile = defaultKnown &&
    !defaultSessionDuplicate &&
    !s.profiles.some((p) => p.name === "default");
  const visibleProfileCount = s.profiles.length;
  const runningCount = s.profiles.filter((p) => s.statuses[p.name] === "running").length;
  const proxyCountries = s.proxyCountries.length ? s.proxyCountries : ROTATION_COUNTRIES;

  useEffect(() => {
    if (menuProfile) void s.loadProxyCountries().catch(() => {});
  }, [menuProfile]);

  useEffect(() => {
    let focusTimer = 0;
    const focusProfiles = () => {
      setProfileGuideFocus(true);
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(() => setProfileGuideFocus(false), 1_400);
    };
    const openCreator = () => {
      focusProfiles();
      if (!s.authed) {
        s.setDashboardKeyPromptOpen(true);
        return;
      }
      setProfileName("");
      setProfileCountry("US");
      setProfileError(null);
      setCreateProfileOpen(true);
      void s.loadProxyCountries().catch(() => {});
    };
    const openActions = () => {
      focusProfiles();
      const profile = s.selectedProfile ?? s.profiles[0]?.name ?? (showDefaultProfile ? "__default" : null);
      if (profile) setMenuProfile(profile);
    };
    const startSelectedProfile = () => {
      focusProfiles();
      s.setProfileSearch("");
      const profile = guideProfileTarget(
        s.selectedProfile,
        s.profiles.map((item) => item.name),
        showDefaultProfile,
      );
      if (!profile) return;
      if (profile === "__default") {
        s.selectProfile(undefined);
        if (!defaultRunning && !defaultBusy) {
          runProfileAction("We couldn't start the default profile.", s.startDefaultSession);
        }
        return;
      }
      s.selectProfile(profile);
      const status = s.statuses[profile] ?? s.profileSessions[profile]?.status ?? "unknown";
      if (status !== "running" && !["starting", "stopping", "rotating"].includes(status)) {
        runProfileAction(`We couldn't start “${profile}”.`, () => s.startProfile(profile));
      }
    };
    window.addEventListener("nextbrowser:focus-profiles", focusProfiles);
    window.addEventListener("nextbrowser:open-profile-creator", openCreator);
    window.addEventListener("nextbrowser:open-profile-actions", openActions);
    window.addEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("nextbrowser:focus-profiles", focusProfiles);
      window.removeEventListener("nextbrowser:open-profile-creator", openCreator);
      window.removeEventListener("nextbrowser:open-profile-actions", openActions);
      window.removeEventListener("nextbrowser:start-selected-profile", startSelectedProfile);
    };
  }, [
    defaultBusy,
    defaultRunning,
    s.authed,
    s.profileSessions,
    s.profiles,
    s.selectedProfile,
    s.setDashboardKeyPromptOpen,
    s.setProfileSearch,
    s.startDefaultSession,
    s.startProfile,
    s.statuses,
    showDefaultProfile,
  ]);

  const badgeFor = (id: AppTab) => {
    if (id === "skills") return skillCount ? String(skillCount) : undefined;
    if (id === "scheduled") return s.scheduledRuns.length ? String(s.scheduledRuns.length) : undefined;
    return undefined;
  };

  const uniqueManualProxyName = (baseName: string) => {
    const base = baseName.trim() || "manual-proxy";
    const existing = new Set(s.profiles.map((p) => p.name));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
      const candidate = `${base}-${index}`;
      if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
  };

  const resetManualProxyForm = () => {
    setManualProxyMode("url");
    setManualProxyUrl("");
    setManualName("");
    setManualScheme("http");
    setManualHost("");
    setManualPort("8080");
    setManualUsername("");
    setManualPassword("");
    setManualError(null);
  };

  const logout = async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    setLogoutError(null);
    try {
      await s.logout();
    } catch {
      setLogoutError(internalError("We couldn't sign you out. Please try again."));
    } finally {
      setLogoutPending(false);
    }
  };

  const closeProfileCreator = () => {
    const requestId = profileCreateRequestRef.current;
    profileCreateRequestRef.current = null;
    if (requestId) void cancelNextctlRun(requestId);
    setProfileSaving(false);
    setCreateProfileOpen(false);
    s.resumeOnboardingAfterSetup();
  };

  const submitManualProxy = async (event: FormEvent) => {
    event.preventDefault();
    const name = manualName.trim();
    let input: ManualProxyProfileInput;
    if (manualProxyMode === "url") {
      let parsed;
      try {
        parsed = parseManualProxyUrl(manualProxyUrl);
      } catch (error) {
        setManualError(error instanceof Error ? error.message : String(error));
        return;
      }
      input = {
        name: name || uniqueManualProxyName(manualProxyDefaultName(parsed)),
        ...parsed,
      };
    } else {
      const port = Number.parseInt(manualPort, 10);
      if (!name || !manualHost.trim() || !Number.isInteger(port) || port < 1 || port > 65535) {
        setManualError("Name, host, and a valid port are required.");
        return;
      }
      input = {
        name,
        scheme: manualScheme,
        host: manualHost,
        port,
        username: manualUsername,
        password: manualPassword,
      };
    }
    setManualSaving(true);
    setManualError(null);
    try {
      await s.createManualProxyProfile(input);
      s.assignProfileToProject(input.name, "clawbrowser");
      resetManualProxyForm();
      setManualProxyOpen(false);
    } catch {
      setManualError(internalError("We couldn't create the proxy profile."));
    } finally {
      setManualSaving(false);
    }
  };

  const submitManagedProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profileName.trim()) {
      setProfileError("Profile name is required.");
      return;
    }
    if (profileSaving) return;
    const requestId = `profile-create-${crypto.randomUUID()}`;
    profileCreateRequestRef.current = requestId;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const createdName = profileName.trim();
      await s.createManagedProfile(createdName, profileCountry, {
        requestId,
        timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
        runtime: profileToolset,
      });
      if (profileCreateRequestRef.current !== requestId) return;
      s.assignProfileToProject(createdName, profileToolset);
      setCreateProfileOpen(false);
      setProfileName("");
      setProfileCountry("US");
      setProfileToolset("clawbrowser");
      s.resumeOnboardingAfterSetup();
    } catch (error) {
      if (profileCreateRequestRef.current !== requestId) return;
      const message = error instanceof Error ? error.message : String(error);
      setProfileError(
        /timed out/i.test(message)
          ? "Profile creation took too long and was stopped. Check your connection, then try again."
          : message,
      );
    } finally {
      if (profileCreateRequestRef.current === requestId) {
        profileCreateRequestRef.current = null;
        setProfileSaving(false);
      }
    }
  };

  if (s.sidebarCollapsed) {
    return (
      <div className="sidebar-mini">
        <button
          className="plain-icon-btn sidebar-collapse-toggle"
          data-tooltip="Expand sidebar"
          aria-label="Expand sidebar"
          onClick={() => s.setSidebarCollapsed(false)}
        >
          <Icon name="sidebar.left" size={17} />
        </button>
        <button className="sidebar-logo-home" onClick={onHome} data-tooltip="Back to main view" aria-label="Back to main view"><BrandLogo size={28} /></button>
        <button className="mini-nav-btn" data-tooltip={`${visibleProfileCount} profiles, ${runningCount} running`} aria-label={`${visibleProfileCount} profiles, ${runningCount} running`} onClick={() => s.setTab("live")}>
          <Icon name="person.crop.circle" size={18} />
          <span>{runningCount}/{visibleProfileCount}</span>
        </button>
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={"mini-nav-btn" + (s.tab === item.id ? " active" : "")}
            data-tooltip={item.label}
            aria-label={`Open ${item.label}`}
            aria-current={s.tab === item.id ? "page" : undefined}
            onClick={() => s.setTab(item.id)}
          >
            <Icon name={item.icon} size={18} />
            {badgeFor(item.id) && <span>{badgeFor(item.id)}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button className="mini-nav-btn" data-tooltip={`Agent: ${agentName}`} aria-label={`Agent: ${agentName}`} onClick={onOpenAgentSettings}>
          <Icon name="cpu.fill" size={18} />
          <span>{ready ? "on" : "off"}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar-shell">
      <div className="sidebar-brand">
        <div className="row">
          <button className="sidebar-brand-home" onClick={onHome} title="Back to main view"><BrandHeader subtitle="native agent console" /></button>
          <span className="spacer" />
          <button
            className="plain-icon-btn plain-icon-btn-compact sidebar-collapse-toggle"
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            onClick={() => s.setSidebarCollapsed(true)}
          >
            <Icon name="sidebar.leading" size={15} />
          </button>
        </div>
      </div>

      <nav className="sidebar-scroll sidebar-nav-list" aria-label="Sidebar pages">
        {NAV_ITEMS.map((item) => {
          const badge = badgeFor(item.id);
          return (
            <button
              key={item.id}
              className={"claw-card sidebar-link-card sidebar-page-link" + (s.tab === item.id ? " active" : "")}
              title={`Open ${item.label}`}
              aria-current={s.tab === item.id ? "page" : undefined}
              onClick={() => s.setTab(item.id)}
            >
              <Icon name={item.icon} size={14} />
              <span className="section">{item.label}</span>
              <span className="spacer" />
              {badge && <span className="profiles-count">{badge}</span>}
            </button>
          );
        })}

        <div className={"claw-card control-card profiles-card" + (profileGuideFocus ? " guide-focus" : "")}>
          <div className="row profiles-panel-head">
            <div className="scheduled-panel-toggle profiles-panel-toggle">
              <span className="section">Projects</span>
              <span className="profiles-count" title="Total projects">{projects.length}</span>
            </div>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="New project chat"
              aria-label="New project chat"
              onClick={() => {
                s.setTab("chat");
                window.setTimeout(() => window.dispatchEvent(new CustomEvent("nextbrowser:create-project")), 0);
              }}
            >
              <Icon name="plus" size={13} />
            </button>
            <button
              className="plain-icon-btn plain-icon-btn-compact"
              title="Refresh profiles"
              disabled={s.isRefreshing}
              onClick={() => s.refreshSessions()}
            >
              {s.isRefreshing ? <Spinner size={12} /> : <Icon name="arrow.clockwise" size={12} />}
            </button>
            <span className="spacer" />
          </div>

          <div className="session-quick-actions">
            <button
              className="btn-bordered full"
              title={s.authed ? "Create managed profile" : "Sign in to create a managed profile"}
              disabled={s.isRefreshing || !activeProject}
              onClick={() => {
                if (!s.authed) {
                  s.setDashboardKeyPromptOpen(true);
                  return;
                }
                setProfileName("");
                setProfileCountry("US");
                setProfileError(null);
                setCreateProfileOpen(true);
              }}
            >
              <Icon name={s.authed ? "plus" : "lock"} size={14} />
              {s.authed ? activeProject ? "Create profile" : "Create a project first" : "Sign in"}
            </button>
            <button
              className="mini proxy-profile-btn"
              title="Create a profile with a manual proxy"
              onClick={() => {
                resetManualProxyForm();
                setManualProxyOpen(true);
              }}
            >
              Proxy
            </button>
          </div>

          <div className="search-box">
            <Icon name="magnifyingglass" size={12} className="muted" />
            <input
              ref={searchInputRef}
              className="search-inline"
              placeholder="Search"
              value={s.profileSearch}
              onChange={(e) => s.setProfileSearch(e.target.value)}
            />
            {s.profileSearch && (
              <button
                className="plain-icon-btn plain-icon-btn-compact"
                title="Clear search"
                onClick={() => s.setProfileSearch("")}
              >
                <Icon name="xmark.circle.fill" size={14} className="muted" />
              </button>
            )}
          </div>

          <div className="profile-list">
            {visibleProfileCount === 0 && (
              <div className="inline-empty">
                <Icon name="person.crop.circle" size={18} className="muted" />
                <div>
                  <strong>No profiles yet</strong>
                </div>
              </div>
            )}
            {(projects.length > 0 || s.profiles.length > 0) && projectGroups.length === 0 && (
              <div className="muted small">No matches for "{s.profileSearch}".</div>
            )}
            {projectGroups.map(({ project, profiles: projectProfiles }) => (
              <section
                className={"project-profile-group" + (project.id === activeProject?.id ? " is-active" : "") + (dragOverProject === project.id ? " is-drag-over" : "")}
                key={project.id}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes("application/x-nextbrowser-profile")) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDragOverProject(project.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverProject(null);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const profileName = event.dataTransfer.getData("application/x-nextbrowser-profile");
                  const toolset = (event.dataTransfer.getData("application/x-nextbrowser-toolset") || "clawbrowser") as "clawbrowser" | "dasbrowser";
                  setDragOverProject(null);
                  if (profileName) s.assignProfileToProject(profileName, toolset, project.id);
                }}
              >
                <div className="project-profile-heading">
                  {projectProfiles.length > 0 ? (
                    <button
                      className="project-expand-toggle"
                      onClick={() => toggleProject(project.id)}
                      aria-label={collapsedProjects.has(project.id) ? `Show profiles in ${project.title}` : `Hide profiles in ${project.title}`}
                      aria-expanded={!collapsedProjects.has(project.id)}
                    >
                      <Icon name={collapsedProjects.has(project.id) ? "chevron.right" : "chevron.down"} size={11} />
                    </button>
                  ) : (
                    <span className="project-expand-placeholder" aria-hidden="true" />
                  )}
                  <button
                    className="project-chat-link"
                    onClick={() => {
                      s.selectConversation(project.id);
                      s.setTab("chat");
                    }}
                    aria-current={project.id === activeProject?.id ? "page" : undefined}
                    title={`Open ${project.title} chat`}
                  >
                    <Icon name={project.chatMode === "terminal" ? "terminal" : "bubble.left.and.bubble.right.fill"} size={13} />
                    <span className="project-chat-copy">
                      <span className="project-chat-title"><HighlightedName text={project.title} query={searchQuery} /></span>
                      <span className="project-chat-preview">{conversationPreview(project)}</span>
                    </span>
                    {project.id === activeProject?.id && <span className="project-active-label">Active chat</span>}
                    <span className="muted small project-profile-count">{projectProfiles.length}</span>
                  </button>
                </div>
                {(!collapsedProjects.has(project.id) || !!normalizedSearch) && projectProfiles.map((p) => {
                  const status = s.statuses[p.name] ?? "unknown";
                  const running = status === "running";
                  const busy = s.nextctlUpdating || ["starting", "stopping", "rotating"].includes(status);
                  const selected = s.selectedProfile === p.name;
                  const manual = p.proxy_mode === "manual" && p.manual_proxy;
                  const identity = s.profileIdentities[p.name];
                  return (
                    <ProfileRow
                      key={p.name} name={p.name} status={status} running={running} busy={busy} selected={selected}
                      country={p.country ?? identity?.country} city={p.city ?? identity?.city} ip={identity?.ip}
                      toolset={project.profileToolsets?.[p.name] ?? "clawbrowser"}
                      searchQuery={searchQuery}
                      draggable
                      dragOver={dragOverProfile === `${project.id}:${p.name}`}
                      onDragOverProfile={(event) => {
                        if (!event.dataTransfer.types.includes("application/x-nextbrowser-profile")) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = "move";
                        setDragOverProfile(`${project.id}:${p.name}`);
                      }}
                      onDropProfile={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        const movedName = event.dataTransfer.getData("application/x-nextbrowser-profile");
                        const sourceProject = event.dataTransfer.getData("application/x-nextbrowser-project");
                        const toolset = (event.dataTransfer.getData("application/x-nextbrowser-toolset") || "clawbrowser") as "clawbrowser" | "dasbrowser";
                        setDragOverProfile(null);
                        setDragOverProject(null);
                        if (!movedName) return;
                        if (sourceProject !== project.id) s.assignProfileToProject(movedName, toolset, project.id);
                        s.reorderProfileInProject(project.id, movedName, p.name);
                      }}
                      onDragLeaveProfile={() => setDragOverProfile(null)}
                      projectId={project.id}
                      manualScheme={manual ? p.manual_proxy?.scheme : undefined}
                      manualTitle={manual ? `${p.manual_proxy?.host ?? ""}:${p.manual_proxy?.port ?? ""}` : undefined}
                      onSelect={() => { s.selectConversation(project.id); s.selectProfile(selected ? undefined : p.name); }}
                      onStart={() => {
                        s.selectConversation(project.id);
                        s.selectProfile(p.name);
                        s.setTab("chat");
                        runProfileAction(`We couldn't start “${p.name}”.`, () => s.startProfile(p.name));
                      }}
                      onStop={() => runProfileAction(`We couldn't stop “${p.name}”.`, () => s.stopProfile(p.name))}
                      onLive={() => { s.selectConversation(project.id); s.selectProfile(p.name); s.setTab("live"); }}
                      onMenu={() => setMenuProfile(p.name)}
                    />
                  );
                })}
              </section>
            ))}
            {profileActionError && (
              <div className="error small profile-action-error" role="alert">{profileActionError}</div>
            )}
          </div>
        </div>
      </nav>

      <hr className="divider" />
      <div className={"sidebar-account-footer" + (s.authed ? " is-connected" : "")}>
        <Icon name={s.authed ? "person.crop.circle" : "lock"} size={14} />
        <span title={s.authed ? s.accountEmail || "Browser account connected" : "Browser account not connected"}>
          {s.authed ? s.accountEmail || "Browser account connected" : "Browser account not connected"}
        </span>
        {s.authed ? (
          <button
            className="plain-icon-btn plain-icon-btn-compact"
            title="Sign out of NextBrowser"
            aria-label="Sign out of NextBrowser"
            disabled={logoutPending}
            onClick={() => void logout()}
          >
            {logoutPending
              ? <Spinner size={13} />
              : <Icon name="rectangle.portrait.and.arrow.right" size={13} />}
          </button>
        ) : (
          <button
            className="sidebar-account-action"
            type="button"
            onClick={() => s.setDashboardKeyPromptOpen(true)}
          >
            Sign in
          </button>
        )}
      </div>
      {logoutError && <div className="sidebar-account-error" role="alert">{logoutError}</div>}
      <div className="nextctl-footer muted small">
        <Icon name="terminal" size={12} />
        <span>nextctl {s.nextctlVersion || "..."}</span>
        <button
          className="plain-icon-btn plain-icon-btn-compact nextctl-refresh"
          title="Check for a newer nextctl and update"
          disabled={s.nextctlUpdating}
          onClick={() => s.checkNextctlUpdate()}
        >
          {s.nextctlUpdating ? <Spinner size={12} /> : <Icon name="arrow.triangle.2.circlepath" size={12} />}
        </button>
        {s.nextctlUpdateStatus && (
          <span className={needsSupportLink(s.nextctlUpdateStatus) ? "warn" : ""}>
            · <UserFacingError message={s.nextctlUpdateStatus} surface="component_update" />
          </span>
        )}
        {!s.nextctlSupportsSkill && <span className="warn"> · no skill cmd</span>}
        <span className="spacer" />
        <button
          className={"agent-footer-status" + (ready ? " is-ready" : "")}
          title="Agent settings"
          aria-label="Open agent settings"
          onClick={onOpenAgentSettings}
        >
          <span className="status-dot" />
          <span>{ready ? agentName : "No agent"}</span>
          <Icon name="chevron.down" size={11} />
        </button>
      </div>

      {createProfileOpen && createPortal((
        <div
          className="modal-overlay"
          onMouseDown={closeProfileCreator}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            closeProfileCreator();
          }}
        >
          <form
            className="modal-card create-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-profile-title"
            onSubmit={submitManagedProfile}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="profile-menu-head">
              <span id="create-profile-title" className="profile-menu-name">Create profile</span>
              <span className="spacer" />
              <button
                type="button"
                className="plain-icon-btn"
                title={profileSaving ? "Cancel profile creation" : "Close"}
                aria-label={profileSaving ? "Cancel profile creation" : "Close profile creation"}
                onClick={closeProfileCreator}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>
            <label className="modal-field">
              <span>Profile name</span>
              <input
                value={profileName}
                disabled={profileSaving}
                onChange={(event) => {
                  setProfileName(event.target.value);
                  setProfileError(null);
                }}
                placeholder="My profile"
                autoFocus
              />
            </label>
            <div className="modal-field">
              <span>Proxy country</span>
              <CountrySelect
                countries={proxyCountries}
                value={profileCountry}
                disabled={profileSaving}
                ariaLabel="Proxy country"
                onChange={setProfileCountry}
              />
            </div>
            <fieldset className="project-mode-field profile-toolset-field">
              <legend>Browser toolset</legend>
              <label className={"project-mode-option" + (profileToolset === "clawbrowser" ? " is-selected" : "")}>
                <input type="radio" name="profile-toolset" checked={profileToolset === "clawbrowser"} onChange={() => setProfileToolset("clawbrowser")} />
                <Icon name="globe" size={16} />
                <span><strong>ClawBrowser</strong><small>Managed identity and proxy</small></span>
              </label>
              <label className={"project-mode-option" + (profileToolset === "dasbrowser" ? " is-selected" : "")}>
                <input type="radio" name="profile-toolset" checked={profileToolset === "dasbrowser"} onChange={() => setProfileToolset("dasbrowser")} />
                <Icon name="safari" size={16} />
                <span><strong>DasBrowser</strong><small>Private multi-account browser</small></span>
              </label>
            </fieldset>
            <button
              type="button"
              className="profile-vps-option"
              onClick={() => {
                setCreateProfileOpen(false);
                setVPSSetupOpen(true);
              }}
            >
              <Icon name="terminal" size={15} />
              <span>
                <strong>Use VPS</strong>
                <small>Set up this project on a remote server instead</small>
              </span>
              <Icon name="chevron.right" size={12} className="muted" />
            </button>
            {profileError && <div className="error small profile-create-error">{profileError}</div>}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={closeProfileCreator}>
                {profileSaving ? "Cancel creation" : "Cancel"}
              </button>
              <button type="submit" className="primary" disabled={profileSaving || !profileName.trim()}>
                {profileSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                {profileSaving ? "Creating…" : "Create profile"}
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {menuProfile && createPortal((() => {
        const isDefaultProfile = menuProfile === "__default";
        const prof = s.profiles.find((p) => p.name === menuProfile);
        const identity = isDefaultProfile ? s.profileIdentities.__default : s.profileIdentities[menuProfile];
        const activeCountry = (isDefaultProfile ? identity?.country : prof?.country ?? identity?.country)?.toLowerCase();
        const status = isDefaultProfile ? defaultStatus : s.statuses[menuProfile] ?? "unknown";
        const manual = prof?.proxy_mode === "manual" && prof.manual_proxy;
        return (
          <div className="modal-overlay" onClick={() => setMenuProfile(null)}>
            <div className="modal-card profile-menu" onClick={(e) => e.stopPropagation()}>
              <div className="profile-menu-head">
                <span
                  className={"dot " + (status === "running" ? "green" : status === "unknown" ? "gray" : "orange")}
                  title={status}
                />
                <span className="profile-menu-name">{isDefaultProfile ? "default" : menuProfile}</span>
                {activeCountry && (
                  <span className="badge profile-country-badge" title={countryLabel(activeCountry, identity?.city ?? prof?.city)}>
                    {countryFlag(activeCountry)} {activeCountry.toUpperCase()}
                  </span>
                )}
                {identity?.ip && <span className="badge profile-ip-badge" title="Current proxy IP">{identity.ip}</span>}
                {manual && (
                  <span
                    className="badge manual-proxy-badge"
                    title={`${prof.manual_proxy?.host ?? ""}:${prof.manual_proxy?.port ?? ""}`}
                  >
                    {(prof.manual_proxy?.scheme ?? "http").toUpperCase()}
                  </span>
                )}
                <span className="spacer" />
                <button className="plain-icon-btn" title="Close" onClick={() => setMenuProfile(null)}>
                  <Icon name="xmark.circle.fill" size={18} />
                </button>
              </div>

              <button
                className="full rotate-btn"
                onClick={() => {
                  if (isDefaultProfile) s.rotateDefaultSession();
                  else s.rotateProfile(menuProfile);
                  setMenuProfile(null);
                }}
              >
                <Icon name="arrow.triangle.2.circlepath" size={14} strokeWidth={2.25} />
                {manual ? "Restart profile" : "Rotate IP"}
              </button>

              {!manual && (
                <>
                  <div className="section profile-menu-label">Rotate country</div>
                  <CountrySelect
                    countries={proxyCountries}
                    value={activeCountry ?? ""}
                    ariaLabel="Rotate country"
                    onChange={(country) => {
                      if (isDefaultProfile) void s.rotateDefaultSessionCountry(country);
                      else void s.rotateProfileCountry(menuProfile, country);
                      setMenuProfile(null);
                    }}
                  />
                </>
              )}

              {!isDefaultProfile && (
                <>
                  <div className="profile-menu-divider" />
                  <button
                    className="profile-delete-btn"
                    onClick={() => {
                      setConfirmDelete(menuProfile);
                      setMenuProfile(null);
                    }}
                  >
                    <Icon name="trash" size={14} />
                    Delete profile
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })(), document.body)}

      {vpsSetupOpen && <VPSSetupModal onClose={() => setVPSSetupOpen(false)} />}

      {manualProxyOpen && createPortal((
        <div className="modal-overlay" onMouseDown={() => !manualSaving && setManualProxyOpen(false)}>
          <form className="modal-card manual-proxy-modal" onSubmit={submitManualProxy} onMouseDown={(e) => e.stopPropagation()}>
            <div className="profile-menu-head">
              <Icon name="network" size={16} className="accent-icon" />
              <span className="profile-menu-name">Manual proxy</span>
              <span className="spacer" />
              <button
                type="button"
                className="plain-icon-btn"
                title="Close"
                disabled={manualSaving}
                onClick={() => setManualProxyOpen(false)}
              >
                <Icon name="xmark.circle.fill" size={18} />
              </button>
            </div>

            <div className="manual-proxy-mode" role="tablist" aria-label="Manual proxy input mode">
              <button
                type="button"
                className={manualProxyMode === "url" ? "active" : ""}
                aria-selected={manualProxyMode === "url"}
                onClick={() => {
                  setManualProxyMode("url");
                  setManualError(null);
                }}
              >
                <Icon name="network" size={13} />
                URL
              </button>
              <button
                type="button"
                className={manualProxyMode === "fields" ? "active" : ""}
                aria-selected={manualProxyMode === "fields"}
                onClick={() => {
                  setManualProxyMode("fields");
                  setManualError(null);
                }}
              >
                <Icon name="wrench" size={13} />
                Fields
              </button>
            </div>

            {manualProxyMode === "url" ? (
              <>
                <label className="modal-field">
                  <span>Proxy URL</span>
                  <input
                    value={manualProxyUrl}
                    onChange={(e) => setManualProxyUrl(e.target.value)}
                    placeholder="http://user:pass@host:8080"
                    autoFocus
                  />
                </label>
                <label className="modal-field">
                  <span>Name (optional)</span>
                  <input
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    placeholder="generated from proxy URL"
                  />
                </label>
              </>
            ) : (
              <>
                <label className="modal-field">
                  <span>Name</span>
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} autoFocus />
                </label>
                <div className="manual-proxy-grid">
                  <label className="modal-field">
                    <span>Scheme</span>
                    <select value={manualScheme} onChange={(e) => setManualScheme(e.target.value as ManualProxyScheme)}>
                      <option value="http">HTTP</option>
                      <option value="socks5">SOCKS5</option>
                    </select>
                  </label>
                  <label className="modal-field">
                    <span>Port</span>
                    <input value={manualPort} inputMode="numeric" onChange={(e) => setManualPort(e.target.value)} />
                  </label>
                </div>
                <label className="modal-field">
                  <span>Host</span>
                  <input value={manualHost} onChange={(e) => setManualHost(e.target.value)} />
                </label>
                <label className="modal-field">
                  <span>Username</span>
                  <input value={manualUsername} onChange={(e) => setManualUsername(e.target.value)} />
                </label>
                <label className="modal-field">
                  <span>Password</span>
                  <input type="password" value={manualPassword} onChange={(e) => setManualPassword(e.target.value)} />
                </label>
              </>
            )}
            {manualError && (
              <div className="error manual-proxy-error">
                <UserFacingError message={manualError} surface="manual_proxy" />
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={manualSaving} onClick={() => setManualProxyOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={manualSaving}>
                {manualSaving ? <Spinner size={13} /> : <Icon name="plus" size={13} />}
                Create
              </button>
            </div>
          </form>
        </div>
      ), document.body)}

      {confirmDelete && createPortal((
        <div className="modal-overlay">
          <div className="modal-card">
            <p>Delete profile "{confirmDelete}"?</p>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button className="secondary" onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button
                className="primary danger"
                onClick={() => {
                  s.deleteProfile(confirmDelete);
                  setConfirmDelete(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  );
}

function HighlightedName({ text, query }: { text: string; query?: string }) {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return <>{text}</>;
  const index = text.toLowerCase().indexOf(normalizedQuery);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="search-match">{text.slice(index, index + normalizedQuery.length)}</mark>
      {text.slice(index + normalizedQuery.length)}
    </>
  );
}

function ProfileRow({
  name,
  status,
  running,
  busy,
  selected,
  country,
  city,
  ip,
  manualScheme,
  manualTitle,
  toolset,
  searchQuery,
  draggable,
  dragOver,
  projectId,
  onDragOverProfile,
  onDropProfile,
  onDragLeaveProfile,
  onSelect,
  onStart,
  onStop,
  onLive,
  onMenu,
}: {
  name: string;
  status: string;
  running: boolean;
  busy: boolean;
  selected: boolean;
  country?: string | null;
  city?: string | null;
  ip?: string | null;
  manualScheme?: string | null;
  manualTitle?: string;
  toolset?: "clawbrowser" | "dasbrowser";
  searchQuery?: string;
  draggable?: boolean;
  dragOver?: boolean;
  projectId?: string;
  onDragOverProfile?: (event: DragEvent<HTMLDivElement>) => void;
  onDropProfile?: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeaveProfile?: () => void;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  onLive: () => void;
  onMenu: () => void;
}) {
  return (
    <div
      className={"profile-row" + (selected ? " selected" : "") + (draggable ? " is-draggable" : "") + (dragOver ? " is-drag-over" : "")}
      onClick={onSelect}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-nextbrowser-profile", name);
        event.dataTransfer.setData("application/x-nextbrowser-toolset", toolset ?? "clawbrowser");
        event.dataTransfer.setData("application/x-nextbrowser-project", projectId ?? "");
      }}
      onDragOver={onDragOverProfile}
      onDragLeave={onDragLeaveProfile}
      onDrop={onDropProfile}
    >
      <span className={"dot " + (running ? "green" : busy ? "orange" : "gray")} title={status} />
      <span className="profile-main">
        <span className="profile-title-line">
          <span className="profile-name"><HighlightedName text={name} query={searchQuery} /></span>
          {country && (
            <span className="badge profile-country-badge" title={countryLabel(country, city)}>
              {countryFlag(country)} {country.toUpperCase()}
            </span>
          )}
        </span>
        <span className="profile-meta">
          {ip ? `${status} · ${ip}` : status}
        </span>
      </span>
      <span className="profile-badges">
        {toolset && (
          <span
            className="profile-toolset-logo"
            title={toolset === "clawbrowser" ? "ClawBrowser" : "DasBrowser"}
            role="img"
            aria-label={toolset === "clawbrowser" ? "ClawBrowser" : "DasBrowser"}
          >
            <img
              src={toolset === "clawbrowser" ? "./clawbrowser-icon.png" : "./dasbrowser-icon.png"}
              alt=""
              draggable={false}
            />
          </span>
        )}
        {manualScheme && (
          <span className="badge manual-proxy-badge" title={manualTitle}>
            {manualScheme.toUpperCase()}
          </span>
        )}
      </span>
      <span className="spacer" />
      <div className="profile-actions">
        {running ? (
          <>
            <button
              className="plain-icon-btn"
              title="Stop"
              aria-label={`Stop ${name}`}
              data-tooltip="Stop"
              disabled={busy}
              onClick={(event) => {
                event.stopPropagation();
                void onStop();
              }}
            >
              <Icon name="stop.fill" size={16} />
            </button>
            <button
              className="plain-icon-btn"
              title="Live view"
              aria-label={`Open live view for ${name}`}
              data-tooltip="Live view"
              onClick={(event) => {
                event.stopPropagation();
                onLive();
              }}
            >
              <Icon name="video.fill" size={16} />
            </button>
          </>
        ) : (
          <button
            className="plain-icon-btn"
            title="Start"
            aria-label={`Start ${name}`}
            data-tooltip="Start"
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              void onStart();
            }}
          >
            <Icon name="play.fill" size={16} />
          </button>
        )}
        <button
          className="plain-icon-btn"
          title="Profile actions"
          aria-label={`Profile actions for ${name}`}
          data-tooltip="Actions"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
        >
          <Icon name="ellipsis.circle" size={18} />
        </button>
      </div>
    </div>
  );
}
