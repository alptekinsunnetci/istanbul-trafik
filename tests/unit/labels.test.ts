import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtById } from '../../src/map/districts';
import { Terrain } from '../../src/map/grid';
import { createDistrictGrid } from '../../src/map/map-generator';
import { placeLabels } from '../../src/rendering/map-renderer';
import { DEFAULT_THEME, HIGH_CONTRAST_THEME, districtTheme } from '../../src/rendering/theme';
import { GEOM } from '../../src/core/constants';

const full = (w: number, h: number) => ({ x0: 0, y0: 0, x1: w - 1, y1: h - 1 });

describe('map labels', () => {
  it('every authored name lands on its own kind of terrain when the whole map is visible', () => {
    for (const d of DISTRICTS) {
      const grid = createDistrictGrid(d);
      const placed = placeLabels(grid, d.labels, full(grid.width, grid.height));
      expect(placed.length).toBe(d.labels.length);
      for (const p of placed) {
        const cell = grid.idx(Math.floor(p.x / GEOM.cellSize), Math.floor(p.y / GEOM.cellSize));
        expect(grid.terrain[cell]).toBe(p.kind === 'water' ? Terrain.Water : Terrain.Park);
      }
    }
  });

  it('leaves out names whose place is outside the playable area', () => {
    const d = districtById('fatih')!;
    const grid = createDistrictGrid(d);
    // A small area in the middle of the peninsula: no water, no Gülhane.
    const placed = placeLabels(grid, d.labels, { x0: 24, y0: 26, x1: 36, y1: 34 });
    expect(placed).toEqual([]);
  });
});

describe('district palettes', () => {
  it('tint the default theme but leave high contrast alone', () => {
    const d = districtById('besiktas')!;
    const t = districtTheme(DEFAULT_THEME, d.palette);
    expect(t.land).toBe(d.palette.land);
    expect(t.water).toBe(d.palette.water);
    expect(t.road).toBe(DEFAULT_THEME.road);
    expect(districtTheme(HIGH_CONTRAST_THEME, d.palette)).toBe(HIGH_CONTRAST_THEME);
    const lands = new Set(DISTRICTS.map((x) => x.palette.land));
    expect(lands.size).toBe(DISTRICTS.length);
  });
});
