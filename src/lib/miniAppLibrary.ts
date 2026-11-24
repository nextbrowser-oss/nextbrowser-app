import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../electronBridge';
import { getPreviewMode } from '../preview';
import { useStore } from '../store';

export interface AppInfo { id: string; name: string; version: string; description: string; permissions: string[]; icon?: 'board' | 'calendar' | 'list' | 'notebook' | 'chart' | 'grid' }
interface Library { installed: (AppInfo & { pinned: boolean })[]; catalog: AppInfo[] }

export function useMiniAppsOwner() {
  const owner = useStore(s => s.accountOwnerId);
  return owner ? 'account/' + owner : getPreviewMode() ? 'preview' : undefined;
}

export function useMiniAppLibrary(owner: string) {
  const [library, setLibrary] = useState<Library>();
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++request.current;
    try {
      const next = await invoke<Library>('mini_apps_list', { owner });
      if (seq === request.current) { setLibrary(next); setLoadError(''); }
    } catch (error) {
      if (seq === request.current) setLoadError(error instanceof Error ? error.message : 'Could not load mini apps.');
    }
  }, [owner]);
  useEffect(() => {
    const unsubscribe = window.nextbrowser?.on('mini-apps:changed', refresh);
    void refresh();
    return () => { unsubscribe?.(); ++request.current; };
  }, [refresh]);
  return { library, refresh, loadError };
}
