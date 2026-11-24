import { useEffect, useRef, useState } from 'react';
import { invoke } from '../electronBridge';
import { Button } from '../shared/ui';
type Guest = { id: string; src: string; partition: string };

export function OpenGuest({ id, owner, name, blockId, surface }: { id: string; owner: string; name: string; blockId?: string; surface?: string }) {
  const [guest, setGuest] = useState<Guest>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setGuest(undefined);
    invoke<Omit<Guest, 'id'>>('mini_apps_open', { owner, id, blockId, surface }).then(target => {
      if (active) setGuest({ id, ...target });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, owner, blockId, surface, attempt]);
  if (failed) return <p role="alert">Could not open {name}. <Button onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>Retry</Button></p>;
  return guest ? <GuestView guest={guest} name={name} /> : <p role="status">Opening {name}…</p>;
}

function GuestView({ guest, name }: { guest: Guest; name: string }) {
  const ref = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const view = ref.current;
    const fail = () => setFailed(true);
    view?.addEventListener('render-process-gone', fail);
    view?.addEventListener('did-fail-load', fail);
    return () => {
      view?.removeEventListener('render-process-gone', fail);
      view?.removeEventListener('did-fail-load', fail);
    };
  }, [attempt]);
  return failed ? <p role="alert">Could not load {name}. <Button onClick={() => { setFailed(false); setAttempt(a => a + 1); }}>Retry</Button></p>
    : <webview key={attempt} ref={ref} className="mini-apps-guest" aria-label={name} partition={guest.partition} src={guest.src} />;
}
