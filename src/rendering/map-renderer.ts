import type { Graphics } from 'pixi.js';
import { GEOM, MAP } from '../core/constants';
import type { MapLabel } from '../map/districts';
import { type Grid, Terrain, type TerrainType } from '../map/grid';
import { type Bounds, inBounds } from '../map/map-generator';
import type { Theme } from './theme';

const C = GEOM.cellSize;

type CellTest = (x: number, y: number) => boolean;

function ofType(grid: Grid, type: TerrainType): CellTest {
  return (x, y) => grid.inBounds(x, y) && grid.terrain[grid.idx(x, y)] === type;
}

/**
 * Draws a set of cells as a soft, organic shape: a disc on every cell, a
 * capsule between neighbouring cells and a filled square in every 2×2
 * block. `grow` widens the shape (used for river banks).
 */
function blob(g: Graphics, grid: Grid, is: CellTest, grow: number, color: number): void {
  const r = C * 0.62 + grow;
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      if (!is(x, y)) continue;
      const cx = (x + 0.5) * C;
      const cy = (y + 0.5) * C;
      g.circle(cx, cy, r).fill(color);
      if (is(x + 1, y)) g.rect(cx, cy - r, C, 2 * r).fill(color);
      if (is(x, y + 1)) g.rect(cx - r, cy, 2 * r, C).fill(color);
      if (is(x + 1, y) && is(x, y + 1) && is(x + 1, y + 1)) g.rect(cx, cy, C, C).fill(color);
      // Cells on the map border bleed outwards so water reaches the edge of the view.
      if (x === 0) g.rect(cx - C * 40, cy - r, C * 40, 2 * r).fill(color);
      if (y === 0) g.rect(cx - r, cy - C * 40, 2 * r, C * 40).fill(color);
      if (x === grid.width - 1) g.rect(cx, cy - r, C * 40, 2 * r).fill(color);
      if (y === grid.height - 1) g.rect(cx - r, cy, 2 * r, C * 40).fill(color);
    }
  }
}

/**
 * Paper-like land with a faint grid, parks and layered water: a light bank
 * along the shore, the water itself, a slightly darker band further out
 * and a sparse dot texture on open water.
 */
export function drawTerrain(g: Graphics, grid: Grid, theme: Theme, showGrid: boolean): void {
  g.clear();
  const pad = C * 40;
  g.rect(-pad, -pad, grid.width * C + 2 * pad, grid.height * C + 2 * pad).fill(theme.land);

  if (showGrid) {
    for (let x = 0; x <= grid.width; x++) g.moveTo(x * C, 0).lineTo(x * C, grid.height * C);
    for (let y = 0; y <= grid.height; y++) g.moveTo(0, y * C).lineTo(grid.width * C, y * C);
    g.stroke({ width: 0.5, color: theme.grid, alpha: 0.7 });
  }

  const park = ofType(grid, Terrain.Park);
  blob(g, grid, park, 1.5, theme.parkEdge);
  blob(g, grid, park, 0, theme.park);

  const field = waterField(grid);
  contour(g, field, -0.42, theme.waterBank);
  contour(g, field, 0, theme.water);
  contour(g, field, 1.9, theme.waterDeep);
  // Staggered dots on open water.
  for (let y = 0; y < grid.height; y++) {
    for (let x = y % 2; x < grid.width; x += 2) {
      if (field.at(x, y) > 2.6) g.circle((x + 0.5) * C, (y + 0.5) * C, 1.1);
    }
  }
  g.fill({ color: theme.waterDot, alpha: 0.9 });
}

/** Cells beyond the map edge drawn so that water reaches the edge of the view. */
const FIELD_PAD = 30;

interface Field {
  /** Smoothed signed distance to the shore in cells (positive on water), clamped beyond the map. */
  at(x: number, y: number): number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Signed distance from every cell to the shore, slightly blurred so that the
 * contour lines drawn from it follow smooth curves instead of cell steps.
 */
function waterField(grid: Grid): Field {
  const W = grid.width;
  const H = grid.height;
  const R = 5;
  const raw = new Float32Array(W * H);
  const isWater = (x: number, y: number): boolean =>
    grid.terrain[grid.idx(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)))] ===
    Terrain.Water;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const w = isWater(x, y);
      let best = R;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          if (isWater(x + dx, y + dy) === w) continue;
          const d = Math.hypot(dx, dy);
          if (d < best) best = d;
        }
      raw[y * W + x] = w ? best - 0.5 : 0.5 - best;
    }
  }
  const at0 = (x: number, y: number): number =>
    raw[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] as number;
  const smooth = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += at0(x + dx, y + dy);
      smooth[y * W + x] = sum / 9;
    }
  return {
    at: (x, y) => smooth[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))] as number,
    x0: -FIELD_PAD,
    y0: -FIELD_PAD,
    x1: W + FIELD_PAD,
    y1: H + FIELD_PAD,
  };
}

