import { describe, expect, it } from 'vitest';
import { RoadGraph } from '../../src/map/road-graph';
import {
  UNLIMITED,
  buildRoad,
  eraseRoad,
  normalizeStroke,
  setBoulevard,
  toggleOneWay,
} from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { Terrain } from '../../src/map/grid';
import { road, segment, testGrid } from '../helpers';

describe('topology', () => {
  it('creates a four-way junction where two roads cross', () => {
    const g = testGrid();
    road(g, [2, 10], [20, 10]);
    road(g, [11, 2], [11, 18]);
    const graph = buildGraph(g);
    const center = graph.node(g.idx(11, 10));
    expect(center).toBeDefined();
    expect(center?.degree).toBe(4);
    expect(center?.outEdges).toHaveLength(4);
    expect(center?.inEdges).toHaveLength(4);
    // 4 arms, each two-way.
    expect(graph.edges.size).toBe(8);
    for (const e of graph.edgeList) expect(e.twin).not.toBeNull();
  });

  it('keeps visually adjacent parallel roads disconnected', () => {
    const g = testGrid();
    road(g, [2, 5], [10, 5]);
    road(g, [2, 6], [10, 6]);
    const graph = buildGraph(g);
    for (let x = 2; x <= 10; x++) {
      expect(graph.steps.has(RoadGraph.stepKey(g.idx(x, 5), g.idx(x, 6)))).toBe(false);
      expect(graph.steps.has(RoadGraph.stepKey(g.idx(x, 6), g.idx(x, 5)))).toBe(false);
    }
    expect(graph.edges.size).toBe(4);
  });

  it('removes all connections of deleted cells', () => {
    const g = testGrid();
    road(g, [2, 10], [20, 10]);
    const before = buildGraph(g);
    expect(before.edges.size).toBe(2);
    const r = eraseRoad(g, [g.idx(11, 10)]);
    expect(r.ok).toBe(true);
    expect(r.spent.roads).toBe(-1);
    const after = buildGraph(g);
    expect(after.edges.size).toBe(4);
    for (const e of after.edgeList) expect(e.cells).not.toContain(g.idx(11, 10));
    expect(after.steps.has(RoadGraph.stepKey(g.idx(10, 10), g.idx(11, 10)))).toBe(false);
    expect(g.links[g.idx(10, 10)]! & (1 << 1)).toBe(0);
  });

  it('builds a single loop without explicit nodes', () => {
    const g = testGrid();
    road(g, [4, 4], [8, 4], [8, 8], [4, 8], [4, 4]);
    const graph = buildGraph(g);
    expect(graph.nodes.size).toBeGreaterThanOrEqual(1);
    expect(graph.edges.size).toBeGreaterThanOrEqual(2);
  });

  it('splits edges where the lane count changes', () => {
    const g = testGrid();
    road(g, [2, 10], [20, 10]);
    setBoulevard(g, segment(g, 8, 10, 14, 10), UNLIMITED);
    const graph = buildGraph(g);
    const lanes = graph.edgeList.map((e) => e.lanes).sort();
    expect(lanes).toContain(2);
    expect(lanes).toContain(1);
    for (const e of graph.edgeList.filter((x) => x.lanes === 2)) expect(e.speedLimit).toBeGreaterThan(14);
  });

  it('one-way roads produce a single directed edge', () => {
    const g = testGrid();
    road(g, [2, 10], [12, 10]);
    toggleOneWay(g, segment(g, 2, 10, 12, 10));
    const graph = buildGraph(g);
    expect(graph.edges.size).toBe(1);
    const e = graph.edgeList[0]!;
    expect(e.from).toBe(g.idx(2, 10));
    expect(e.to).toBe(g.idx(12, 10));
    expect(e.twin).toBeNull();
    // Toggling again in the same direction restores two-way traffic.
    toggleOneWay(g, segment(g, 2, 10, 12, 10));
    expect(buildGraph(g).edges.size).toBe(2);
  });

  it('rejects building over parks and reports missing road pieces', () => {
    const g = testGrid();
    g.terrain[g.idx(6, 5)] = Terrain.Park;
    const r = buildRoad(g, segment(g, 2, 5, 10, 5), UNLIMITED);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Park/);
    expect(g.isRoad(g.idx(5, 5))).toBe(true);
    expect(g.isRoad(g.idx(6, 5))).toBe(false);
    const poor = buildRoad(g, segment(g, 2, 12, 10, 12), { roads: 3, bridges: 0, boulevards: 0, lights: 0 });
    expect(poor.ok).toBe(false);
    expect(poor.spent.roads).toBe(3);
    expect(poor.message).toBe('Yol parçası kalmadı');
    // Water cells use bridge pieces instead of road pieces.
    g.terrain[g.idx(4, 16)] = Terrain.Water;
    const wet = buildRoad(g, segment(g, 2, 16, 6, 16), { roads: 10, bridges: 0, boulevards: 0, lights: 0 });
    expect(wet.message).toBe('Köprü parçası kalmadı');
    expect(wet.spent.roads).toBe(2);
  });

  it('normalises diagonal pointer jumps into a 4-connected path', () => {
    const g = testGrid();
    const path = normalizeStroke(g, [g.idx(2, 2), g.idx(5, 4)]);
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1]!;
      const b = path[k]!;
      expect(Math.abs(g.cx(a) - g.cx(b)) + Math.abs(g.cy(a) - g.cy(b))).toBe(1);
    }
    expect(path[path.length - 1]).toBe(g.idx(5, 4));
  });

  it('handles an empty grid', () => {
    const graph = buildGraph(testGrid());
    expect(graph.edges.size).toBe(0);
    expect(graph.nodes.size).toBe(0);
  });
});
