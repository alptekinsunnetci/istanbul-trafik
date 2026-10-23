import { describe, expect, it } from 'vitest';
import type { Building } from '../../src/core/world-state';
import { type Pose, buildLanePath, centerline, diagonalRuns, poseOnPath } from '../../src/map/geometry';
import type { Dir } from '../../src/map/grid';
import { UNLIMITED, buildRoad, eraseRoad, normalizeStroke } from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { addBuilding, addTrip, makeSim, runFor, testGrid } from '../helpers';

const E: Dir = 1;
const S: Dir = 2;

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
});
