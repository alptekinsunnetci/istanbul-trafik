import type { RoadGraph } from '../map/road-graph';
import type { Vehicle } from './vehicle-model';

/** Max lanes per direction supported by lane keys. */
const LANE_SLOTS = 4;

export function laneKey(edgeIndex: number, lane: number): number {
  return edgeIndex * LANE_SLOTS + lane;
}

/**
 * Per-lane ordering of vehicles (front first). Vehicles that are changing
 * lanes occupy both lanes until the manoeuvre is complete.
 */
export class LaneManager {
  private lanes = new Map<number, Vehicle[]>();
  private pool: Vehicle[][] = [];

  rebuild(graph: RoadGraph, vehicles: readonly Vehicle[]): void {
    for (const list of this.lanes.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.lanes.clear();
    for (const v of vehicles) {
      if (v.junction) continue;
      const edge = graph.edge(v.edge);
      if (!edge) continue;
      this.push(laneKey(edge.index, v.lane), v);
      if (v.laneChange) this.push(laneKey(edge.index, v.laneChange.to), v);
    }
    for (const list of this.lanes.values()) list.sort(byPositionDesc);
  }

  private push(key: number, v: Vehicle): void {
    let list = this.lanes.get(key);
    if (!list) {
      list = this.pool.pop() ?? [];
      this.lanes.set(key, list);
    }
    list.push(v);
  }

  get(key: number): readonly Vehicle[] {
    return this.lanes.get(key) ?? EMPTY;
  }

  /** Inserts a vehicle into a lane keeping the ordering (used when a lane change starts). */
  insert(key: number, v: Vehicle): void {
    let list = this.lanes.get(key);
    if (!list) {
      list = this.pool.pop() ?? [];
      this.lanes.set(key, list);
    }
    let i = 0;
    while (i < list.length && byPositionDesc(list[i] as Vehicle, v) <= 0) i++;
    list.splice(i, 0, v);
  }

  /** Nearest vehicle ahead of position s in the lane (excluding `self`). */
  leader(key: number, s: number, self: Vehicle): Vehicle | null {
    const list = this.lanes.get(key);
    if (!list) return null;
    let best: Vehicle | null = null;
    for (const o of list) {
      if (o === self) continue;
      if (o.s > s || (o.s === s && o.id < self.id)) best = o;
      else break;
    }
    return best;
  }

  /** Nearest vehicle behind position s in the lane (excluding `self`). */
  follower(key: number, s: number, self: Vehicle): Vehicle | null {
    const list = this.lanes.get(key);
    if (!list) return null;
    for (const o of list) {
      if (o === self) continue;
      if (o.s < s || (o.s === s && o.id > self.id)) return o;
    }
    return null;
  }

  /** Rearmost vehicle of the lane. */
  last(key: number): Vehicle | null {
    const list = this.lanes.get(key);
    if (!list || list.length === 0) return null;
    return list[list.length - 1] as Vehicle;
  }

  /** Front vehicle of the lane. */
  first(key: number): Vehicle | null {
    const list = this.lanes.get(key);
    if (!list || list.length === 0) return null;
    return list[0] as Vehicle;
  }

  entries(): IterableIterator<[number, Vehicle[]]> {
    return this.lanes.entries();
  }
}

const EMPTY: readonly Vehicle[] = [];

function byPositionDesc(a: Vehicle, b: Vehicle): number {
  return b.s - a.s || a.id - b.id;
}
