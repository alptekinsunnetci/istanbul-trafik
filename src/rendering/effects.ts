import type { Graphics } from 'pixi.js';
import { GEOM } from '../core/constants';
import type { Simulation } from '../core/simulation';
import { type LanePath, type Pose, poseOnPath } from '../map/geometry';
import { DIRS, DX, DY, type Grid } from '../map/grid';
import { axisOf } from '../traffic/junction-controller';
import type { PreviewCell } from '../map/road-editor';
import type { Theme } from './theme';
import { type PathCache, vehiclePose } from './vehicle-renderer';

const C = GEOM.cellSize;

/**
 * Ghost of the road being drawn (or erased); invalid cells get a red cross.
 * Free corner cells of a diagonal are skipped, so the ghost shows the 45°
 * line that will be built rather than its staircase.
 */
export function drawPreview(
  g: Graphics,
  grid: Grid,
  cells: readonly PreviewCell[],
  theme: Theme,
  erase: boolean,
): void {
  g.clear();
  const color = erase ? theme.previewInvalid : theme.previewValid;
  const center = (c: number): [number, number] => [(grid.cx(c) + 0.5) * C, (grid.cy(c) + 0.5) * C];
  let prev: PreviewCell | null = null;
  for (const p of cells) {
    if (p.free && p.valid) continue;
    const [x, y] = center(p.cell);
    if (prev && prev.valid && p.valid) {
      const [px, py] = center(prev.cell);
      g.moveTo(px, py).lineTo(x, y);
    }
    prev = p;
  }
  g.stroke({ width: 7.4, color, alpha: 0.45, cap: 'round', join: 'round' });
  for (const p of cells) {
    const [x, y] = center(p.cell);
    if (p.valid) {
      if (!p.free) g.circle(x, y, 3.7).fill({ color, alpha: 0.45 });
      continue;
    }
    const s = 3.2;
    g.circle(x, y, 5.5).fill({ color: theme.previewInvalid, alpha: 0.85 });
    g.moveTo(x - s, y - s)
      .lineTo(x + s, y + s)
      .moveTo(x + s, y - s)
      .lineTo(x - s, y + s)
      .stroke({ width: 1.4, color: 0xffffff, cap: 'round' });
  }
}

export function drawHover(g: Graphics, grid: Grid, cell: number, theme: Theme): void {
  g.clear();
  if (cell < 0) return;
  const x = (grid.cx(cell) + 0.5) * C;
  const y = (grid.cy(cell) + 0.5) * C;
  g.circle(x, y, 3.2).fill({ color: theme.hover, alpha: 0.25 });
}

const scratch: Pose = { x: 0, y: 0, angle: 0 };

function strokePath(g: Graphics, path: LanePath, from = 0): void {
  let started = false;
  const n = path.xs.length;
  const startLen = from * path.length;
  for (let k = 0; k < n; k++) {
    if ((path.cum[k] as number) < startLen) continue;
    if (!started) {
      poseOnPath(path, from, scratch);
      g.moveTo(scratch.x, scratch.y);
      started = true;
    }
    g.lineTo(path.xs[k] as number, path.ys[k] as number);
  }
}

/** Remaining route of the selected vehicle and a ring around its destination. */
export function drawSelection(
  g: Graphics,
  sim: Simulation,
  paths: PathCache,
  vehicleId: number | null,
  buildingId: number | null,
  theme: Theme,
): void {
  g.clear();
  if (vehicleId !== null) {
    const v = sim.vehicleById(vehicleId);
    if (v) {
      const graph = sim.graph;
      const start = v.junction ? v.routeIndex + 1 : v.routeIndex;
      for (let k = start; k < v.route.length; k++) {
        const e = graph.edge(v.route[k] as string);
        if (!e) break;
        const lane = k === v.routeIndex && !v.junction ? v.lane : 0;
        const from = k === v.routeIndex && !v.junction && e.length > 0 ? v.s / e.length : 0;
        strokePath(g, paths.lane(e, Math.min(lane, e.lanes - 1)), from);
      }
      g.stroke({ width: 1.6, color: theme.route, alpha: 0.85, cap: 'round', join: 'round' });
      if (vehiclePose(v, graph, paths, scratch)) {
        g.circle(scratch.x, scratch.y, 4.5).stroke({ width: 1.2, color: theme.selection });
      }
      const dest = sim.buildingById(v.destination);
      if (dest) buildingRing(g, dest.x, dest.y, dest.w, dest.h, theme.route);
    }
  }
  if (buildingId !== null) {
    const b = sim.buildingById(buildingId);
    if (b) buildingRing(g, b.x, b.y, b.w, b.h, theme.selection);
  }
}

