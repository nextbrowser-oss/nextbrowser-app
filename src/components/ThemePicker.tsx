import { useLayoutEffect, useRef, useState } from "react";
import { Folder, PanelsTopLeft, Clock, Settings, BookOpen, MessageSquare, SlidersHorizontal } from "lucide-react";
import type { Theme, ThemePreference } from "../theme";
import { appearanceTokens, type Appearance, type ColorField } from "../lib/appearance";
import { ThemeColorFields } from "./ThemeEditor";
import { SETTINGS_SECTIONS } from "../lib/settingsSections";
import { Button } from "../shared/ui";
import { useStore } from "../store";
import { ComposerSample, ComposerSkinPicker, useComposerSkin, type Skin } from "./composer-skins/ComposerSkins";
import { BrandLogo } from "./BrandLogo";
import { PanelWidgets, WidgetSettingsButton } from "./PanelWidgets";
import { Icon } from "./Icon";
import "./themePicker.css";

const choices = [{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }, { value: "system", label: "System" }] as const;
const swatches: Record<ColorField, string> = { accent: "--accent", background: "--chat-bg", outgoing: "--chat-outgoing", incoming: "--chat-incoming" };
type Scene = "chat" | "settings";
type Palettes = Record<Theme, Appearance>;

function SettingsScene({ mode, preset }: { mode: Theme; preset: string }) {
  return <div className="preview-settings-window">
    <div className="preview-settings-sections">{SETTINGS_SECTIONS.map(section =>
      <span key={section.id} className={"settings-rail-item" + (section.id === "themes" ? " is-active" : "")}>
        <Icon name={section.icon} size={15} />{section.label}</span>)}</div>
    <div className="preview-settings-body"><div className="settings-panel-head"><h2>Themes</h2></div>
      <small>Saved theme</small><strong className="preview-preset">{preset}</strong>
      <b>{mode === "light" ? "Light" : "Dark"} colors</b>
      <ThemeColorFields readOnly control={key => <i style={{ background: "var(" + swatches[key] + ")" }} />} />
    </div>
  </div>;
}

function Viewport({ modes, palettes, scene, skin, workspace, preset, miniature = false }: {
  modes: Theme[]; palettes: Palettes; scene: Scene; skin: Skin; workspace: string; preset: string; miniature?: boolean;
}) {
  const view = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = view.current!;
    el.inert = true;
    const resize = () => setScale(el.clientWidth / 620);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const mode = modes[0];
  return <div className={miniature ? "settings-theme-preview" : "theme-screen-preview"} role={miniature ? undefined : "region"}
    aria-label={miniature ? undefined : (mode === "light" ? "Light " : "Dark ") + scene + " preview"}>
    <div ref={view} className="preview-clips" aria-hidden="true">{modes.map(palette =>
      <div key={palette} className="settings-theme-sample preview-layer" data-palette={palette} style={appearanceTokens(palettes[palette])}>
        <div className="preview-desktop" style={{ transform: "scale(" + scale + ")" }}>
          <header><BrandLogo size={17} /><b>Nextbrowser</b><span>Workspaces ({workspace})</span></header>
          <div className="preview-rail">{[Folder, PanelsTopLeft, Clock, BookOpen, Settings].map((Glyph, i) => <Glyph key={i} size={17} />)}</div>
          {scene === "settings" ? <SettingsScene mode={palette} preset={preset} /> : <div className="preview-conversation">
            <div className="preview-view-switch">Project <span>Live</span> <span>Automation</span></div>
            <div className="msg-user-bubble">Summarize this page for me.</div>
            <div className="assistant-bubble">Here are the highlights.</div>
            <ComposerSample skin={skin} still={miniature} />
          </div>}
        </div>
      </div>)}</div>
  </div>;
}

export function ThemePicker({ value, activeTheme, preset, onChange, palettes }: {
  value: ThemePreference; activeTheme: Theme; preset: string; onChange: (next: ThemePreference) => void; palettes: Palettes;
}) {
  const [scene, setScene] = useState<Scene>("chat");
  const { skin, apply } = useComposerSkin();
  const workspace = useStore(s => s.workspaces.find(w => w.id === s.activeWorkspaceId)?.name ?? "My workspace");
  const props = { palettes, scene, skin, workspace, preset };
  return <>
    <fieldset className="settings-theme-picker"><legend>Theme</legend>
      <div className="settings-theme-choices">{choices.map(choice =>
        <div className="settings-theme-choice" key={choice.value}>
          <Viewport {...props} miniature modes={choice.value === "system" ? ["light", "dark"] : [choice.value]} />
          <label className="settings-theme-caption"><input type="radio" name="appearance-theme" value={choice.value}
            checked={value === choice.value} onChange={() => onChange(choice.value)} />{choice.label}</label>
        </div>)}</div>
    </fieldset>
    <div className="theme-preview-controls">
      <div role="group" aria-label="Preview page">
        <Button aria-pressed={scene === "chat"} onClick={() => setScene("chat")}><MessageSquare size={14} />Chat</Button>
        <Button aria-pressed={scene === "settings"} onClick={() => setScene("settings")}><SlidersHorizontal size={14} />Settings</Button>
      </div>
      <WidgetSettingsButton /><ComposerSkinPicker skin={skin} onApply={apply} />
    </div>
    <Viewport {...props} modes={[activeTheme]} />
    <PanelWidgets surface="settings.design" />
  </>;
}
