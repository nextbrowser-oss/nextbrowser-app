import type { GridSize } from './miniAppLibrary';

export type Cell = { x: number; y: number };
export type TileRect = Cell & { w: number; h: number };
export type Anchors = Record<string, Cell & { priority: number }>;
export type Tile = { key: string; size: GridSize };

export const clampCell = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Newest explicit placement wins. Flow the remaining controls into free cells. */
export function arrangeTiles(tiles: Tile[], columns: number, anchors: Anchors): Map<string, TileRect> {
  const occupied: TileRect[] = [];
  const result = new Map<string, TileRect>();
  const ordered = [...tiles].sort((a, b) => (anchors[b.key]?.priority ?? 0) - (anchors[a.key]?.priority ?? 0));
  for (const tile of ordered) {
    const w = Math.min(columns, tile.size[0]), h = tile.size[1];
    const anchor = anchors[tile.key];
    let x = anchor ? clampCell(anchor.x, 0, columns - w) : 0;
    let y = anchor ? clampCell(anchor.y, 0, 64) : 0;
    const fits = () => occupied.every(r => x >= r.x + r.w || r.x >= x + w || y >= r.y + r.h || r.y >= y + h);
    if (!fits()) {
      x = 0; y = 0;
      while (!fits()) {
        if (++x > columns - w) { x = 0; y++; }
      }
    }
    const rect = { x, y, w, h };
    occupied.push(rect);
    result.set(tile.key, rect);
  }
  return result;
}
