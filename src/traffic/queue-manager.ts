import { IDM, ROUTING, STATS } from '../core/constants';
import type { GraphEdge, RoadGraph } from '../map/road-graph';
import { type LaneManager, laneKey } from './lane-manager';

export interface QueueSnapshot {
  /** Longest current queue in vehicles. */
  longestQueue: number;
  /** Mean queue length (vehicles) over lanes with a queue. */
  averageQueue: number;
  queuedVehicles: number;
  /** Vehicles per kilometre of lane. */
  density: number;
  /** Occupied share of total lane storage (0..1). */
  utilization: number;
}

/**
 * Per-edge traffic measurements computed from the actual lane contents
 * every step. They feed both the statistics and the congestion-aware
 * routing costs.
 */
export class QueueManager {
  count = new Float64Array(0);
  queued = new Float64Array(0);
  occupied = new Float64Array(0);
  /** Longest queue per edge (vehicles, over its lanes). */
  edgeQueue = new Float64Array(0);
  /** Smoothed waiting time at the end of each edge, keyed by stable edge id. */
  readonly junctionDelay = new Map<string, number>();
  snapshot: QueueSnapshot = {
    longestQueue: 0,
    averageQueue: 0,
    queuedVehicles: 0,
    density: 0,
    utilization: 0,
  };
  private totalLaneLength = 0;

  resize(graph: RoadGraph): void {
    const n = graph.edgeList.length;
    this.count = new Float64Array(n);
    this.queued = new Float64Array(n);
    this.occupied = new Float64Array(n);
    this.edgeQueue = new Float64Array(n);
    this.totalLaneLength = 0;
    for (const e of graph.edgeList) this.totalLaneLength += Math.max(e.length, 1) * e.lanes;
    for (const id of [...this.junctionDelay.keys()]) if (!graph.edges.has(id)) this.junctionDelay.delete(id);
  }

  update(graph: RoadGraph, lanes: LaneManager): void {
    this.count.fill(0);
    this.queued.fill(0);
    this.occupied.fill(0);
    this.edgeQueue.fill(0);
    let longest = 0;
    let queueSum = 0;
    let queueLanes = 0;
    let queuedVehicles = 0;
    let vehicles = 0;
    let occupiedTotal = 0;
    for (const edge of graph.edgeList) {
      for (let lane = 0; lane < edge.lanes; lane++) {
        const list = lanes.get(laneKey(edge.index, lane));
        if (list.length === 0) continue;
        // A queue is the contiguous run of slow vehicles starting at the stop line.
        let q = 0;
        for (const v of list) {
          if (v.v < STATS.queueSpeed) q++;
          else break;
        }
        for (const v of list) {
          if (v.laneChange && v.laneChange.to === lane) continue; // counted in its source lane
          this.count[edge.index] = (this.count[edge.index] as number) + 1;
          this.occupied[edge.index] = (this.occupied[edge.index] as number) + v.length + IDM.minGap;
          if (v.v < STATS.queueSpeed) {
            this.queued[edge.index] = (this.queued[edge.index] as number) + 1;
            queuedVehicles++;
          }
          vehicles++;
          occupiedTotal += v.length + IDM.minGap;
        }
        if (q > 0) {
          queueSum += q;
          queueLanes++;
          if (q > longest) longest = q;
          if (q > (this.edgeQueue[edge.index] as number)) this.edgeQueue[edge.index] = q;
        }
      }
    }
    const laneKm = this.totalLaneLength / 1000;
    this.snapshot = {
      longestQueue: longest,
      averageQueue: queueLanes > 0 ? queueSum / queueLanes : 0,
      queuedVehicles,
      density: laneKm > 0 ? vehicles / laneKm : 0,
      utilization: this.totalLaneLength > 0 ? Math.min(1, occupiedTotal / this.totalLaneLength) : 0,
    };
  }

  /** Occupancy of an edge relative to its storage capacity (0..∞). */
  occupancy(edge: GraphEdge): number {
    const storage = Math.max(edge.length, 4) * edge.lanes;
    return (this.occupied[edge.index] ?? 0) / storage;
  }

  recordJunctionDelay(edgeId: string, delay: number): void {
    const prev = this.junctionDelay.get(edgeId) ?? 0;
    const a = ROUTING.junctionDelaySmoothing;
    this.junctionDelay.set(edgeId, prev + a * (delay - prev));
  }

  delay(edgeId: string): number {
    return this.junctionDelay.get(edgeId) ?? 0;
  }

  reset(): void {
    this.junctionDelay.clear();
  }
}

export interface GridlockInfo {
  /** Junction nodes that are part of a waiting cycle. */
  nodes: number[];
  vehicles: number;
}

/**
 * Detects gridlock: a cycle of lanes in which the front vehicle of each
 * lane has been standing at the stop line waiting for space on the next
 * lane of the cycle. Such a cycle cannot resolve on its own.
 */
export function detectGridlock(
  waitingFor: ReadonlyMap<number, { target: number; node: number }>,
): GridlockInfo[] {
  const result: GridlockInfo[] = [];
  const state = new Map<number, number>(); // 1 = visiting, 2 = done
  for (const start of waitingFor.keys()) {
    if (state.has(start)) continue;
    const path: number[] = [];
    let cur: number | undefined = start;
    while (cur !== undefined && !state.has(cur)) {
      state.set(cur, 1);
      path.push(cur);
      cur = waitingFor.get(cur)?.target;
    }
    if (cur !== undefined && state.get(cur) === 1) {
      const cycle = path.slice(path.indexOf(cur));
      const nodes = [...new Set(cycle.map((k) => (waitingFor.get(k) as { node: number }).node))];
      result.push({ nodes, vehicles: cycle.length });
    }
    for (const k of path) state.set(k, 2);
  }
  return result;
}
