import { Container, Graphics, GraphicsContext } from 'pixi.js';
import { GEOM, VEHICLE_TYPES, type VehicleKind } from '../core/constants';
import {
  type JunctionCurve,
  type LanePath,
  type Pose,
  buildLanePath,
  curveLength,
  curvePose,
  junctionCurve,
  poseOnPath,
} from '../map/geometry';
import type { Grid } from '../map/grid';
import type { GraphEdge, RoadGraph } from '../map/road-graph';
import type { JunctionPass, Vehicle } from '../traffic/vehicle-model';

const WIDTH = 1.9;
/** Vehicles are drawn larger than life (but never longer than their queue spacing) so they stay readable. */
const LENGTH_SCALE = 1.3;
const WIDTH_SCALE = 1.55;

interface Tracked {
  shape: Graphics;
  key: string;
  prev: Pose;
  cur: Pose;
  seen: number;
}

/** Shared geometry cache for lane paths and junction curves. */
export class PathCache {
  private lanes = new Map<string, LanePath>();
  private curves = new WeakMap<JunctionPass, { curve: JunctionCurve; length: number }>();

  constructor(private grid: Grid) {}

  clear(): void {
    this.lanes.clear();
  }

  lane(edge: GraphEdge, lane: number): LanePath {
    const key = `${edge.id}#${lane}#${edge.signature}`;
    let p = this.lanes.get(key);
    if (!p) {
      p = buildLanePath(this.grid, edge, lane);
      this.lanes.set(key, p);
    }
    return p;
  }

  curve(graph: RoadGraph, pass: JunctionPass): { curve: JunctionCurve; length: number } {
    let c = this.curves.get(pass);
    if (!c) {
      const node = graph.node(pass.node);
      const cx = node?.cx ?? ((pass.node % this.grid.width) + 0.5) * GEOM.cellSize;
      const cy = node?.cy ?? (Math.floor(pass.node / this.grid.width) + 0.5) * GEOM.cellSize;
      const curve = junctionCurve(cx, cy, pass.inDir, pass.inOffset, pass.outDir, pass.outOffset);
      c = { curve, length: curveLength(curve) };
      this.curves.set(pass, c);
    }
    return c;
  }
}

const scratchA: Pose = { x: 0, y: 0, angle: 0 };
const scratchB: Pose = { x: 0, y: 0, angle: 0 };

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** World pose of a vehicle's centre. */
export function vehiclePose(v: Vehicle, graph: RoadGraph, paths: PathCache, out: Pose): boolean {
  if (v.junction) {
    const { curve, length } = paths.curve(graph, v.junction);
    curvePose(curve, (v.junction.pos - v.length / 2) / length, out);
    return true;
  }
  const edge = graph.edge(v.edge);
  if (!edge) return false;
  const t = edge.length > 0 ? (v.s - v.length / 2) / edge.length : 0;
  poseOnPath(paths.lane(edge, v.lane), t, out);
  if (v.laneChange) {
    poseOnPath(paths.lane(edge, v.laneChange.to), t, scratchA);
    const k = smooth(Math.min(1, v.laneChange.progress));
    out.x += (scratchA.x - out.x) * k;
    out.y += (scratchA.y - out.y) * k;
  }
  return true;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * Vehicles are drawn as Graphics objects that share one GraphicsContext per
 * kind/colour combination, so geometry is built once and reused by every
 * vehicle and no render textures are needed.
 */
export class VehicleRenderer {
  readonly container = new Container();
  private contexts = new Map<string, GraphicsContext>();
  private tracked = new Map<number, Tracked>();
  private pool: Graphics[] = [];
  private frame = 0;

  private context(kind: VehicleKind, color: number): { key: string; ctx: GraphicsContext } {
    const key = `${kind}:${color}`;
    let ctx = this.contexts.get(key);
    if (!ctx) {
      ctx = buildVehicleContext(kind, color);
      this.contexts.set(key, ctx);
    }
    return { key, ctx };
  }

  /** Records poses after simulation steps so frames can interpolate between them. */
  capture(
    vehicles: readonly Vehicle[],
    graph: RoadGraph,
    paths: PathCache,
    colorOf: (v: Vehicle) => number,
  ): void {
    this.frame++;
    for (const v of vehicles) {
      if (!vehiclePose(v, graph, paths, scratchB)) continue;
      let t = this.tracked.get(v.id);
      if (!t) {
        const { key, ctx } = this.context(v.kind, colorOf(v));
        const shape = this.pool.pop() ?? new Graphics();
        shape.context = ctx;
        shape.visible = true;
        this.container.addChild(shape);
        t = { shape, key, prev: { ...scratchB }, cur: { ...scratchB }, seen: this.frame };
        this.tracked.set(v.id, t);
      } else {
        t.prev.x = t.cur.x;
        t.prev.y = t.cur.y;
        t.prev.angle = t.cur.angle;
        t.cur.x = scratchB.x;
        t.cur.y = scratchB.y;
        t.cur.angle = scratchB.angle;
        t.seen = this.frame;
      }
    }
    for (const [id, t] of this.tracked) {
      if (t.seen === this.frame) continue;
      this.recycle(t);
      this.tracked.delete(id);
    }
  }

  private recycle(t: Tracked): void {
    t.shape.visible = false;
    this.container.removeChild(t.shape);
    this.pool.push(t.shape);
  }

  /** Places vehicles between the last two captured poses. */
  update(alpha: number): void {
    const a = Math.min(Math.max(alpha, 0), 1);
    for (const t of this.tracked.values()) {
      t.shape.x = t.prev.x + (t.cur.x - t.prev.x) * a;
      t.shape.y = t.prev.y + (t.cur.y - t.prev.y) * a;
      t.shape.rotation = lerpAngle(t.prev.angle, t.cur.angle, a);
    }
  }

  /** Vehicle id closest to a world point within `radius`, or null. */
  pick(x: number, y: number, radius: number): number | null {
    let best: number | null = null;
    let bestD = radius * radius;
    for (const [id, t] of this.tracked) {
      const d = (t.cur.x - x) ** 2 + (t.cur.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  clear(): void {
    for (const t of this.tracked.values()) this.recycle(t);
    this.tracked.clear();
  }

  get count(): number {
    return this.tracked.size;
  }

  destroy(): void {
    this.clear();
    for (const g of this.pool) g.destroy();
    for (const ctx of this.contexts.values()) ctx.destroy();
    this.contexts.clear();
    this.container.destroy();
  }
}

/** Top-down vehicle in metres, centred on the origin, front towards +x. */
function buildVehicleContext(kind: VehicleKind, color: number): GraphicsContext {
  const L = VEHICLE_TYPES[kind].length * LENGTH_SCALE;
  const W = WIDTH * WIDTH_SCALE;
  const ctx = new GraphicsContext();
  ctx.roundRect(-L / 2, -W / 2, L, W, W * 0.4).fill(color);
  // A light band at the front shows the driving direction.
  ctx
    .roundRect(L / 2 - L * 0.26, -W / 2 + W * 0.18, L * 0.14, W * 0.64, W * 0.12)
    .fill({ color: 0xffffff, alpha: 0.55 });
  return ctx;
}
