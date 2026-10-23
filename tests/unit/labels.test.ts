import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtById } from '../../src/map/districts';
import { Terrain } from '../../src/map/grid';
import { createDistrictGrid } from '../../src/map/map-generator';
import { placeLabels } from '../../src/rendering/map-renderer';
import {
  DEFAULT_THEME,
  HIGH_CONTRAST_THEME,
  SEASONS,
  districtTheme,
  seasonOf,
} from '../../src/rendering/theme';
import { GEOM } from '../../src/core/constants';
import { GameSession } from '../../src/gameplay/game-session';

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

describe('river and shore names', () => {
  it('a river name follows the direction of the river', () => {
    const d = districtById('bakirkoy')!;
    const grid = createDistrictGrid(d);
    const placed = placeLabels(grid, d.labels, full(grid.width, grid.height));
    const ayamama = placed.find((p) => p.text === 'AYAMAMA DERESİ')!;
    expect(ayamama.river).toBe(true);
    // Ayamama runs north–south, so its name is written (nearly) vertically.
    expect(Math.abs(ayamama.angle)).toBeGreaterThan(1.2);
  });

  it('a sea is named while it is still just outside the playable area', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 1 });
    const placed = placeLabels(s.sim.grid, s.district.labels, s.bounds);
    expect(placed.map((p) => p.text)).toContain('MARMARA DENİZİ');
    s.dispose();
  });
});

describe('district palettes', () => {
  it('tint the default theme but leave high contrast alone', () => {
    const d = districtById('besiktas')!;
    const t = districtTheme(DEFAULT_THEME, d.palette);
    // Close to the district's own colours (the season only shifts them a little in spring).
    const near = (a: number, b: number): boolean =>
      [16, 8, 0].every((k) => Math.abs(((a >> k) & 255) - ((b >> k) & 255)) <= 16);
    expect(near(t.land, d.palette.land)).toBe(true);
    expect(near(t.water, d.palette.water)).toBe(true);
    expect(t.road).toBe(DEFAULT_THEME.road);
    expect(districtTheme(HIGH_CONTRAST_THEME, d.palette)).toBe(HIGH_CONTRAST_THEME);
    const lands = new Set(DISTRICTS.map((x) => x.palette.land));
    expect(lands.size).toBe(DISTRICTS.length);
  });
});

describe('seasons', () => {
  it('change every week and repaint ground and parks', () => {
    expect([1, 2, 3, 4, 5].map(seasonOf)).toEqual([0, 1, 2, 3, 0]);
    expect(SEASONS[seasonOf(4)]).toBe('Kış');
    const d = districtById('kadikoy')!;
    const themes = [0, 1, 2, 3].map((k) => districtTheme(DEFAULT_THEME, d.palette, k));
    expect(new Set(themes.map((t) => t.park)).size).toBe(4);
    // Winter ground is the lightest (snow).
    const light = (c: number): number => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    expect(Math.max(...themes.map((t) => light(t.land)))).toBe(light(themes[3]!.land));
    expect(districtTheme(HIGH_CONTRAST_THEME, d.palette, 3)).toBe(HIGH_CONTRAST_THEME);
  });
});
