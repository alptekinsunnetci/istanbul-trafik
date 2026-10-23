import { JUNCTION } from '../core/constants';
import { ZONE_COUNT } from './conflict-zones';

export interface JunctionRequest {
  /** Vehicle id, or a negative id for a vehicle about to be spawned. */
  id: number;
  node: number;
  zones: readonly number[];
  /**
   * Identifies the movement (approach lane → exit lane). Vehicles of the
   * same movement follow each other through the box and may share zones.
   */
  key: string;
  exitLaneKey: number;
  /** Free length needed at the start of the exit lane. */
  need: number;
  /** Free length currently available at the start of the exit lane (before reservations). */
  available: number;
  /** Seconds waited; higher waits are served first. */
  wait: number;
  /** Instant movements (spawns) do not keep the zones after the grant. */
  instant: boolean;
}

/**
 * Pluggable ordering of requests. The default serves the longest wait first;
 * signal-based or priority-road policies can replace it later.
 */
export interface JunctionPolicy {
  order(requests: JunctionRequest[]): JunctionRequest[];
}

export const longestWaitFirst: JunctionPolicy = {
  order(requests) {
    return [...requests].sort((a, b) => b.wait - a.wait || a.id - b.id);
  },
};

interface ZoneHold {
  key: string;
  count: number;
}

/**
 * Reservation-based junction control. Requests of one simulation step are
 * resolved together and atomically: a request is granted only when all of
 * its conflict zones are free (or held by the same movement, i.e. a platoon
 * of vehicles following each other along the same path) and the exit lane
 * has room for the vehicle. Zones are held until the vehicle has cleared the
 * box, so conflicting movements never overlap, and no vehicle can stop inside
 * a junction because its exit is blocked.
 */
export class JunctionController {
  private held = new Map<number, (ZoneHold | null)[]>();
  private reserved = new Map<number, number>();
  private policy: JunctionPolicy;

  constructor(policy: JunctionPolicy = longestWaitFirst) {
    this.policy = policy;
  }

  reset(): void {
    this.held.clear();
    this.reserved.clear();
  }

  /** Movement key holding a zone, or null. */
  holder(node: number, zone: number): string | null {
    return this.held.get(node)?.[zone]?.key ?? null;
  }

  isBusy(node: number): boolean {
    const h = this.held.get(node);
    return h !== undefined && h.some((x) => x !== null);
  }

  reservedOn(laneKey: number): number {
    return this.reserved.get(laneKey) ?? 0;
  }

  /** Resolves all requests of a step and returns the granted ones. */
  resolve(requests: JunctionRequest[]): JunctionRequest[] {
    if (requests.length === 0) return [];
    const granted: JunctionRequest[] = [];
    const blocked = new Set<number>();
    const instantSpace = new Map<number, number>();
    for (const req of this.policy.order(requests)) {
      const zonesFree = req.zones.every((z) => {
        if (blocked.has(req.node * ZONE_COUNT + z)) return false;
        const h = this.holder(req.node, z);
        return h === null || (!req.instant && h === req.key);
      });
      const free =
        req.available - this.reservedOn(req.exitLaneKey) - (instantSpace.get(req.exitLaneKey) ?? 0);
      const spaceOk = free >= req.need;
      if (zonesFree && spaceOk) {
        granted.push(req);
        if (req.instant) {
          instantSpace.set(req.exitLaneKey, (instantSpace.get(req.exitLaneKey) ?? 0) + req.need);
          // An instant movement still uses the box during this step.
          for (const z of req.zones) blocked.add(req.node * ZONE_COUNT + z);
        } else {
          this.acquire(req.node, req.zones, req.key, req.exitLaneKey, req.need);
        }
      } else if (spaceOk && req.wait >= JUNCTION.starvationTime) {
        // Fairness: a long-waiting request blocks its zones for everyone with lower
        // priority, which also ends a platoon that would otherwise keep the box.
        for (const z of req.zones) blocked.add(req.node * ZONE_COUNT + z);
      }
    }
    return granted;
  }

  /** Takes (or joins) the zones of a movement; also used to restore holds after rebuilds. */
  acquire(node: number, zones: readonly number[], key: string, exitLaneKey: number, need: number): void {
    let h = this.held.get(node);
    if (!h) {
      h = [null, null, null, null];
      this.held.set(node, h);
    }
    for (const z of zones) {
      const cur = h[z];
      if (cur && cur.key === key) cur.count++;
      else h[z] = { key, count: 1 };
    }
    this.reserved.set(exitLaneKey, this.reservedOn(exitLaneKey) + need);
  }

  release(node: number, zones: readonly number[], key: string, exitLaneKey: number, need: number): void {
    const h = this.held.get(node);
    if (h) {
      for (const z of zones) {
        const cur = h[z];
        if (cur && cur.key === key && --cur.count <= 0) h[z] = null;
      }
      if (h.every((x) => x === null)) this.held.delete(node);
    }
    const left = this.reservedOn(exitLaneKey) - need;
    if (left > 1e-6) this.reserved.set(exitLaneKey, left);
    else this.reserved.delete(exitLaneKey);
  }

  /** Number of nodes with at least one held zone. */
  busyNodeCount(): number {
    return this.held.size;
  }
}
