import { useState, type CSSProperties } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button, Dialog, IconButton } from '../../shared/ui';
import { contrastingInk } from '../../lib/appearance';
import { settingsStorage } from '../../lib/settingsStorage';
import { ContourField } from './ContourField';
import './skins.css';

const presets = { classic: 'Classic', smeta: 'smeta', blueprint: 'Blueprint', risograph: 'Risograph' } as const;
type Preset = keyof typeof presets;
type Skin = { id: Preset | 'custom'; color: string };
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
  function apply(next: Skin) {
    settingsStorage.setItem(storageKey, JSON.stringify(next));
    setSkin(next);
  }
  return { skin, apply };
}

export function skinStyle(skin: Skin) {
  return skin.id === 'custom' ? { '--skin-base': skin.color, '--skin-ink': contrastingInk(skin.color) } as CSSProperties : undefined;
}
export function SkinArtwork({ id }: { id: Skin['id'] }) {
  return id === 'classic' || id === 'custom' ? null : <div className="skin-artwork" aria-hidden="true">
    {id === 'smeta' && <ContourField />}
  </div>;
}

const rows = [
  ['esc', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '−', '=', '⌫'],
  ['tab', ...'QWERTYUIOP', '[', ']', '\\'],
  ['caps', ...'ASDFGHJKL', ';', "'", 'enter'],
  ['shift', ...'ZXCVBNM', ',', '.', '/', 'shift'],
  ['ctrl', 'alt', 'cmd', 'space', 'cmd', 'alt', '‹', '›'],
];
const widths: Record<string, number> = { '⌫': 2, tab: 1.5, '\\': 1.5, caps: 1.75, enter: 2.25, shift: 2.55, ctrl: 1.4, cmd: 1.4, alt: 1.25, space: 6 };

function KeyboardPreview({ skin }: { skin: Skin }) {
  const name = skin.id === 'custom' ? 'Custom color' : presets[skin.id];
  return <figure className="skin-preview" data-skin={skin.id} style={skinStyle(skin)} aria-label={name + ' keyboard preview'}>
    <div className="skin-preview-stage" aria-hidden="true">
      <div className="skin-keyboard" data-skin={skin.id}>
        <SkinArtwork id={skin.id} />
        {rows.map((row, i) => <div className="skin-key-row" key={i}>
          {row.map((key, j) => <span key={j} className="skin-key" data-key={key} style={{ flexGrow: widths[key] ?? 1 }}>{key === 'space' ? '' : key}</span>)}
        </div>)}
      </div>
    </div>
    <figcaption><strong>{name}</strong><span>Keyboard preview</span></figcaption>
  </figure>;
}

export function ComposerSkinPicker({ skin, onApply }: { skin: Skin; onApply: (skin: Skin) => void }) {
  const [draft, setDraft] = useState<Skin | null>(null);
  return <>
    <IconButton label="Customize composer appearance" appearance="embedded" size="small" className="composer-skin-trigger"
      aria-haspopup="dialog" aria-expanded={Boolean(draft)} onClick={() => setDraft(skin)}><Palette size={15} /></IconButton>
    {draft && <Dialog title="Composer appearance" className="composer-skin-dialog" onClose={() => setDraft(null)}>
      <KeyboardPreview skin={draft} />
      <div className="skin-options" role="group" aria-label="Keyboard skins">
        {(Object.keys(presets) as Preset[]).map(id => <button key={id} type="button" data-skin={id}
          aria-pressed={draft.id === id} onClick={() => setDraft({ ...draft, id })}>
          <span className="skin-sample" aria-hidden="true"><i /><i /><i /></span>
          <span>{presets[id]}</span>{draft.id === id && <Check size={13} aria-hidden="true" />}
        </button>)}
      </div>
      <div className="skin-settings-footer">
        <label className="skin-color"><span>Custom color</span><input type="color" aria-label="Custom composer color"
          value={draft.color} onClick={() => setDraft({ ...draft, id: 'custom' })}
          onChange={event => setDraft({ id: 'custom', color: event.target.value })} /></label>
        <button className="skin-color-value" type="button" aria-label={'Use custom color ' + draft.color} aria-pressed={draft.id === 'custom'}
          onClick={() => setDraft({ ...draft, id: 'custom' })}>{draft.color.toUpperCase()}</button>
        <Button className="skin-apply" onClick={() => { onApply(draft); setDraft(null); }}>Apply skin</Button>
      </div>
    </Dialog>}
  </>;
}
