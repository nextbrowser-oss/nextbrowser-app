import { MiniAppIcon } from './MiniAppIcon';
import { useMiniAppLibrary, useMiniAppsOwner } from '../lib/miniAppLibrary';
import { Tooltip } from '../shared/ui';
import { useStore } from '../store';

export function PinnedMiniApps() {
  const owner = useMiniAppsOwner();
  return owner ? <Shortcuts key={owner} owner={owner} /> : null;
}

function Shortcuts({ owner }: { owner: string }) {
  const { library } = useMiniAppLibrary(owner);
  const current = useStore(s => s.tab === 'mini-apps' && s.selectedMiniApp?.owner === owner ? s.selectedMiniApp.id : undefined);
  const select = useStore(s => s.setTab);
  return <>{library?.installed?.filter(app => app.pinned).map(app =>
    <Tooltip key={app.id} content={app.name} side="right"><button type="button"
      className={'sidebar-destination' + (app.id === current ? ' active' : '')}
      aria-label={'Open pinned app ' + app.name} aria-current={app.id === current ? 'page' : undefined}
      onClick={() => select('mini-apps', { owner, id: app.id })}>
      <MiniAppIcon app={app} />
    </button></Tooltip>)}</>;
}
