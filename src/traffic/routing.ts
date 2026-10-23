import { ROUTING } from '../core/constants';
import { type GraphEdge, type RoadGraph, turnBetween } from '../map/road-graph';

export interface CostModel {
  /** Expected seconds to traverse the edge, ≥ its free-flow time. */
  edgeCost(edge: GraphEdge): number;
  /** Expected seconds for the movement from `from` onto `to`, ≥ 0. */
  movementCost(from: GraphEdge, to: GraphEdge): number;
}

export interface Route {
  edges: string[];
  cost: number;
}

/** Cost model without congestion; used for free-flow estimates. */
export const freeFlowCosts: CostModel = {
  edgeCost: (e) => e.freeFlowTime,
  movementCost: () => 0,
};

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if ((keys[p] as number) <= key) break;
      keys[i] = keys[p] as number;
      vals[i] = vals[p] as number;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const keys = this.keys;
    const vals = this.vals;
    const top = vals[0] as number;
    const lastKey = keys.pop() as number;
    const lastVal = vals.pop() as number;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && (keys[r] as number) < (keys[l] as number) ? r : l;
        if ((keys[c] as number) >= lastKey) break;
        keys[i] = keys[c] as number;
        vals[i] = vals[c] as number;
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return top;
  }
}

/**
 * Edge-based A*: search states are directed edges, which lets turn rules
 * (no U-turns except at dead ends) and movement costs be modelled exactly.
 * The heuristic is the straight-line distance between node centres divided
 * by the highest speed limit of the network. Every edge's cost is at least
 * its free-flow time (centre-to-centre length / speed limit), so the
 * heuristic never overestimates and A* returns an optimal route.
 */
export function findRoute(
  graph: RoadGraph,
  costs: CostModel,
  start: { node: number } | { edge: GraphEdge },
  destination: number,
  maxExpansions = 20000,
): Route | null {
  const dest = graph.node(destination);
  if (!dest) return null;
  const h = (e: GraphEdge): number => graph.distance(e.to, destination) / graph.maxSpeed;

  const n = graph.edgeList.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();

  let starts: GraphEdge[];
  let startEdge: GraphEdge | null = null;
  if ('node' in start) {
    const node = graph.node(start.node);
    if (!node) return null;
    if (start.node === destination) return { edges: [], cost: 0 };
    starts = node.outEdges
      .map((id) => graph.edge(id))
      .filter((e): e is GraphEdge => e !== undefined && e.open);
  } else {
    startEdge = start.edge;
    if (startEdge.to === destination) return { edges: [], cost: 0 };
    starts = graph.successors(startEdge);
  }
  for (const e of starts) {
    const cost = (startEdge ? costs.movementCost(startEdge, e) : 0) + costs.edgeCost(e);
    if (cost < (g[e.index] as number)) {
      g[e.index] = cost;
      heap.push(cost + h(e), e.index);
    }
  }

  let expansions = 0;
  while (heap.size > 0) {
    const idx = heap.pop();
    if (closed[idx] === 1) continue;
    closed[idx] = 1;
    const e = graph.edgeList[idx] as GraphEdge;
    if (e.to === destination) return { edges: reconstruct(graph, prev, idx), cost: g[idx] as number };
    if (++expansions > maxExpansions) break;
    for (const next of graph.successors(e)) {
      if (closed[next.index] === 1) continue;
      const cost = (g[idx] as number) + costs.movementCost(e, next) + costs.edgeCost(next);
      if (cost < (g[next.index] as number)) {
        g[next.index] = cost;
        prev[next.index] = idx;
        heap.push(cost + h(next), next.index);
      }
    }
  }
  return null;
}

function reconstruct(graph: RoadGraph, prev: Int32Array, end: number): string[] {
  const out: string[] = [];
  for (let i = end; i >= 0; i = prev[i] as number) out.push((graph.edgeList[i] as GraphEdge).id);
  return out.reverse();
}

/** Cost of following an explicit edge list after `from` (exclusive), or Infinity if invalid. */
export function routeCost(
  graph: RoadGraph,
  costs: CostModel,
  from: GraphEdge | null,
  edges: readonly string[],
): number {
  let total = 0;
  let prevEdge = from;
  for (const id of edges) {
    const e = graph.edge(id);
    if (!e) return Infinity;
    if (prevEdge) {
      if (!graph.movementAllowed(prevEdge, e)) return Infinity;
      total += costs.movementCost(prevEdge, e);
    }
    total += costs.edgeCost(e);
    prevEdge = e;
  }
  return total;
}

/** Checks that a route is still drivable on the current graph and, if given, ends at `destination`. */
export function routeValid(
  graph: RoadGraph,
  edges: readonly string[],
  fromIndex: number,
  destination?: number,
): boolean {
  if (destination !== undefined) {
    const last = graph.edge(edges[edges.length - 1] ?? '');
    if (!last || last.to !== destination) return false;
  }
  for (let k = fromIndex; k < edges.length; k++) {
    const e = graph.edge(edges[k] as string);
    if (!e || !e.open) return false;
    if (k > fromIndex) {
      const p = graph.edge(edges[k - 1] as string) as GraphEdge;
      if (!graph.movementAllowed(p, e)) return false;
    }
  }
  return true;
}

export function turnCost(from: GraphEdge, to: GraphEdge): number {
  const turn = turnBetween(from.lastDir, to.firstDir);
  return (
    ROUTING.junctionBaseCost +
    (turn === 'straight' ? 0 : turn === 'uturn' ? 3 * ROUTING.turnCost : ROUTING.turnCost)
  );
}

interface CacheEntry {
  route: Route | null;
  time: number;
}

/**
 * Route cache. Entries expire after `ROUTING.cacheTtl` seconds so routes
 * follow congestion, and are invalidated selectively when the graph changes:
 * only entries that use a changed edge (or found no route) are dropped.
 */
export class RouteCache {
  private entries = new Map<string, CacheEntry>();
  hits = 0;
  misses = 0;

  get(key: string, time: number): Route | null | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (time - entry.time > ROUTING.cacheTtl) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.route;
  }

  private writes = 0;

  set(key: string, route: Route | null, time: number): void {
    this.entries.set(key, { route, time });
    // Periodically drop expired entries so long sessions do not accumulate stale routes.
    if (++this.writes % 512 === 0) {
      for (const [k, e] of this.entries) if (time - e.time > ROUTING.cacheTtl) this.entries.delete(k);
    }
  }

  invalidate(changedEdges: ReadonlySet<string>): number {
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (
        !entry.route ||
        entry.route.edges.some((id) => changedEdges.has(id)) ||
        keyUses(key, changedEdges)
      ) {
        this.entries.delete(key);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

function keyUses(key: string, changed: ReadonlySet<string>): boolean {
  if (!key.startsWith('e')) return false;
  const sep = key.indexOf('|');
  return changed.has(key.slice(1, sep));
}