function buildingRing(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x * C - 1, y * C - 1, w * C + 2, h * C + 2).stroke({ width: 1.4, color, alpha: 0.95 });
}

/**
 * Traffic layer using the status palette: free flow, heavy and jammed.
 * Line width also grows with congestion and jammed edges get cross marks,
 * so the state never depends on colour alone.
 */
export function drawTraffic(g: Graphics, sim: Simulation, paths: PathCache, theme: Theme): void {
  g.clear();
  const q = sim.queues;
  for (const e of sim.graph.edgeList) {
    const occ = q.occupancy(e);
    const queued = q.edgeQueue[e.index] ?? 0;
    const level = occ > 0.55 || queued >= 4 ? 2 : occ > 0.25 || queued >= 2 ? 1 : 0;
    const color = level === 2 ? theme.flowCritical : level === 1 ? theme.flowWarn : theme.flowGood;
    const width = level === 2 ? 2.4 : level === 1 ? 1.7 : 1.1;
    for (let lane = 0; lane < e.lanes; lane++) strokePath(g, paths.lane(e, lane));
    g.stroke({ width, color, alpha: 0.9, cap: 'round', join: 'round' });
    if (level === 2) {
      const p = poseOnPath(paths.lane(e, 0), 0.5, scratch);
      const s = 2.2;
      g.moveTo(p.x - s, p.y - s)
        .lineTo(p.x + s, p.y + s)
        .moveTo(p.x + s, p.y - s)
        .lineTo(p.x - s, p.y + s);
      g.stroke({ width: 0.9, color: 0xffffff, alpha: 0.95 });
    }
  }
}

export function drawGridlocks(g: Graphics, sim: Simulation, theme: Theme, pulse: number): void {
  g.clear();
  for (const info of sim.gridlocks) {
    for (const n of info.nodes) {
      const node = sim.graph.node(n);
      if (!node) continue;
      g.circle(node.cx, node.cy, 9 + pulse * 3).stroke({
        width: 1.6,
        color: theme.flowCritical,
        alpha: 0.95,
      });
      g.rect(node.cx - 0.6, node.cy - 4, 1.2, 4.6)
        .rect(node.cx - 0.6, node.cy + 1.6, 1.2, 1.2)
        .fill(theme.flowCritical);
    }
  }
}

/**
 * Traffic lights: a lamp on every arm of a signalled junction, green for the
 * direction that may go, amber while the junction clears, red otherwise.
 */
export function drawSignals(g: Graphics, sim: Simulation, theme: Theme): void {
  g.clear();
  const grid = sim.grid;
  for (const [cell, node] of sim.graph.nodes) {
    const st = sim.junctions.signal(cell);
    if (!st) continue;
    g.circle(node.cx, node.cy, 3.2).fill(theme.road).stroke({ width: 1, color: 0xffffff });
    for (const d of DIRS) {
      if (!grid.connected(cell, d)) continue;
      const mine = axisOf(d) === st.axis;
      const go = st.phase === 'green' || st.phase === 'left';
      const color = !mine ? theme.flowCritical : go ? theme.flowGood : theme.flowWarn;
      const x = node.cx + (DX[d] as number) * 8;
      const y = node.cy + (DY[d] as number) * 8;
      g.circle(x, y, 2.4).fill(color).stroke({ width: 1, color: 0xffffff });
      // Protected left turn: a white mark inside the green lamp.
      if (mine && st.phase === 'left') g.circle(x, y, 0.9).fill(0xffffff);
    }
  }
}
