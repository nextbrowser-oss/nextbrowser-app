import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton, WindowControls } from "../shared/ui";
import { invoke } from "../electronBridge";
import { useStore } from "../store";
import { BrandLogo } from "./BrandLogo";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import "./navigation.css";

const TitlebarHost = createContext<HTMLDivElement | null>(null);

/** Keep page-owned actions in the global chrome without duplicating their state. */
export function TitlebarActions({ children }: { children: ReactNode }) {
  const host = useContext(TitlebarHost);
  return host ? createPortal(children, host) : null;
}

/** Application chrome stays available while the renderer is starting or showing sign-in. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
  const setTab = useStore(state => state.setTab);
  const available = useStore(state => !state.checking && !state.showOnboarding);
  const platform = window.nextbrowser?.platform ?? (/Mac/.test(navigator.platform) ? "darwin" : "win32");
  const customControls = platform !== "darwin" && window.nextbrowser?.customWindowControls === true;
  const [windowState, setWindowState] = useState({ maximized: false, fullscreen: false });
  useEffect(() => {
    if (!customControls) return;
    let active = true, receivedState = false;
    const validState = (value: unknown): value is typeof windowState => !!value && typeof value === "object" && "maximized" in value && typeof value.maximized === "boolean" && "fullscreen" in value && typeof value.fullscreen === "boolean";
    const unlisten = window.nextbrowser?.on("window-state", value => {
      if (validState(value)) { receivedState = true; setWindowState(value); }
    });
    void invoke<unknown>("app_window_state").then(value => { if (active && !receivedState && validState(value)) setWindowState(value); }).catch(() => undefined);
    return () => { active = false; unlisten?.(); };
  }, [customControls]);
  const control = (action: string) => { void invoke("app_window_control", { action }).catch(() => undefined); };
  return (
    <div className="desktop-shell" data-platform={platform} data-custom-caption={customControls || undefined}>
      <header className="app-titlebar" aria-label="Application toolbar">
        <IconButton appearance="plain" size="small" className="app-titlebar-logo" label="Back to main view"
          disabled={!available} onClick={() => setTab("chat")}><BrandLogo size={24} /></IconButton>
        <span className="app-titlebar-brand"><span className="app-titlebar-name">Nextbrowser</span><span className="app-titlebar-version">({__APP_VERSION__})</span></span>
        <WorkspaceSwitcher disabled={!available} />
        <div ref={setActionsHost} className="app-titlebar-actions" />
        {customControls && <WindowControls canRestore={windowState.maximized || windowState.fullscreen} onMinimize={() => control("minimize")} onToggleMaximize={() => control("toggle-maximize")} onClose={() => control("close")} />}
      </header>
      <TitlebarHost.Provider value={actionsHost}><div className="desktop-shell-body">{children}</div></TitlebarHost.Provider>
    </div>
  );
}
