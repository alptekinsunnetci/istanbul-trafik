import { describe, expect, it } from 'vitest';
import { eraseRoad, toggleOneWay } from '../../src/map/road-editor';
import { buildGraph } from '../../src/map/topology';
import { RouteCache, findRoute, freeFlowCosts, routeValid, type CostModel } from '../../src/traffic/routing';
import { road, segment, testGrid } from '../helpers';

/** Route end points behave like building doors: locked cells are always graph nodes. */
function nodes(g: ReturnType<typeof testGrid>) {
  const a = g.idx(3, 10);
  const b = g.idx(19, 10);
  g.locked[a] = 1;
  g.locked[b] = 1;
  return { a, b };
}

describe('A* routing', () => {
  it('finds the optimal route among alternatives', () => {
    const g = testGrid();
    road(g, [3, 10], [19, 10]);
    road(g, [3, 10], [3, 4], [19, 4], [19, 10]);
    const { a, b } = nodes(g);
    const graph = buildGraph(g);
    const r = findRoute(graph, freeFlowCosts, { node: a }, b);
    expect(r).not.toBeNull();
    const cells = r!.edges.flatMap((id) => graph.edge(id)!.cells);
    expect(cells.every((c) => g.cy(c) === 10)).toBe(true);
    expect(r!.cost).toBeCloseTo((16 * 16) / 13.9, 5);
  });

  it('takes the detour when the direct road is expensive', () => {
    const g = testGrid();
    road(g, [3, 10], [19, 10]);
    road(g, [3, 10], [3, 4], [19, 4], [19, 10]);
    const { a, b } = nodes(g);
    const graph = buildGraph(g);
    const costs: CostModel = {
      edgeCost: (e) => e.freeFlowTime + (e.cells.every((c) => g.cy(c) === 10) ? 1000 : 0),
      movementCost: () => 0,
    };
    const r = findRoute(graph, costs, { node: a }, b)!;
    const cells = r.edges.flatMap((id) => graph.edge(id)!.cells);
    expect(cells.some((c) => g.cy(c) === 4)).toBe(true);
  });

  it('returns null when the destination is unreachable', () => {
    const g = testGrid();
    road(g, [3, 10], [10, 10]);
    road(g, [12, 10], [19, 10]);
    const { a, b } = nodes(g);
    const graph = buildGraph(g);
    expect(findRoute(graph, freeFlowCosts, { node: a }, b)).toBeNull();
    expect(findRoute(graph, freeFlowCosts, { node: a }, 99999)).toBeNull();
  });

  it('never routes against a one-way street', () => {
    const g = testGrid();
    road(g, [3, 10], [19, 10]);
    toggleOneWay(g, segment(g, 19, 10, 3, 10)); // traffic flows westwards only
    const { a, b } = nodes(g);
    const graph = buildGraph(g);
    expect(findRoute(graph, freeFlowCosts, { node: a }, b)).toBeNull();
    expect(findRoute(graph, freeFlowCosts, { node: b }, a)).not.toBeNull();
  });

  it('cannot use a deleted road and invalidates affected routes', () => {
    const g = testGrid();
    road(g, [3, 10], [19, 10]);
    const { a, b } = nodes(g);
    const before = buildGraph(g);
    const r = findRoute(before, freeFlowCosts, { node: a }, b)!;
    const cache = new RouteCache();
    cache.set(`n${a}|${b}`, r, 0);
    cache.set('n1|2', { edges: ['999>1'], cost: 1 }, 0);
    eraseRoad(g, [g.idx(11, 10)]);
    const after = buildGraph(g);
    expect(routeValid(before, r.edges, 0, b)).toBe(true);
    expect(routeValid(after, r.edges, 0, b)).toBe(false);
    expect(findRoute(after, freeFlowCosts, { node: a }, b)).toBeNull();
    const changed = new Set(
      [...before.edges.keys()].filter((id) => after.edge(id)?.signature !== before.edge(id)!.signature),
    );
    expect(cache.invalidate(changed)).toBe(1);
    expect(cache.get(`n${a}|${b}`, 0)).toBeUndefined();
    expect(cache.get('n1|2', 0)).toBeDefined();
  });

  it('disallows U-turns except at dead ends', () => {
    const g = testGrid();
    road(g, [3, 10], [12, 10]);
    road(g, [12, 10], [12, 14]);
    road(g, [12, 10], [12, 6]);
    const graph = buildGraph(g);
    const west = graph.edge(`${g.idx(3, 10)}>1`)!;
    const succ = graph.successors(west).map((e) => e.id);
    expect(succ).not.toContain(west.twin);
    // At the dead end (3,10) the only way out is back.
    const back = graph.edge(west.twin!)!;
    expect(graph.successors(back).map((e) => e.id)).toEqual([west.id]);
  });
});
