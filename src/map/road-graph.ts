import { GEOM } from '../core/constants';
import type { Dir } from './grid';

export interface GraphNode {
  /** Cell index of the node; also its id. */
  id: number;
  x: number;
  y: number;
  /** Centre in metres. */
  cx: number;
  cy: number;
  inEdges: string[];
  outEdges: string[];
  /** Number of undirected road connections. */
  degree: number;
  /** Building whose door is at this node, or -1. */
  door: number;
}

/** A directed, homogeneous stretch of road between two nodes. */
export interface GraphEdge {
  /** Stable id "<fromCell>><firstDir>", unchanged while the chain is unchanged. */
  id: string;
  /** Dense numeric index used for per-edge arrays; not stable across rebuilds. */
  index: number;
  from: number;
  to: number;
  /** Cells from the start node to the end node, inclusive. */
  cells: number[];
  /** Direction of each step; dirs[k] leads from cells[k] to cells[k+1]. */
  dirs: Dir[];
  firstDir: Dir;
  lastDir: Dir;
  lanes: number;
  /** Drivable length between the two junction boxes. */
  length: number;
  /** Node-centre to node-centre length (diagonals count with their real, shorter length). */
  centerLength: number;
  /** Distance along the centre line of every cell of `cells`, from the start node. */
  stepPos: number[];
  speedLimit: number;
  freeFlowTime: number;
  twin: string | null;
  bridge: boolean;
  open: boolean;
  /** Changes whenever geometry or capacity of the edge changes. */
  signature: string;
}

export type Turn = 'straight' | 'right' | 'left' | 'uturn';

export interface StepRef {
  edge: string;
  index: number;
}

export class RoadGraph {
  readonly nodes = new Map<number, GraphNode>();
  readonly edges = new Map<string, GraphEdge>();
  /** All edges ordered by `index`. */
  readonly edgeList: GraphEdge[] = [];
  /** Maps a directed cell step a→b to the edge containing it. */
  readonly steps = new Map<number, StepRef>();
  readonly maxSpeed: number;

  constructor(maxSpeed: number) {
    this.maxSpeed = maxSpeed;
  }

  static stepKey(a: number, b: number): number {
    return a * 65536 + b;
  }

  edge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  node(id: number): GraphNode | undefined {
    return this.nodes.get(id);
  }

  /** Whether a vehicle on `inEdge` may continue onto `outEdge`. */
  movementAllowed(inEdge: GraphEdge, outEdge: GraphEdge): boolean {
    if (inEdge.to !== outEdge.from || !outEdge.open) return false;
    if (inEdge.twin === outEdge.id) {
      // U-turns only where there is no other way to continue (dead ends).
      const node = this.nodes.get(inEdge.to);
      return node !== undefined && node.outEdges.length === 1;
    }
    return true;
  }

  successors(inEdge: GraphEdge): GraphEdge[] {
    const node = this.nodes.get(inEdge.to);
    if (!node) return [];
    const result: GraphEdge[] = [];
    for (const id of node.outEdges) {
      const e = this.edges.get(id);
      if (e && this.movementAllowed(inEdge, e)) result.push(e);
    }
    return result;
  }

  distance(a: number, b: number): number {
    const na = this.nodes.get(a);
    const nb = this.nodes.get(b);
    if (!na || !nb) return Infinity;
    return Math.hypot(na.cx - nb.cx, na.cy - nb.cy);
  }
}

export function turnBetween(inDir: Dir, outDir: Dir): Turn {
  switch ((outDir - inDir + 4) % 4) {
    case 0:
      return 'straight';
    case 1:
      return 'right';
    case 2:
      return 'uturn';
    default:
      return 'left';
  }
}

/**
 * Lateral offset of a lane centre to the right of the travel direction.
 * Lane 0 is the rightmost (kerb) lane. Two-way roads keep traffic on the
 * right half; one-way roads are centred.
 */
export function laneOffset(edge: Pick<GraphEdge, 'lanes' | 'twin'>, lane: number): number {
  if (edge.twin !== null) return (edge.lanes - 0.5 - lane) * GEOM.laneWidth;
  return ((edge.lanes - 1) / 2 - lane) * GEOM.laneWidth;
}

/** Lanes from which a turn may be started on an edge with `lanes` lanes. */
export function lanesForTurn(lanes: number, turn: Turn): number[] {
  if (lanes <= 1) return [0];
  if (turn === 'right') return [0];
  if (turn === 'left' || turn === 'uturn') return [lanes - 1];
  return Array.from({ length: lanes }, (_, i) => i);
}

export function exitLaneFor(turn: Turn, currentLane: number, outLanes: number): number {
  if (turn === 'right') return 0;
  if (turn === 'left' || turn === 'uturn') return outLanes - 1;
  return Math.min(currentLane, outLanes - 1);
}
