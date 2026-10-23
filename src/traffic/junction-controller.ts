import { DT, JUNCTION, SIGNAL } from '../core/constants';
import type { Dir } from '../map/grid';
import type { Turn } from '../map/road-graph';
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
  /** Direction of travel when entering the junction (unset for spawns). */
  inDir?: Dir;
  turn?: Turn;
}

/** 0: north–south traffic, 1: east–west traffic. */
export type SignalAxis = 0 | 1;

export interface SignalState {
  /** Direction that has (or last had) green. */
  axis: SignalAxis;
  /** `left`: protected phase for turning left (and right) on `axis`; `clear`: all red. */
  phase: 'green' | 'left' | 'clear';
  /** What follows the current all-red phase. */
  after: 'left' | 'switch';
  /** Seconds in the current phase. */
  t: number;
}

export function axisOf(dir: Dir): SignalAxis {
  return dir === 0 || dir === 2 ? 0 : 1;
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
  /** Junctions with a traffic light and their current phase. */
  private signals = new Map<number, SignalState>();

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

  /** Sets the junctions that have traffic lights; lights that stay keep their phase. */
  setSignals(nodes: Iterable<number>): void {
    const next = new Map<number, SignalState>();
    for (const n of nodes)
      next.set(n, this.signals.get(n) ?? { axis: 0, phase: 'green', after: 'switch', t: 0 });
    this.signals = next;
  }

  signal(node: number): SignalState | undefined {
    return this.signals.get(node);
  }

  get signalCount(): number {
    return this.signals.size;
  }

  /** Whether a light lets this request enter now. */
  private allowed(req: JunctionRequest): boolean {
    const st = this.signals.get(req.node);
    if (!st) return true;
    if (st.phase === 'clear') return false;
    if (req.inDir === undefined) return st.phase === 'green';
    if (axisOf(req.inDir) !== st.axis) return false;
    // In the protected phase only turning cars go; straight traffic waits.
    return st.phase === 'green' || req.turn !== 'straight';
  }

  /** Advances every light by one step, using the requests waiting at it as detectors. */
  private advanceSignals(requests: readonly JunctionRequest[], dt: number): void {
    if (this.signals.size === 0) return;
    // Per junction and axis: [all waiting, waiting to turn left].
    const demand = new Map<number, [[number, number], [number, number]]>();
    for (const r of requests) {
      if (r.inDir === undefined || !this.signals.has(r.node)) continue;
      const d = demand.get(r.node) ?? [
        [0, 0],
        [0, 0],
      ];
      const a = d[axisOf(r.inDir)];
      a[0]++;
      if (r.turn === 'left') a[1]++;
      demand.set(r.node, d);
    }
    for (const [node, st] of this.signals) {
      st.t += dt;
      const d = demand.get(node) ?? [
        [0, 0],
        [0, 0],
      ];
      const own = d[st.axis];
      const other = (1 - st.axis) as SignalAxis;
      const waitingOther = d[other][0] > 0;
      if (st.phase === 'green') {
        const ownLeft = own[1] > 0;
        const ownStraight = own[0] - own[1];
        const someoneElse = waitingOther || ownLeft;
        if (someoneElse && (st.t >= SIGNAL.maxGreen || (st.t >= SIGNAL.minGreen && ownStraight === 0))) {
          // Cars still waiting to turn left get their own protected phase next.
          st.after = ownLeft ? 'left' : 'switch';
          st.phase = 'clear';
          st.t = 0;
        }
      } else if (st.phase === 'left') {
        if (st.t >= SIGNAL.maxLeft || (st.t >= SIGNAL.minLeft && own[1] === 0)) {
          st.after = 'switch';
          st.phase = 'clear';
          st.t = 0;
        }
      } else if (st.t >= SIGNAL.clearance && !this.isBusy(node)) {
        if (st.after === 'left') st.phase = 'left';
        else {
          st.axis = other;
          st.phase = 'green';
        }
        st.t = 0;
      }
    }
  }

  /** Resolves all requests of a step and returns the granted ones. */
  resolve(requests: JunctionRequest[], dt: number = DT): JunctionRequest[] {
    this.advanceSignals(requests, dt);
    if (requests.length === 0) return [];
    const granted: JunctionRequest[] = [];
    const blocked = new Set<number>();
    const instantSpace = new Map<number, number>();
    for (const req of this.policy.order(requests)) {
      // Red light: wait at the stop line (and do not block anyone else).
      if (!this.allowed(req)) continue;
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
