import { describe, expect, it } from 'vitest';
import { arrangeTiles, type Tile } from './widgetLayout';

describe('composer widget arrangement', () => {
  const tiles: Tile[] = [{key:'attach',size:[2,1]}, {key:'music',size:[1,1]}, {key:'info',size:[3,2]}];
  it('reflows other controls around a manually placed tile', () => {
    const result = arrangeTiles(tiles, 5, {music:{x:1,y:0,priority:2}, attach:{x:0,y:0,priority:1}});
    expect(result.get('music')).toEqual({x:1,y:0,w:1,h:1});
    expect(result.get('attach')).toEqual({x:2,y:0,w:2,h:1});
    expect(result.get('info')).toEqual({x:0,y:1,w:3,h:2});
  });
  it('adapts without overwriting the preferred position when a panel becomes narrow', () => {
    const anchors = {info:{x:6,y:2,priority:1}};
    expect(arrangeTiles(tiles,2,anchors).get('info')).toEqual({x:0,y:2,w:2,h:2});
    expect(arrangeTiles(tiles,12,anchors).get('info')).toEqual({x:6,y:2,w:3,h:2});
  });
});
