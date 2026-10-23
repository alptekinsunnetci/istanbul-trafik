import { GEOM, ROAD } from '../core/constants';
import { DIRS, type Dir, type Grid, opposite } from './grid';
import { type GraphEdge, type GraphNode, RoadGraph } from './road-graph';

/**
 * Derives the directed road graph from the grid. Nodes are created at every
 * cell where the road is not a simple pass-through: junctions, dead ends,
 * building doors, lane-count changes and direction-pattern changes. Every
 * maximal chain between two nodes becomes up to two directed edges.
 */
export function buildGraph(grid: Grid): RoadGraph {
  const graph = new RoadGraph(ROAD.boulevardSpeed);
  const nodeSet = new Set<number>();
  for (let i = 0; i < grid.size; i++) {
    if (grid.isRoad(i) && isNodeCell(grid, i)) nodeSet.add(i);
  }

  const visited = new Uint8Array(grid.size);
  const walkFrom = (n: number): void => {
    visited[n] = 1;
    for (const d of DIRS) {
      if (!grid.connected(n, d)) continue;
      const chain = walkChain(grid, nodeSet, n, d);
      for (const c of chain.cells) visited[c] = 1;
      if (chain.forward) addEdge(grid, graph, chain.cells, chain.dirs);
    }
  };

  for (const n of nodeSet) walkFrom(n);
  // Closed loops without any node: promote one cell to a node and walk again.
  for (let i = 0; i < grid.size; i++) {
    if (grid.isRoad(i) && visited[i] === 0) {
      nodeSet.add(i);
      walkFrom(i);
    }
  }

  for (const n of nodeSet) {
    if (!graph.nodes.has(n)) graph.nodes.set(n, makeNode(grid, n));
  }
  for (const edge of graph.edgeList) {
    const twinId = `${edge.to}>${opposite(edge.lastDir)}`;
    const twin = graph.edges.get(twinId);
    if (twin && twin.to === edge.from) edge.twin = twinId;
  }
  for (const edge of graph.edgeList) {
    edge.signature = `${edge.to}|${edge.cells.length}|${edge.lanes}|${edge.twin === null ? 1 : 2}`;
    ensureNode(grid, graph, edge.from).outEdges.push(edge.id);
    ensureNode(grid, graph, edge.to).inEdges.push(edge.id);
  }
  return graph;
}

function ensureNode(grid: Grid, graph: RoadGraph, id: number): GraphNode {
  let node = graph.nodes.get(id);
  if (!node) {
    node = makeNode(grid, id);
    graph.nodes.set(id, node);
  }
  return node;
}

function makeNode(grid: Grid, i: number): GraphNode {
  const x = grid.cx(i);
  const y = grid.cy(i);
  return {
    id: i,
    x,
    y,
    cx: (x + 0.5) * GEOM.cellSize,
    cy: (y + 0.5) * GEOM.cellSize,
    inEdges: [],
    outEdges: [],
    degree: grid.degree(i),
    door: grid.locked[i] === 1 ? doorBuilding(grid, i) : -1,
  };
}

function doorBuilding(grid: Grid, i: number): number {
  for (const d of DIRS) {
    const n = grid.neighbor(i, d);
    if (n >= 0 && (grid.building[n] as number) >= 0) return grid.building[n] as number;
  }
  return -1;
}

export function isNodeCell(grid: Grid, i: number): boolean {
  if (grid.locked[i] === 1) return true;
  const connected = DIRS.filter((d) => grid.connected(i, d));
  if (connected.length !== 2) return true;
  const [d1, d2] = connected as [Dir, Dir];
  const p = grid.neighbor(i, d1);
  const q = grid.neighbor(i, d2);
  if (grid.lanes[p] !== grid.lanes[i] || grid.lanes[q] !== grid.lanes[i]) return true;
  const inP = grid.hasLink(p, opposite(d1));
  const outP = grid.hasLink(i, d1);
  const inQ = grid.hasLink(q, opposite(d2));
  const outQ = grid.hasLink(i, d2);
  return !(inP === outQ && inQ === outP);
}

interface Chain {
  cells: number[];
  dirs: Dir[];
  forward: boolean;
}

function walkChain(grid: Grid, nodes: Set<number>, start: number, firstDir: Dir): Chain {
  const cells = [start];
  const dirs: Dir[] = [firstDir];
  let forward = grid.hasLink(start, firstDir);
  let cur = grid.neighbor(start, firstDir);
  let prevDir = firstDir;
  while (!nodes.has(cur)) {
    cells.push(cur);
    let next: Dir | null = null;
    for (const d of DIRS) {
      if (d !== opposite(prevDir) && grid.connected(cur, d)) {
        next = d;
        break;
      }
    }
    if (next === null) break; // unreachable for well-formed pass-through cells
    if (!grid.hasLink(cur, next)) forward = false;
    dirs.push(next);
    prevDir = next;
    cur = grid.neighbor(cur, next);
    if (cells.length > grid.size) throw new Error('Topoloji: sonsuz zincir');
  }
  cells.push(cur);
  return { cells, dirs, forward };
}

function addEdge(grid: Grid, graph: RoadGraph, cells: number[], dirs: Dir[]): void {
  const from = cells[0] as number;
  const to = cells[cells.length - 1] as number;
  const id = `${from}>${dirs[0] as Dir}`;
  if (graph.edges.has(id)) return;
  const interior = cells.slice(1, -1);
  const lanes =
    interior.length > 0
      ? (grid.lanes[interior[0] as number] as number)
      : Math.min(grid.lanes[from] as number, grid.lanes[to] as number);
  const steps = cells.length - 1;
  const centerLength = steps * GEOM.cellSize;
  const length = centerLength - 2 * GEOM.junctionRadius;
  const speedLimit = lanes >= 2 ? ROAD.boulevardSpeed : ROAD.streetSpeed;
  const edge: GraphEdge = {
    id,
    index: graph.edgeList.length,
    from,
    to,
    cells,
    dirs,
    firstDir: dirs[0] as Dir,
    lastDir: dirs[dirs.length - 1] as Dir,
    lanes: Math.max(1, lanes),
    length,
    centerLength,
    speedLimit,
    freeFlowTime: centerLength / speedLimit,
    twin: null,
    bridge: cells.some((c) => grid.isBridge(c)),
    open: true,
    signature: '',
  };
  graph.edges.set(id, edge);
  graph.edgeList.push(edge);
  for (let k = 0; k < steps; k++) {
    graph.steps.set(RoadGraph.stepKey(cells[k] as number, cells[k + 1] as number), { edge: id, index: k });
  }
}
