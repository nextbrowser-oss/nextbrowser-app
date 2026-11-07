import type { ReactNode } from "react";
import { Glyph, IconButton } from "../shared/ui";
import { useStore } from "../store";
import "./navigation.css";

/** Application chrome stays available while the renderer is starting or showing sign-in. */
export function DesktopShell({ children }: { children: ReactNode }) {
  const collapsed = useStore(state => state.sidebarCollapsed);
  const toggle = useStore(state => state.setSidebarCollapsed);
  const available = useStore(state => !state.checking && !state.showOnboarding);
  const platform = window.nextbrowser?.platform ?? (/Mac/.test(navigator.platform) ? "darwin" : "win32");
  return (
    <div className="desktop-shell" data-platform={platform}>
      <header className="app-titlebar" aria-label="Application toolbar">
        <IconButton appearance="plain" size="small" label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed} aria-controls="app-sidebar" disabled={!available} onClick={() => toggle(!collapsed)}>
          <Glyph name="panel-left" size={18} />
        </IconButton>
        <span className="app-titlebar-name" aria-hidden="true">Nextbrowser</span>
      </header>
      <div className="desktop-shell-body">{children}</div>
    </div>
  );
}
