import { describe, expect, it } from 'vitest';
import type { Building } from '../../src/core/world-state';
import {
  type Pose,
  buildLanePath,
  centerline,
  chainRuns,
  diagonalRuns,
  poseOnPath,
} from '../../src/map/geometry';
import type { Dir } from '../../src/map/grid';
import {
  UNLIMITED,
  buildRoad,
  eraseRoad,
  normalizeStroke,
  previewBuild,
  straightenDiagonals,
} from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { addBuilding, addTrip, makeSim, runFor, testGrid } from '../helpers';

const E: Dir = 1;
const S: Dir = 2;

/** Cell path from (x, y) following steps written as a string of E/S/W/N. */
function walkPath(g: ReturnType<typeof testGrid>, x: number, y: number, steps: string): number[] {
  const out = [g.idx(x, y)];
  for (const ch of steps) {
    if (ch === 'E') x++;
    else if (ch === 'W') x--;
    else if (ch === 'S') y++;
    else y--;
    out.push(g.idx(x, y));
  }
  return out;
}

/** Largest distance of a polyline vertex from the infinite line through (ax, ay) at 45° down-right. */
function offDiagonal(xs: ArrayLike<number>, ys: ArrayLike<number>, ax: number, ay: number): number {
  let worst = 0;
  for (let k = 0; k < xs.length; k++)
    worst = Math.max(worst, Math.abs(xs[k]! - ax - (ys[k]! - ay)) / Math.SQRT2);
  return worst;
}

