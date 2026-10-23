import { GEOM } from '../core/constants';
import { DX, DY, type Dir, type Grid } from './grid';
import { type GraphEdge, laneOffset } from './road-graph';

export interface Pose {
  x: number;
  y: number;
  /** Heading in radians, 0 = east, clockwise positive (screen space). */
  angle: number;
}

/** Polyline of a lane centre, from the start junction box to the end junction box. */
export interface LanePath {
  xs: Float64Array;
  ys: Float64Array;
  /** Cumulative length at every point. */
  cum: Float64Array;
  length: number;
}

function cellCenter(grid: Grid, i: number): [number, number] {
  return [(grid.cx(i) + 0.5) * GEOM.cellSize, (grid.cy(i) + 0.5) * GEOM.cellSize];
}

/**
 * Diagonal stretches of a cell chain: a staircase of at least three
 * alternating steps (e.g. east, south, east, south) is driven and drawn as a
 * straight 45° line. Returned as [first cell, last cell] index pairs; every
 * diagonal covers an even number of steps. The first and the last step of a
 * chain stay straight, so roads always leave and enter junctions head-on.
 */
export function diagonalRuns(dirs: readonly Dir[]): [number, number][] {
  const m = dirs.length;
  const runs: [number, number][] = [];
  let i = 1;
  while (i < m - 1) {
    let L = 1;
    while (i + L < m - 1 && dirs[i + L] !== dirs[i + L - 1] && (L < 2 || dirs[i + L] === dirs[i + L - 2]))
      L++;
    if (L >= 3) {
      const span = Math.floor(L / 2) * 2;
      runs.push([i, i + span]);
      i += span;
    } else i++;
  }
  return runs;
}

export interface Centerline {
  /** Polyline vertices (cell centres; cells inside a diagonal are skipped). */
  xs: number[];
  ys: number[];
  /** Distance along the polyline of every cell of the chain (spread evenly for skipped cells). */
  stepPos: number[];
  length: number;
}

/** Centre line of a cell chain with its staircases straightened into diagonals. */
export function centerline(grid: Grid, cells: readonly number[], dirs: readonly Dir[]): Centerline {
  const inside = new Uint8Array(cells.length);
  for (const [a, b] of diagonalRuns(dirs)) for (let k = a + 1; k < b; k++) inside[k] = 1;
  const xs: number[] = [];
  const ys: number[] = [];
  const stepPos: number[] = new Array<number>(cells.length).fill(0);
  let len = 0;
  let last = -1;
  for (let k = 0; k < cells.length; k++) {
    if (inside[k]) continue;
    const [x, y] = cellCenter(grid, cells[k] as number);
    if (last >= 0) {
      const seg = Math.hypot(x - (xs[xs.length - 1] as number), y - (ys[ys.length - 1] as number));
      // Cells skipped by a diagonal lie evenly along it.
      for (let j = last + 1; j < k; j++) stepPos[j] = len + (seg * (j - last)) / (k - last);
      len += seg;
    }
    stepPos[k] = len;
    xs.push(x);
    ys.push(y);
    last = k;
  }
  return { xs, ys, stepPos, length: len };
}

/** Unit normal pointing to the right of direction d in screen space. */
function rightNormal(d: Dir): [number, number] {
  return [-(DY[d] as number), DX[d] as number];
}

