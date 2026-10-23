import { describe, expect, it } from 'vitest';
import { JUNCTION } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import type { Grid } from '../../src/map/grid';
import { UNLIMITED, buildRoad, eraseRoad, noResources } from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { addBuilding, addTrip, makeSim, road, runFor, segment, testGrid } from '../helpers';

/** A horizontal pre-built highway on row y. */
function highway(g: Grid, y: number, x0: number, x1: number): void {
  road(g, [x0, y], [x1, y]);
  for (let x = x0; x <= x1; x++) {
    const c = g.idx(x, y);
    g.highway[c] = 1;
    g.lanes[c] = 2;
    g.locked[c] = 1;
  }
}

describe('overpasses', () => {
  it('a street drawn straight across a highway crosses on an overpass, using a bridge piece', () => {
    const g = testGrid(20, 20);
    highway(g, 10, 1, 18);
    const budget = { ...noResources(), roads: 50, bridges: 1 };
    const r = buildRoad(g, segment(g, 8, 4, 8, 16), budget);
    expect(r.ok).toBe(true);
    expect(r.spent.bridges).toBe(1);
    const c = g.idx(8, 10);
    expect(g.overpass[c]).toBe(1);
    // No junction: both roads pass straight through the cell.
    const graph = buildGraph(g);
    expect(graph.node(c)).toBeUndefined();
  });

  it('without a bridge piece the crossing becomes a junction', () => {
    const g = testGrid(20, 20);
    highway(g, 10, 1, 18);
    const r = buildRoad(g, segment(g, 8, 4, 8, 16), { ...noResources(), roads: 50 });
    expect(r.message).toBe('Köprü parçası yok: otoyolla kavşak yapılacak');
    const c = g.idx(8, 10);
    expect(g.overpass[c]).toBe(0);
    expect(buildGraph(g).node(c)?.degree).toBe(4);
  });

  it('ending a street on the highway joins it instead', () => {
    const g = testGrid(20, 20);
    highway(g, 10, 1, 18);
    buildRoad(g, segment(g, 8, 4, 8, 10), UNLIMITED);
    expect(g.overpass[g.idx(8, 10)]).toBe(0);
    expect(buildGraph(g).node(g.idx(8, 10))?.degree).toBe(3);
  });

  it('erasing gives the bridge back; erasing a street end takes the overpass with it', () => {
    const g = testGrid(20, 20);
    highway(g, 10, 1, 18);
    buildRoad(g, segment(g, 8, 4, 8, 16), UNLIMITED);
    const c = g.idx(8, 10);
    const off = eraseRoad(g, [c]);
    expect(off.spent.bridges).toBe(-1);
    expect(g.overpass[c]).toBe(0);
    expect(g.degree(c)).toBe(2);
    expect(g.isRoad(c)).toBe(true);
    buildRoad(g, segment(g, 8, 4, 8, 16), UNLIMITED);
    const end = eraseRoad(g, [g.idx(8, 11)]);
    expect(end.spent.bridges).toBe(-1);
    expect(g.overpass[c]).toBe(0);
    // The street is detached from the highway completely (no unintended junction).
    expect(g.degree(c)).toBe(2);
  });

  it('traffic on both roads passes without stopping for each other', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const west = addBuilding(g, b, 'konut', 2, 14, 1);
    const east = addBuilding(g, b, 'ticari', 26, 14, 3);
    const north = addBuilding(g, b, 'konut', 14, 2, 2);
    const south = addBuilding(g, b, 'ticari', 14, 26, 0);
    highway(g, 14, 3, 25);
    buildRoad(g, segment(g, 14, 3, 14, 25), UNLIMITED);
    expect(g.overpass[g.idx(14, 14)]).toBe(1);
    const sim = makeSim(g, b);
    addTrip(sim, west, east, 10);
    addTrip(sim, north, south, 10);
    let slowest = Infinity;
    runFor(sim, 200, () => {
      for (const v of sim.vehicles) {
        const e = sim.graph.edge(v.edge);
        if (!e || !e.cells.includes(g.idx(14, 14))) continue;
        const k = e.cells.indexOf(g.idx(14, 14));
        const at = k * 16 - 3;
        if (Math.abs(v.s - at) < 4 && v.s > 20) slowest = Math.min(slowest, v.v);
      }
    });
    expect(sim.stats.completed).toBe(20);
    expect(sim.junctions.signalCount).toBe(0);
    // Nobody had to slow down to give way at the crossing.
    expect(slowest).toBeGreaterThan(JUNCTION.yieldSpeed + 2);
  });
});

describe('ramps', () => {
  it('a car turning right onto an empty highway merges without stopping', () => {
    const g = testGrid(30, 30);
    const b: Building[] = [];
    const side = addBuilding(g, b, 'konut', 10, 24, 0);
    const east = addBuilding(g, b, 'ticari', 26, 14, 3);
    highway(g, 14, 3, 25);
    road(g, [10, 23], [10, 14]);
    const sim = makeSim(g, b);
    addTrip(sim, side, east, 1);
    let entry = -1;
    const node = g.idx(10, 14);
    runFor(sim, 60, () => {
      for (const v of sim.vehicles) if (entry < 0 && v.junction?.node === node) entry = v.v;
    });
    expect(sim.stats.completed).toBe(1);
    expect(entry).toBeGreaterThan(JUNCTION.yieldSpeed + 1);
  });
});
