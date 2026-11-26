import { useRef, useState } from 'react';
import { Button, Dialog } from '../../shared/ui';
import { invoke } from '../../electronBridge';
import type { AppInfo } from '../../lib/miniAppLibrary';
import { errorText } from './CommunityCatalog';

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(Error('Could not read ' + file.name));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}

export function PublishMiniApp({owner, onClose, onPublished}: {owner: string; onClose: () => void; onPublished: (name: string) => void}) {
  const [pkg, setPkg] = useState<{raw: string; info: AppInfo}>();
  const [shots, setShots] = useState<{file: File; alt: string}[]>([]);
  const [uses, setUses] = useState('');
  const [requirements, setRequirements] = useState('');
  const [example, setExample] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  async function inspect(file?: File) {
    const current = ++sequence.current;
    setPkg(undefined); setError('');
    if (!file) return;
    try {
      if (file.size > 262144) throw Error('Choose a package under 256 KiB.');
      const raw = await file.text();
      const info = await invoke<AppInfo>('mini_apps_inspect', {raw});
      if (current === sequence.current) setPkg({raw, info});
    } catch (e) { if (current === sequence.current) setError(errorText(e)); }
  }
  async function publish() {
    if (!pkg || busy) return;
    setBusy(true); setError('');
    try {
      const screenshots = await Promise.all(shots.map(async ({file,alt}) => ({alt:alt.trim(),data:await readImage(file)})));
      const publication = {package:pkg.raw, useCases:uses.split('\n').map(s => s.trim()).filter(Boolean), requirements:requirements.trim(), example:example.trim(), screenshots};
      await invoke('mini_apps_publish', {owner, id:pkg.info.id, publication});
      onPublished(pkg.info.name);
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <Dialog title="Publish mini app" onClose={() => { if (!busy) onClose(); }} className="catalog-detail">
    <p>Publish to the Nextbrowser catalog under your account. To update your listing, use the same ID and a higher version.</p>
    <form className="catalog-form" onSubmit={e => { e.preventDefault(); void publish(); }}><fieldset disabled={busy || owner === 'preview'}>
      <label>Mini app package<input type="file" accept=".nbmini.json,.json" onChange={e => void inspect(e.target.files?.[0])} /></label>
      {pkg && <p>{pkg.info.name} · {pkg.info.id} · v{pkg.info.version}</p>}
      <label>Screenshots (2–8 PNGs, 16:9, up to 512 KiB each)<input type="file" accept="image/png" multiple onChange={e => {
        const files = Array.from(e.target.files ?? []); setShots([]); setError('');
        if (files.length < 2 || files.length > 8 || files.some(f => f.size > 524288 || !/\.png$/i.test(f.name))) {
          setError('Choose 2–8 PNG screenshots up to 512 KiB each.'); return;
        }
        setShots(files.map(file => ({file,alt:''})));
      }} /></label>
      {shots.map((s,i) => <label key={i}>Caption for {s.file.name}<input required maxLength={200} value={s.alt} onChange={e => setShots(shots.map((other,j) => j===i ? {...other,alt:e.target.value} : other))} /></label>)}
      <label>Use cases (one per line)<textarea rows={2} required value={uses} onChange={e => setUses(e.target.value)} /></label>
      <label>Requirements<input maxLength={500} required value={requirements} onChange={e => setRequirements(e.target.value)} /></label>
      <label>Example agent request<input maxLength={500} required value={example} onChange={e => setExample(e.target.value)} /></label>
      <Button type="submit" disabled={!pkg || shots.length < 2 || busy}>{busy ? 'Publishing…' : 'Publish to catalog'}</Button>
    </fieldset></form>
    {owner === 'preview' && <p>Sign in to Nextbrowser to publish a mini app.</p>}
    {error && <p role="alert">{error}</p>}
  </Dialog>;
}
