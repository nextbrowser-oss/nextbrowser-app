import { translate } from "../../shared/lib/i18n";
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { ArrowUp, Check, Palette, Grid2X2, Paperclip, ScrollText, Sparkles } from 'lucide-react';
import { Button, Dialog, glassSurfaceClassName, IconButton } from '../../shared/ui';
import { contrastingInk } from '../../lib/appearance';
import { settingsStorage } from '../../lib/settingsStorage';
import { WidgetPicker } from '../PanelWidgets';
import type { WidgetSurface } from '../../lib/miniAppLibrary';
import { ContourField } from './ContourField';
import './skins.css';

const presets = { classic: 'Classic', smeta: 'smeta', blueprint: 'Blueprint', risograph: 'Risograph' } as const;
type Preset = keyof typeof presets;
export type Skin = { id: Preset | 'custom'; color: string };
const storageKey = 'nextbrowser.appearance.composerSkin';

function readSkin(): Skin {
  try {
    const saved = JSON.parse(settingsStorage.getItem(storageKey) ?? 'null');
    if (saved && typeof saved.id === 'string' && (saved.id === 'custom' || Object.prototype.hasOwnProperty.call(presets, saved.id))
        && typeof saved.color === 'string' && /^#[a-f0-9]{6}$/i.test(saved.color)) return { id: saved.id, color: saved.color };
  } catch { /* Fall back to the desktop theme. */ }
  return { id: 'classic', color: getComputedStyle(document.documentElement).getPropertyValue('--composer-custom-default').trim() };
}
export function useComposerSkin() {
  const [skin, setSkin] = useState(readSkin);
  useEffect(() => {
    const refresh = () => setSkin(readSkin());
    window.addEventListener('composer-skin-changed', refresh);
    return () => window.removeEventListener('composer-skin-changed', refresh);
  }, []);
  function apply(next: Skin) {
    settingsStorage.setItem(storageKey, JSON.stringify(next));
    window.dispatchEvent(new Event('composer-skin-changed'));
  }
  return { skin, apply };
}

export function skinStyle(skin: Skin) {
  return skin.id === 'custom' ? { '--skin-base': skin.color, '--skin-ink': contrastingInk(skin.color) } as CSSProperties : undefined;
}
function SkinArtwork({ id, still }: { id: Skin['id']; still?: boolean }) {
  return id === 'classic' || id === 'custom' ? null : <div className="skin-artwork" aria-hidden="true">
    {id === 'smeta' && <ContourField still={still} />}
  </div>;
}

export function ComposerSurface({ skin, children, still }: { skin: Skin; children: ReactNode; still?: boolean }) {
  return <div className={glassSurfaceClassName + ' composer'} data-skin={skin.id} style={skinStyle(skin)}>
    <SkinArtwork id={skin.id} still={still} />{children}
  </div>;
}

export function ComposerSample({ skin, still }: { skin: Skin; still?: boolean }) {
  return <div className="chat-composer-dock composer-sample" aria-hidden="true" ref={node => { if (node) node.inert = true; }}>
    <ComposerSurface skin={skin} still={still}>
      <textarea readOnly tabIndex={-1} rows={2} placeholder={translate("Message Nextbrowser agent — / for commands")} />
      <div className="composer-actions">
        <IconButton label={translate("Attach")} text="Attach" appearance="embedded" size="small"><Paperclip size={14} /></IconButton>
        <IconButton label={translate("Scripts")} text="Scripts" appearance="embedded" size="small"><ScrollText size={14} /></IconButton>
        <IconButton label={translate("Agent")} text="Agent" appearance="embedded" size="small"><Sparkles size={14} /></IconButton>
        <IconButton className="composer-grid-trigger" label={translate("Edit grid")} appearance="embedded" size="small"><Grid2X2 size={15} /></IconButton>
        <IconButton className="composer-skin-trigger" label={translate("Appearance")} appearance="embedded" size="small"><Palette size={15} /></IconButton>
        <IconButton label={translate("Send")} appearance="embedded"><ArrowUp size={20} /></IconButton>
      </div>
    </ComposerSurface>
  </div>;
}

function ComposerModel({ skin }: { skin: Skin }) {
  const name = skin.id === 'custom' ? 'Custom color' : presets[skin.id];
  return <figure className="skin-preview" data-skin={skin.id} style={skinStyle(skin)} aria-label={name + ' composer preview'}>
    <div className="skin-preview-stage" aria-hidden="true">
      <ComposerSample skin={skin} />
    </div>
    <figcaption><strong>{name}</strong></figcaption>
  </figure>;
}

export function ComposerSkinChoices({ skin, onChange }: { skin: Skin; onChange: (skin: Skin) => void }) {
  return <div className="skin-options" role="group" aria-label={translate("Composer skins")}>
    {(Object.keys(presets) as Preset[]).map(id => <button key={id} type="button" data-skin={id}
      aria-pressed={skin.id === id} onClick={() => onChange({ ...skin, id })}>
      <span className="skin-sample" aria-hidden="true"><i /><i /><i /></span>
      <span>{presets[id]}</span>{skin.id === id && <Check size={13} aria-hidden="true" />}
    </button>)}
  </div>;
}

export function ComposerColorChoice({ skin, onChange }: { skin: Skin; onChange: (skin: Skin) => void }) {
  return <>
    <label className="skin-color"><span>{translate("Custom color")}</span><input type="color" aria-label={translate("Custom composer color")}
      value={skin.color} onClick={() => onChange({ ...skin, id: 'custom' })}
      onChange={event => onChange({ id: 'custom', color: event.target.value })} /></label>
    <button className="skin-color-value" type="button" aria-label={'Use custom color ' + skin.color} aria-pressed={skin.id === 'custom'}
      onClick={() => onChange({ ...skin, id: 'custom' })}>{skin.color.toUpperCase()}</button>
  </>;
}

export function ComposerSkinPicker({ skin, onApply, chooseSurface = false }: { skin: Skin; onApply: (skin: Skin) => void; chooseSurface?: boolean }) {
  const [surface, setSurface] = useState<WidgetSurface>('chat.panel');
  const [draft, setDraft] = useState<Skin | null>(null);
  return <>
    <IconButton label={translate("Customize composer appearance")} appearance="embedded" size="small" className="composer-skin-trigger"
      aria-haspopup="dialog" aria-expanded={Boolean(draft)} onClick={() => setDraft(skin)}><Palette size={15} /></IconButton>
    {draft && <Dialog title={translate("Composer appearance")} className="composer-skin-dialog" onClose={() => setDraft(null)}>
      <ComposerModel skin={draft} />
      <ComposerSkinChoices skin={draft} onChange={setDraft} />
      {chooseSurface && <div className="widget-surface-options" role="group" aria-label={translate("Widget placement")}>
        <Button aria-pressed={surface === 'chat.panel'} onClick={() => setSurface('chat.panel')}>{translate("Composer")}</Button>
        <Button aria-pressed={surface === 'settings.design'} onClick={() => setSurface('settings.design')}>{translate("Theme settings")}</Button>
      </div>}
      <WidgetPicker surface={surface} />
      <div className="skin-settings-footer">
        <ComposerColorChoice skin={draft} onChange={setDraft} />
        <Button className="skin-apply" onClick={() => { onApply(draft); setDraft(null); }}>{translate("Apply skin")}</Button>
      </div>
    </Dialog>}
  </>;
}
