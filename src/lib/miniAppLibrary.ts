import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../electronBridge';
import { getPreviewMode } from '../preview';
import { useStore } from '../store';

export interface AppInfo { id: string; name: string; version: string; description: string; apiVersion: number; tools?: string[]; permissions: string[]; icon?: 'board' | 'calendar' | 'list' | 'notebook' | 'chart' | 'grid' | 'music' | 'video' }
export type WidgetSurface = 'chat.panel' | 'settings.design';
export type GridSize = [number, number];
export interface WidgetBlock { id: string; name: string; surfaces: WidgetSurface[]; grid: {min: GridSize; preferred: GridSize; max: GridSize} }
export interface AppInfo { skill?: string; widgets?: WidgetBlock[] }
export interface CatalogApp extends AppInfo {
  listing: { screenshots: { file: string; alt: string }[]; useCases: string[]; requirements: string; example: string };
}
interface Library { installed: (AppInfo & { pinned: boolean; railIndex: number; generation: string; placements?: Record<string, GridSize> })[]; catalog: CatalogApp[] }

export function useMiniAppsOwner() {
  const owner = useStore(s => s.accountOwnerId);
  return owner ? 'account/' + owner : getPreviewMode() ? 'preview' : undefined;
}

export function useMiniAppLibrary(owner?: string) {
  const [library, setLibrary] = useState<Library>();
  const [loadError, setLoadError] = useState('');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++request.current;
    if (!owner) { setLibrary(undefined); setLoadError(''); return; }
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