describe('diagonal roads', () => {
  it('a staircase becomes a 45° diagonal; single bends and the first/last step stay square', () => {
    expect(diagonalRuns([E, E, S, E, S, E, E])).toEqual([[1, 5]]);
    expect(diagonalRuns([E, E, S, S])).toEqual([]);
    expect(diagonalRuns([E, E, E])).toEqual([]);
    // A staircase straight out of a junction starts one step later.
    expect(diagonalRuns([S, E, S, E, S, E])).toEqual([[1, 5]]);
  });

  it('a diagonal drag builds a road whose length is the real diagonal, not the staircase', () => {
    const g = testGrid(20, 20);
    // Pointer samples from (2,2) to (12,12): the stroke fills in a staircase.
    const stroke = normalizeStroke(g, [g.idx(2, 2), g.idx(12, 12)]);
    expect(buildRoad(g, stroke, UNLIMITED).ok).toBe(true);
    const graph = buildGraph(g);
    const edge = graph.edgeList.find((e) => e.cells.length === stroke.length)!;
    expect(edge).toBeDefined();
    const staircase = (stroke.length - 1) * 16;
    expect(edge.centerLength).toBeLessThan(staircase * 0.8);
    expect(edge.stepPos).toHaveLength(edge.cells.length);
    expect(edge.stepPos[edge.stepPos.length - 1]).toBeCloseTo(edge.centerLength);
    // The lane follows the diagonal: most of its length runs at 45°.
    const lane = buildLanePath(g, edge, 0);
    let diagonal = 0;
    for (let k = 1; k < lane.xs.length; k++) {
      const dx = Math.abs(lane.xs[k]! - lane.xs[k - 1]!);
      const dy = Math.abs(lane.ys[k]! - lane.ys[k - 1]!);
      if (Math.abs(dx - dy) < 0.01 && dx > 0) diagonal += Math.hypot(dx, dy);
    }
    expect(diagonal).toBeGreaterThan(lane.length * 0.6);
    const line = centerline(g, edge.cells, edge.dirs);
    expect(line.xs.length).toBeLessThan(edge.cells.length);
  });

  it('cars drive a diagonal faster than the same trip on a square staircase would take', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const home = addBuilding(g, b, 'konut', 2, 3, 1);
    const shop = addBuilding(g, b, 'ticari', 20, 20, 3);
    const stroke = normalizeStroke(g, [home.door, g.idx(17, 21), shop.door]);
    expect(buildRoad(g, stroke, UNLIMITED).ok).toBe(true);
    const sim = makeSim(g, b);
    addTrip(sim, home, shop, 3);
    let maxSpeed = 0;
    runFor(sim, 120, () => {
      for (const v of sim.vehicles) maxSpeed = Math.max(maxSpeed, v.v);
    });
    expect(sim.stats.completed).toBe(3);
    const free = sim.stats.totalFreeFlowTime / 3;
    // Free-flow time follows the shorter diagonal length.
    expect(free).toBeLessThan(((stroke.length - 1) * 16) / 13.9);
    expect(maxSpeed).toBeGreaterThan(5);
  });

  it('a car on a diagonal stays where it is when a new junction splits the road', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const home = addBuilding(g, b, 'konut', 2, 3, 1);
    const shop = addBuilding(g, b, 'ticari', 20, 20, 3);
    const stroke = normalizeStroke(g, [home.door, g.idx(17, 21), shop.door]);
    buildRoad(g, stroke, UNLIMITED);
    const sim = makeSim(g, b);
    addTrip(sim, home, shop, 1);
    const where = (): Pose => {
      const v = sim.vehicles[0]!;
      const e = sim.graph.edge(v.edge)!;
      return poseOnPath(buildLanePath(g, e, v.lane), v.s / e.length, { x: 0, y: 0, angle: 0 });
    };
    // Drive until the car is well inside the diagonal.
    runFor(sim, 1, () => undefined);
    let guard = 0;
    while (sim.vehicles.length > 0 && guard++ < 400) {
      const v = sim.vehicles[0]!;
      const e = sim.graph.edge(v.edge)!;
      if (!v.junction && e.cells.length > 12 && v.s > e.length * 0.3) break;
      sim.step();
    }
    const before = where();
    // A side street joins a staircase cell in the middle of the diagonal.
    const v = sim.vehicles[0]!;
    const e = sim.graph.edge(v.edge)!;
    const mid = e.cells[Math.floor(e.cells.length * 0.7)]!;
    const side = normalizeStroke(g, [mid, g.idx(g.cx(mid), Math.min(28, g.cy(mid) + 4))]);
    buildRoad(g, side, UNLIMITED);
    sim.rebuildNetwork();
    expect(sim.vehicles).toHaveLength(1);
    const after = where();
    expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThan(6);
  });

  it('a diagonal step costs one road piece, and erasing gives back exactly what was paid', () => {
    const g = testGrid(20, 20);
    const stroke = normalizeStroke(g, [g.idx(2, 2), g.idx(12, 12)]);
    const r = buildRoad(g, stroke, UNLIMITED);
    // 10 diagonal steps over 21 staircase cells: far fewer pieces than cells.
    expect(r.spent.roads).toBeLessThanOrEqual(13);
    expect(r.spent.roads).toBeGreaterThanOrEqual(10);
    const back = eraseRoad(g, stroke);
    expect(back.spent.roads).toBe(-r.spent.roads);
  });
  it('an odd staircase is laid the same way in both directions, so two-way traffic shares one line', () => {
    expect(diagonalRuns([E, S, E, S, S], { openStart: false, openEnd: false })).toEqual([[1, 3]]);
    const g = testGrid(20, 20);
    // Chain between two dead ends: a straight step, 5 alternating steps (an odd staircase), straight.
    const stroke = walkPath(g, 2, 2, 'EESESEEE');
    buildRoad(g, stroke, UNLIMITED);
    const graph = buildGraph(g);
    const fwd = graph.edgeList.find((e) => e.cells[0] === stroke[0])!;
    const back = graph.edges.get(fwd.twin!)!;
    const a = buildLanePath(g, fwd, 0);
    const b = buildLanePath(g, back, 0);
    // Both lanes run 2·offset apart along their whole length.
    const pose = { x: 0, y: 0, angle: 0 };
    for (let t = 0.1; t < 0.95; t += 0.1) {
      const p = poseOnPath(a, t, { ...pose });
      let nearest = Infinity;
      for (let u = 0; u <= 1; u += 0.005) {
        const q = poseOnPath(b, u, pose);
        nearest = Math.min(nearest, Math.hypot(q.x - p.x, q.y - p.y));
      }
      expect(nearest).toBeLessThan(5);
    }
    const runs = chainRuns(g, fwd.cells, fwd.dirs);
    const mirrored = chainRuns(g, back.cells, back.dirs).map(([x, y]) => [
      fwd.cells.length - 1 - y,
      fwd.cells.length - 1 - x,
    ]);
    expect(mirrored.reverse()).toEqual(runs);
  });

  it('a side road joining the middle of a diagonal does not push the diagonal sideways', () => {
    const g = testGrid(30, 30);
    const stroke = normalizeStroke(g, [g.idx(2, 2), g.idx(16, 16)]);
    buildRoad(g, stroke, UNLIMITED);
    const lineOf = (): { xs: number[]; ys: number[] } => {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const e of buildGraph(g).edgeList) {
        const l = centerline(g, e.cells, e.dirs);
        xs.push(...l.xs);
        ys.push(...l.ys);
      }
      return { xs, ys };
    };
    const c = (v: number): number => (v + 0.5) * 16;
    const before = lineOf();
    expect(offDiagonal(before.xs, before.ys, c(2), c(2))).toBeLessThan(0.01);
    // A road from below joins an on-line cell of the diagonal.
    const side = walkPath(g, 9, 9, 'SSSSS');
    buildRoad(g, side, UNLIMITED);
    const after = lineOf();
    // Everything except the side road itself stays on the original 45° line.
    const onDiag = after.xs
      .map((x, k) => [x, after.ys[k]!] as const)
      .filter(([x, y]) => !(x === c(9) && y > c(9)));
    expect(
      offDiagonal(
        onDiag.map((p) => p[0]),
        onDiag.map((p) => p[1]),
        c(2),
        c(2),
      ),
    ).toBeLessThan(0.01);
  });

  it('a diagonal starts right at a junction or a dead end; the pieces paid stay the same', () => {
    const g = testGrid(20, 20);
    const stroke = walkPath(g, 2, 2, 'ESESESES');
    const p = previewBuild(g, stroke, UNLIMITED);
    // Every second cell is free: 4 corners out of 9 cells.
    expect(p.cells.filter((c) => c.free)).toHaveLength(4);
    expect(p.spent.roads).toBe(5);
    buildRoad(g, stroke, UNLIMITED);
    const edge = buildGraph(g).edgeList[0]!;
    const line = centerline(g, edge.cells, edge.dirs);
    expect(line.xs).toHaveLength(2);
  });

  it('a wobbly diagonal drag is straightened into an even staircase', () => {
    const g = testGrid(20, 20);
    // E S E S S E S E: the pointer slipped across the line once.
    const wobbly = walkPath(g, 2, 2, 'ESESSESE');
    const clean = straightenDiagonals(g, wobbly);
    expect(clean[0]).toBe(wobbly[0]);
    expect(clean[clean.length - 1]).toBe(wobbly[wobbly.length - 1]);
    expect(clean).toEqual(walkPath(g, 2, 2, 'ESESESES'));
    // Straight runs and 2:1 slopes are left alone.
    const straight = walkPath(g, 2, 2, 'EEEESSSS');
    expect(straightenDiagonals(g, straight)).toEqual(straight);
    const slope = walkPath(g, 2, 2, 'EESEESEES');
    expect(straightenDiagonals(g, slope)).toEqual(slope);
    // A building in the way keeps the drawn cells.
    g.building[g.idx(5, 4)] = 7;
    expect(straightenDiagonals(g, wobbly)).toEqual(wobbly);
  });
  it('vehicles turn smoothly where a straight road bends into a diagonal', () => {
    const g = testGrid(20, 20);
    buildRoad(g, walkPath(g, 2, 2, 'EEEESESESEEEE'), UNLIMITED);
    const edge = buildGraph(g).edgeList[0]!;
    const lane = buildLanePath(g, edge, 0);
    let sharpest = 0;
    let prev: number | null = null;
    for (let k = 1; k < lane.xs.length; k++) {
      const a = Math.atan2(lane.ys[k]! - lane.ys[k - 1]!, lane.xs[k]! - lane.xs[k - 1]!);
      if (prev !== null) sharpest = Math.max(sharpest, Math.abs(a - prev));
      prev = a;
    }
    // Two 45° bends, each spread over several small turns.
    expect(sharpest).toBeLessThan((15 * Math.PI) / 180);
  });
});
