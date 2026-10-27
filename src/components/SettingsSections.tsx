import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { SETTINGS_SECTIONS, settingsSectionAfterKey, settingsSectionInfo, type SettingsSection } from "../lib/settingsSections";

export const SETTINGS_PANEL_ID = "settings-panel";

export function settingsTabId(section: SettingsSection): string {
  return `settings-tab-${section}`;
}

/**
 * The Settings section rail: a vertical tablist. Only the selected tab is in
 * the Tab order; the arrow keys, Home and End move between sections.
 */
export function SettingsRail({
  section,
  attention,
  onSelect,
}: {
  section: SettingsSection;
  attention: Partial<Record<SettingsSection, string>>;
  onSelect: (section: SettingsSection) => void;
}) {
  const tabs = useRef<Partial<Record<SettingsSection, HTMLButtonElement | null>>>({});
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = settingsSectionAfterKey(section, event.key);
    if (!next) return;
    event.preventDefault();
    onSelect(next);
    tabs.current[next]?.focus();
  };
  return (
    <div className="settings-rail" role="tablist" aria-orientation="vertical" aria-label="Settings sections" onKeyDown={move}>
      {SETTINGS_SECTIONS.map((item) => {
        const selected = item.id === section;
        const note = attention[item.id];
        return (
          <button
            key={item.id}
            ref={(node) => { tabs.current[item.id] = node; }}
            id={settingsTabId(item.id)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={SETTINGS_PANEL_ID}
            aria-label={note ? `${item.label}, ${note}` : undefined}
            tabIndex={selected ? 0 : -1}
            className={"settings-rail-item" + (selected ? " is-active" : "")}
            title={note ? `${item.label}: ${note}` : item.label}
            onClick={() => onSelect(item.id)}
          >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
            {note && <span className="settings-rail-dot" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}

/** The selected section: its name and what it holds, then its settings. */
export function SettingsPanel({ section, children }: { section: SettingsSection; children: ReactNode }) {
  const info = settingsSectionInfo(section);
  return (
    <div className="settings-panel" id={SETTINGS_PANEL_ID} role="tabpanel" aria-labelledby={settingsTabId(section)} tabIndex={0}>
      <div className="settings-panel-head">
        <h2>{info.label}</h2>
        <p className="muted small">{info.summary}</p>
      </div>
      {children}
    </div>
  );
}