/**
 * Fills the area where the field is at least `level` (marching squares over
 * cell centres, edges interpolated linearly). Runs of fully covered squares
 * are merged into single rectangles.
 */
function contour(g: Graphics, f: Field, level: number, color: number): void {
  const px = (x: number): number => (x + 0.5) * C;
  for (let y = f.y0; y < f.y1; y++) {
    let run = -1;
    const flush = (end: number): void => {
      if (run < 0) return;
      g.rect(px(run), px(y), (end - run) * C, C).fill(color);
      run = -1;
    };
    for (let x = f.x0; x < f.x1; x++) {
      const v = [f.at(x, y), f.at(x + 1, y), f.at(x + 1, y + 1), f.at(x, y + 1)] as const;
      const inside = v.map((a) => a >= level);
      if (inside.every(Boolean)) {
        if (run < 0) run = x;
        continue;
      }
      flush(x);
      if (!inside.some(Boolean)) continue;
      const corners = [
        [x, y],
        [x + 1, y],
        [x + 1, y + 1],
        [x, y + 1],
      ] as const;
      const pts: number[] = [];
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4;
        const [ax, ay] = corners[k]!;
        const [bx, by] = corners[n]!;
        if (inside[k]) pts.push(px(ax), px(ay));
        if (inside[k] !== inside[n]) {
          const t = (level - v[k]!) / (v[n]! - v[k]!);
          pts.push(px(ax + (bx - ax) * t), px(ay + (by - ay) * t));
        }
      }
      g.poly(pts).fill(color);
    }
    flush(f.x1);
  }
}

export interface PlacedLabel {
  text: string;
  kind: MapLabel['kind'];
  vertical: boolean;
  /** Centre in world metres. */
  x: number;
  y: number;
}

/**
 * Puts each place name on the cell of its water body or park that is closest
 * to its authored anchor where the whole name fits on that place inside the
 * playable area, off the shore and clear of other names. Names that do not
 * fit yet are left out.
 */
export function placeLabels(grid: Grid, labels: readonly MapLabel[], bounds: Bounds): PlacedLabel[] {
  const sx = grid.width / MAP.defaultWidth;
  const sy = grid.height / MAP.defaultHeight;
  const out: PlacedLabel[] = [];
  // Cells already used by a name, so that two names never overlap.
  const taken = new Set<number>();
  for (const label of labels) {
    const type = label.kind === 'water' ? Terrain.Water : Terrain.Park;
    const is = ofType(grid, type);
    // Rough length of the written name in cells; the whole name must sit on its place.
    const half = Math.round((label.text.length * (label.kind === 'water' ? 0.6 : 0.34)) / 2);
    // Cells covered by the name, plus a one-cell margin across it so text keeps off the shore.
    const span = (x: number, y: number): number[] => {
      const cells: number[] = [];
      for (let k = -half; k <= half; k++)
        for (let m = -1; m <= 1; m++) {
          const cx = label.vertical ? x + m : x + k;
          const cy = label.vertical ? y + k : y + m;
          if (!grid.inBounds(cx, cy)) return [];
          cells.push(grid.idx(cx, cy));
        }
      return cells;
    };
    const fits = (x: number, y: number): boolean => {
      const cells = span(x, y);
      if (cells.length === 0) return false;
      return cells.every((c) => {
        const cx = grid.cx(c);
        const cy = grid.cy(c);
        return is(cx, cy) && inBounds(bounds, cx, cy) && !taken.has(c);
      });
    };
    const ax = label.x * sx;
    const ay = label.y * sy;
    const reach = (label.kind === 'water' ? 22 : 4) * sx;
    let best: [number, number] | null = null;
    let bestScore = Infinity;
    for (let y = bounds.y0 + 1; y < bounds.y1; y++) {
      for (let x = bounds.x0 + 1; x < bounds.x1; x++) {
        if (!fits(x, y)) continue;
        const d = Math.hypot(x + 0.5 - ax, y + 0.5 - ay);
        if (d > reach) continue;
        const score = d;
        if (score < bestScore) {
          bestScore = score;
          best = [x, y];
        }
      }
    }
    if (!best) continue;
    for (const c of span(best[0], best[1])) taken.add(c);
    out.push({
      text: label.text,
      kind: label.kind,
      vertical: label.vertical === true,
      x: (best[0] + 0.5) * C,
      y: (best[1] + 0.5) * C,
    });
  }
  return out;
}
