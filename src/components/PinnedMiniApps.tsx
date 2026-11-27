import { translate } from "../shared/lib/i18n";
import { useState } from 'react';
import { invoke } from '../electronBridge';
import { MiniAppIcon } from './MiniAppIcon';
import { useMiniAppLibrary, useMiniAppsOwner } from '../lib/miniAppLibrary';
import { Dialog, Tooltip } from '../shared/ui';
import { useStore } from '../store';

export function PinnedMiniApps() {
  const owner = useMiniAppsOwner();
  return owner ? <Shortcuts key={owner} owner={owner} /> : null;
}

function Shortcuts({ owner }: { owner: string }) {
  const { library } = useMiniAppLibrary(owner);
  const current = useStore(s => s.tab === 'mini-apps' && s.selectedMiniApp?.owner === owner ? s.selectedMiniApp.id : undefined);
  const select = useStore(s => s.setTab);
  const pinned = library?.installed?.filter(app => app.pinned).sort((a, b) => a.railIndex - b.railIndex) ?? [];
  const [dragged, setDragged] = useState<string>();
  const [over, setOver] = useState<string>();
  const [error, setError] = useState('');
  const from = pinned.findIndex(app => app.generation === dragged);
  const endDrag = () => { setDragged(undefined); setOver(undefined); };
  if (!pinned.length) return null;
  return <>
    <hr className="mini-app-rail-divider" aria-hidden="true" />
    {pinned.map((app, index) => {
      const canDrop = from >= 0 && from !== index;
      const position = from < index ? 'after' : 'before';
      return <Tooltip key={app.id} content={app.name} side="right"><button type="button"
        className={'sidebar-destination' + (app.id === current ? ' active' : '')}
        aria-label={'Open pinned app ' + app.name} aria-current={app.id === current ? 'page' : undefined}
        draggable={pinned.length > 1} data-rail-drop={canDrop && over === app.generation ? position : undefined}
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('application/x-nextbrowser-rail-app', app.generation);
          setDragged(app.generation);
        }}
        onDragOver={event => {
          if (!canDrop) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setOver(app.generation);
        }}
        onDragLeave={() => setOver(previous => previous === app.generation ? undefined : previous)}
        onDragEnd={endDrag}
        onDrop={event => {
          if (!canDrop) return;
          event.preventDefault();
          endDrag();
          void invoke('mini_apps_move_pinned', { owner, source: dragged, target: app.generation, position })
            .catch(() => setError(translate("Could not save the rail order. Try moving the icon again.")));
        }}
        onClick={() => select('mini-apps', { owner, id: app.id })}>
        <MiniAppIcon app={app} />
      </button></Tooltip>;
    })}
    {error && <Dialog title={translate("Mini app order")} onClose={() => setError('')}><p role="alert">{error}</p></Dialog>}
  </>;
}