export function buildLanePath(grid: Grid, edge: GraphEdge, lane: number): LanePath {
  const off = laneOffset(edge, lane);
  const R = GEOM.junctionRadius;
  const line = centerline(grid, edge.cells, edge.dirs);
  const vx = line.xs;
  const vy = line.ys;
  const last = vx.length - 1;
  // Right-hand normal of every polyline segment.
  const nx: number[] = [];
  const ny: number[] = [];
  for (let k = 0; k < last; k++) {
    const dx = (vx[k + 1] as number) - (vx[k] as number);
    const dy = (vy[k + 1] as number) - (vy[k] as number);
    const l = Math.hypot(dx, dy) || 1;
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  const px: number[] = [];
  const py: number[] = [];
  const d0 = edge.dirs[0] as Dir;
  const [n0x, n0y] = rightNormal(d0);
  px.push((vx[0] as number) + (DX[d0] as number) * R + n0x * off);
  py.push((vy[0] as number) + (DY[d0] as number) * R + n0y * off);
  for (let k = 1; k < last; k++) {
    const ax = nx[k - 1] as number;
    const ay = ny[k - 1] as number;
    const bx = nx[k] as number;
    const by = ny[k] as number;
    // Miter join: exact for straight, 45° and 90° bends.
    const m = off / (1 + ax * bx + ay * by);
    px.push((vx[k] as number) + (ax + bx) * m);
    py.push((vy[k] as number) + (ay + by) * m);
  }
  const dl = edge.lastDir;
  const [nlx, nly] = rightNormal(dl);
  px.push((vx[last] as number) - (DX[dl] as number) * R + nlx * off);
  py.push((vy[last] as number) - (DY[dl] as number) * R + nly * off);

  const n = px.length;
  const xs = new Float64Array(px);
  const ys = new Float64Array(py);
  const cum = new Float64Array(n);
  for (let k = 1; k < n; k++) {
    cum[k] =
      (cum[k - 1] as number) +
      Math.hypot((xs[k] as number) - (xs[k - 1] as number), (ys[k] as number) - (ys[k - 1] as number));
  }
  return { xs, ys, cum, length: cum[n - 1] as number };
}

/** Pose at a fraction t ∈ [0,1] of the path length. */
export function poseOnPath(path: LanePath, t: number, out: Pose): Pose {
  const target = Math.min(Math.max(t, 0), 1) * path.length;
  const n = path.xs.length;
  let k = 1;
  while (k < n - 1 && (path.cum[k] as number) < target) k++;
  const x0 = path.xs[k - 1] as number;
  const y0 = path.ys[k - 1] as number;
  const x1 = path.xs[k] as number;
  const y1 = path.ys[k] as number;
  const segLen = (path.cum[k] as number) - (path.cum[k - 1] as number);
  const f = segLen > 0 ? (target - (path.cum[k - 1] as number)) / segLen : 0;
  out.x = x0 + (x1 - x0) * f;
  out.y = y0 + (y1 - y0) * f;
  out.angle = Math.atan2(y1 - y0, x1 - x0);
  return out;
}

/** Cubic Bézier through a junction box. */
export interface JunctionCurve {
  p0x: number;
  p0y: number;
  p1x: number;
  p1y: number;
  p2x: number;
  p2y: number;
  p3x: number;
  p3y: number;
}

export function junctionCurve(
  cx: number,
  cy: number,
  inDir: Dir,
  inOffset: number,
  outDir: Dir,
  outOffset: number,
): JunctionCurve {
  const R = GEOM.junctionRadius;
  const [inx, iny] = rightNormal(inDir);
  const [onx, ony] = rightNormal(outDir);
  const p0x = cx - (DX[inDir] as number) * R + inx * inOffset;
  const p0y = cy - (DY[inDir] as number) * R + iny * inOffset;
  const p3x = cx + (DX[outDir] as number) * R + onx * outOffset;
  const p3y = cy + (DY[outDir] as number) * R + ony * outOffset;
  const k = R * 0.9;
  return {
    p0x,
    p0y,
    p1x: p0x + (DX[inDir] as number) * k,
    p1y: p0y + (DY[inDir] as number) * k,
    p2x: p3x - (DX[outDir] as number) * k,
    p2y: p3y - (DY[outDir] as number) * k,
    p3x,
    p3y,
  };
}

export function curvePose(c: JunctionCurve, t: number, out: Pose): Pose {
  const u = Math.min(Math.max(t, 0), 1);
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const cc = 3 * v * u * u;
  const d = u * u * u;
  out.x = a * c.p0x + b * c.p1x + cc * c.p2x + d * c.p3x;
  out.y = a * c.p0y + b * c.p1y + cc * c.p2y + d * c.p3y;
  const dx = 3 * v * v * (c.p1x - c.p0x) + 6 * v * u * (c.p2x - c.p1x) + 3 * u * u * (c.p3x - c.p2x);
  const dy = 3 * v * v * (c.p1y - c.p0y) + 6 * v * u * (c.p2y - c.p1y) + 3 * u * u * (c.p3y - c.p2y);
  if (dx !== 0 || dy !== 0) out.angle = Math.atan2(dy, dx);
  return out;
}

export function curveLength(c: JunctionCurve): number {
  const p: Pose = { x: c.p0x, y: c.p0y, angle: 0 };
  let len = 0;
  let px = c.p0x;
  let py = c.p0y;
  for (let i = 1; i <= 12; i++) {
    curvePose(c, i / 12, p);
    len += Math.hypot(p.x - px, p.y - py);
    px = p.x;
    py = p.y;
  }
  return Math.max(len, 0.5);
}
