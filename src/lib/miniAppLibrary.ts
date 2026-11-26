import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '../electronBridge';
import { getPreviewMode } from '../preview';
import { useStore } from '../store';

export interface AppInfo { id: string; name: string; version: string; description: string; apiVersion: number; tools?: string[]; permissions: string[]; icon?: 'board' | 'calendar' | 'list' | 'notebook' | 'chart' | 'grid' | 'music' | 'video' | 'swipeforge' }
export type WidgetSurface = 'chat.panel' | 'settings.design';
export type GridSize = [number, number];
export interface WidgetBlock { id: string; name: string; surfaces: WidgetSurface[]; grid: {min: GridSize; preferred: GridSize; max: GridSize} }
export interface AppInfo { skill?: string; widgets?: WidgetBlock[]; sourcePublication?: string }
export interface ListingText { description: string; useCases: string[]; requirements: string; example: string; screenshots: Record<string, string> }
export interface CatalogApp extends AppInfo {
  publicationId?: string;
  community?: boolean;
  hasWidgets?: boolean;
  listing: { author: string; screenshots: { file: string; alt: string }[]; useCases: string[]; requirements: string; example: string; description?: string; locales?: Record<string, ListingText> };
}

/** The best of `available` for the system languages: the exact tag, then the base language; else English. */
export function pickLocale(available: string[], languages: readonly string[] = navigator.languages ?? [navigator.language]): string {
  for (const wanted of languages) {
    const tag = wanted.toLowerCase(), base = tag.split('-')[0];
    const found = available.find(k => k.toLowerCase() === tag) ?? available.find(k => k.toLowerCase() === base) ?? available.find(k => k.toLowerCase().split('-')[0] === base);
    if (found) return found;
  }
  return 'en';
}
/** The listing text in the system language, else English. */
export function listingText(app: CatalogApp, languages?: readonly string[]): ListingText {
  const { locales } = app.listing;
  if (!locales) return { ...app.listing, description:app.description, screenshots:Object.fromEntries(app.listing.screenshots.map(s => [s.file,s.alt])) };
  return locales[pickLocale(Object.keys(locales), languages)] ?? locales.en;
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
