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

/** Unit normal pointing to the right of direction d in screen space. */
function rightNormal(d: Dir): [number, number] {
  return [-(DY[d] as number), DX[d] as number];
}

export function buildLanePath(grid: Grid, edge: GraphEdge, lane: number): LanePath {
  const off = laneOffset(edge, lane);
  const R = GEOM.junctionRadius;
  const px: number[] = [];
  const py: number[] = [];
  const [sx, sy] = cellCenter(grid, edge.cells[0] as number);
  const d0 = edge.dirs[0] as Dir;
  const [n0x, n0y] = rightNormal(d0);
  px.push(sx + (DX[d0] as number) * R + n0x * off);
  py.push(sy + (DY[d0] as number) * R + n0y * off);
  for (let k = 1; k < edge.cells.length - 1; k++) {
    const a = edge.dirs[k - 1] as Dir;
    const b = edge.dirs[k] as Dir;
    if (a === b) continue;
    const [cx, cy] = cellCenter(grid, edge.cells[k] as number);
    const [ax, ay] = rightNormal(a);
    const [bx, by] = rightNormal(b);
    // Miter join for a 90° corner.
    px.push(cx + (ax + bx) * off);
    py.push(cy + (ay + by) * off);
  }
  const [ex, ey] = cellCenter(grid, edge.cells[edge.cells.length - 1] as number);
  const dl = edge.lastDir;
  const [nlx, nly] = rightNormal(dl);
  px.push(ex - (DX[dl] as number) * R + nlx * off);
  py.push(ey - (DY[dl] as number) * R + nly * off);

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
