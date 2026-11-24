import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '../electronBridge';
import { Button } from '../shared/ui';
type Guest = { id: string; src: string; partition: string };

export function OpenGuest({ id, owner, name, blockId, surface, popover = false }: { id: string; owner: string; name: string; blockId?: string; surface?: string; popover?: boolean }) {
  const [guest, setGuest] = useState<Guest>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setFailed(false);
    setGuest(undefined);
    invoke<Omit<Guest, 'id'>>('mini_apps_open', { owner, id, blockId, surface, popover }).then(target => {
      if (active) setGuest({ id, ...target });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [id, owner, blockId, surface, popover, attempt]);
  if (failed) return <p role="alert">Could not open {name}. <Button onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>Retry</Button></p>;
  return guest ? <GuestView guest={guest} name={name} popover={popover} /> : <p role="status">Opening {name}…</p>;
}

function GuestView({ guest, name, popover }: { guest: Guest; name: string; popover: boolean }) {
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    if (!popover) return;
    return window.nextbrowser?.on('mini-apps:popover-size', payload => {
      const data = payload as {partition?: string; height?: number} | null;
      if (data?.partition === guest.partition && typeof data.height === 'number') setHeight(data.height);
    });
  }, [guest.partition, popover]);
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
    : <webview key={attempt} ref={ref} className="mini-apps-guest" aria-label={name} style={height ? {height:'min(' + height + 'px, calc(100dvh - 70px))'} : undefined} partition={guest.partition} src={guest.src} />;
}
