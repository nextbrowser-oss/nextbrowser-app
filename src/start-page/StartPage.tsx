import { applyLanguage, formattingLocale, getLanguage, matchLanguage, subscribeLanguage, translate } from "../shared/lib/i18n";
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { Dialog, Glyph, IconButton, Popover } from '../shared/ui';
import { webDestination, type StartPin, type StartSnapshot } from '../lib/startPageModel';

const endpoint = location.pathname.replace(/\/$/, '') + '/';
async function api<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(endpoint + route, { method, cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Nextbrowser-Start': '1' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Nextbrowser is unavailable. Reopen Live from the app.');
  return data;
}

export function StartPage() {
  useSyncExternalStore(subscribeLanguage, getLanguage);
  const [data, setData] = useState<StartSnapshot>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mode, setMode] = useState<'search' | 'agent'>('search');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState(false);
  const [editor, setEditor] = useState<StartPin>();
  const [editorError, setEditorError] = useState('');
  const [dragged, setDragged] = useState<string>();
  const [pinMenu, setPinMenu] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const pinsRef = useRef<StartPin[]>([]);
  const savingRef = useRef(false);
  const pinsVersion = useRef(0);
  const apply = (snapshot: StartSnapshot) => {
    setData(snapshot);
    pinsRef.current = snapshot.pins;
    document.documentElement.dataset.theme = snapshot.theme;
    void applyLanguage(matchLanguage([snapshot.language || "", ...navigator.languages]));
  };
  useEffect(() => {
    let alive = true;
    const load = () => {
      const version = pinsVersion.current;
      if (!document.hidden && !savingRef.current) void api<StartSnapshot>('state').then(snapshot => {
        if (alive && !savingRef.current && version === pinsVersion.current) { apply(snapshot); setError(''); }
      }, reason => { if (alive) setError(reason.message); });
    };
    load(); const interval = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(interval); };
  }, []);

  async function action(type: string, extra: Record<string, string> = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<StartSnapshot>('action', 'POST', { type, ...extra });
      if (type === 'refresh') { apply({ ...result, pins: pinsRef.current }); setNotice(translate("Browser status updated. Exit details show the last recorded check.")); }
      else setNotice(type === 'draft' ? translate("Your draft is ready in Nextbrowser chat.") : translate("Session opened in Nextbrowser."));
      return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : translate("Could not complete this action.")); return false; }
    finally { setBusy(false); }
  }
  async function savePins(pins: StartPin[]) {
    if (savingRef.current) return false;
    savingRef.current = true; pinsVersion.current += 1; setSaving(true); setError('');
    try {
      const saved = await api<StartPin[]>('pins', 'PUT', pins);
      pinsRef.current = saved; setData(current => current && ({ ...current, pins: saved })); return true;
    } catch (reason) { const message = reason instanceof Error ? reason.message : 'Could not save shortcuts.'; setError(message); setEditorError(message); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }
  function movePin(id: string, beforeId: string) {
    const pins = [...pinsRef.current], from = pins.findIndex(p => p.id === id), to = pins.findIndex(p => p.id === beforeId);
    if (from < 0 || to < 0 || from === to) return;
    const [pin] = pins.splice(from, 1); pins.splice(to, 0, pin); void savePins(pins);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'agent') { if (await action('draft', { text: query.trim() })) setQuery(''); return; }
    const url = webDestination(query);
    if (url) location.assign(url); else setError(translate("Enter a search or an HTTP / HTTPS address without credentials."));
  }
  async function saveEditor(event: FormEvent) {
    event.preventDefault(); if (!editor) return;
    let url: URL;
    try { url = new URL(/^https?:\/\//i.test(editor.url) ? editor.url : `https://${editor.url}`); }
    catch { setEditorError(translate("Enter a valid website address.")); return; }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) { setEditorError(translate("Use HTTP or HTTPS without credentials.")); return; }
    const pin = { ...editor, name: editor.name.trim(), url: url.href };
    if (!pin.name) { setEditorError(translate("Give this shortcut a name.")); return; }
    const pins = pinsRef.current.some(p => p.id === pin.id) ? pinsRef.current.map(p => p.id === pin.id ? pin : p) : [...pinsRef.current, pin];
    if (await savePins(pins)) setEditor(undefined);
  }
  const edit = (pin?: StartPin) => { setPinMenu(undefined); setEditorError(''); setEditor(pin || { id: crypto.randomUUID(), name: '', url: '' }); };
  return <main className="start-shell">
    <header className="start-topline">
      <a className="start-brand" href={location.pathname}><img src="/nextbrowser-logo.svg" alt="" /><span>Nextbrowser</span></a>
      {data && <Popover label={translate("Profile connection")} open={details} onOpenChange={setDetails} align="end" className="start-status-popover"
        trigger={props => <button {...props} className="start-profile"><span className={`start-dot ${data.status === 'running' ? 'running' : ''}`} /><span>{data.profile}</span><Glyph name="chevron-down" size={14} /></button>}>
        <strong>{data.profile}</strong><dl><dt>{translate("Workspace")}</dt><dd>{data.workspace}</dd><dt>{translate("Browser")}</dt><dd>{data.runtime} · {data.status}</dd><dt>{translate("Connection")}</dt><dd>{data.connection}</dd><dt>{data.verified ? translate("Last recorded exit") : translate("Configured country")}</dt><dd>{data.country?.toUpperCase() || translate("Not available")}{data.ip && ` · ${data.ip}`}</dd></dl>
        <button className="start-soft-button" disabled={busy} onClick={() => void action('refresh')}><Glyph name="refresh" size={14} />{translate("Refresh browser status")}</button>
      </Popover>}
    </header>
    <section className="start-hero">
      <p className="start-eyebrow">{data?.workspace || translate("YOUR WORKSPACE")}</p>
      <h1>{translate("Where do we go next?")}</h1>
      <p className="start-subtitle">{translate("A place to explore. An agent to get things done.")}</p>
      <form className="start-composer" onSubmit={submit}>
        <div className="start-modes" role="tablist" aria-label={translate("Search or agent task")}>
          <button type="button" role="tab" aria-selected={mode === 'search'} onClick={() => { setMode('search'); input.current?.focus(); }}><Glyph name="search" size={16} />{translate("Search the web")}</button>
          <button type="button" role="tab" aria-selected={mode === 'agent'} onClick={() => { setMode('agent'); input.current?.focus(); }}><Glyph name="sparkles" size={16} />{translate("Ask your agent")}</button>
        </div>
        <div className="start-query"><input ref={input} aria-label={mode === 'search' ? translate("Search or enter an address") : translate("Task for your agent")}
          placeholder={mode === 'search' ? translate("Search anything, or paste a link") : translate("What would you like to get done?")} value={query} maxLength={12000} onChange={event => setQuery(event.target.value)} />
          <IconButton label={mode === 'search' ? translate("Search") : translate("Continue in chat")} type="submit" disabled={!query.trim() || busy || (mode === 'agent' && !data)} appearance="embedded" className="start-submit"><Glyph name="arrow-right" size={21} /></IconButton>
        </div>
        <div className="start-composer-footer"><span>{mode === 'search' ? translate("Google search · links open in this profile") : translate("%1 · review your draft in chat before sending", data?.agent || 'Your agent')}</span><kbd>↵</kbd></div>
      </form>
      {mode === 'agent' && <div className="start-suggestions">{['Research a topic and collect sources', 'Compare products and prices', 'Extract page data into a table'].map(text => <button key={text} onClick={() => { setQuery(text); input.current?.focus(); }}>{text}</button>)}</div>}
      {(error || notice) && <p className={`start-message ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </section>
    <section className="start-shortcuts" aria-label={translate("Pinned sites")}>
      <div className="start-section-head"><h2>{translate("Pinned sites")}</h2><span>{translate("Just for this profile")}</span></div>
      <div className="start-pin-grid">{data?.pins.map((pin, index) => <div key={pin.id} className={`start-pin ${dragged === pin.id ? 'dragging' : ''}`}
        draggable={!saving} onDragStart={event => { setDragged(pin.id); event.dataTransfer.setData('application/x-nextbrowser-pin', pin.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => setDragged(undefined)}
        onDragOver={event => { if (dragged) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('application/x-nextbrowser-pin'); if (id === dragged) movePin(id, pin.id); setDragged(undefined); }}>
        <a href={pin.url} rel="noreferrer" draggable={false}><span className="start-site-icon">{pin.name[0].toUpperCase()}</span><strong>{pin.name}</strong><small>{new URL(pin.url).hostname}</small></a>
        <Popover label={translate("Edit %1", pin.name)} open={pinMenu === pin.id} onOpenChange={open => setPinMenu(open ? pin.id : undefined)} className="start-pin-menu" align="end"
          trigger={props => <button {...props} className="start-pin-options" aria-label={translate("Options for %1", pin.name)}><Glyph name="sliders" size={14} /></button>}>
          <button onClick={() => edit(pin)}>{translate("Edit shortcut")}</button>
          <button disabled={!index || saving} onClick={() => { movePin(pin.id, data.pins[index - 1].id); setPinMenu(undefined); }}>{translate("Move earlier")}</button>
          <button disabled={index === data.pins.length - 1 || saving} onClick={() => { movePin(pin.id, data.pins[index + 1].id); setPinMenu(undefined); }}>{translate("Move later")}</button>
          <button disabled={saving} onClick={() => { void savePins(data.pins.filter(p => p.id !== pin.id)); setPinMenu(undefined); }}>{translate("Remove shortcut")}</button>
        </Popover>
      </div>)}
        <button className="start-add-pin" onClick={() => edit()} disabled={!data || saving || data.pins.length >= 24}><span className="start-site-icon"><Glyph name="plus" size={21} /></span><strong>{translate("Add a site")}</strong><small>{data?.pins.length ? translate("Pin a shortcut") : translate("Keep your essentials close")}</small></button>
      </div>
    </section>
    {!!data?.sessions.length && <section className="start-resume" aria-label={translate("Continue working")}><div className="start-section-head"><h2>{translate("Continue where you left off")}</h2><span>{translate("This profile’s sessions")}</span></div>
      <div className="start-session-grid">{data.sessions.map(session => <button key={session.id} className="start-session" disabled={busy} onClick={() => void action('resume', { id: session.id })}>
        <span className="start-session-top"><Glyph name="folder" size={18} /><time dateTime={new Date(session.updatedAt).toISOString()}>{new Date(session.updatedAt).toLocaleDateString(formattingLocale(), { month: 'short', day: 'numeric' })}</time><Glyph name="arrow-right" size={16} /></span>
        <strong>{session.title}</strong><p>{session.preview || translate("Open this conversation")}</p><small>{session.messages} {translate("messages · Open session")}</small>
      </button>)}</div>
    </section>}
    {data && <footer className="start-footnote"><Glyph name="network" size={14} /><span>{data.connection}{data.country ? ` · ${data.country.toUpperCase()}` : ''}</span><span className="start-footnote-separator">·</span><span>{data.runtime}</span><span className="start-footnote-separator">·</span><span>{data.status === 'running' ? translate("Browser running") : translate("Browser %1", data.status)}</span></footer>}
    {editor && <Dialog title={data?.pins.some(p => p.id === editor.id) ? translate("Edit shortcut") : translate("Add a site")} onClose={() => { if (!saving) setEditor(undefined); }} className="start-pin-dialog">
      <form onSubmit={saveEditor}><label>{translate("Name")}<input data-autofocus value={editor.name} maxLength={80} required onChange={e => setEditor({ ...editor, name: e.target.value })} placeholder={translate("My workspace")} /></label>
        <label>{translate("Website")}<input value={editor.url} maxLength={2048} required onChange={e => setEditor({ ...editor, url: e.target.value })} placeholder="https://example.com" /></label>
        {editorError && <p role="alert">{editorError}</p>}<div className="start-dialog-actions"><button type="button" disabled={saving} onClick={() => setEditor(undefined)}>{translate("Cancel")}</button><button type="submit" className="start-primary" disabled={saving}>{saving ? translate("Saving…") : translate("Save shortcut")}</button></div>
      </form>
    </Dialog>}
  </main>;
}
