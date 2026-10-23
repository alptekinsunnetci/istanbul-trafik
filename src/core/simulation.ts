import { DEMAND, DT, GEOM, MODES, type ModeRules, ROUTING, STATS, TRIP } from './constants';
import { EventBus } from './event-bus';
import { Random } from './random';
import type { Building, TripFailureReason } from './world-state';
import type { Grid } from '../map/grid';
import { type GraphEdge, RoadGraph } from '../map/road-graph';
import { buildGraph } from '../map/topology';
import { DemandGenerator } from '../traffic/demand-generator';
import { JunctionController } from '../traffic/junction-controller';
import { LaneManager, laneKey } from '../traffic/lane-manager';
import { type GridlockInfo, QueueManager } from '../traffic/queue-manager';
import { type CostModel, RouteCache, routeValid, turnCost } from '../traffic/routing';
import type { Vehicle } from '../traffic/vehicle-model';
import { type TrailingHold, type TrafficWorld, VehicleSystem } from '../traffic/vehicle-system';

export interface TripCompletedEvent {
  vehicle: Vehicle;
  travelTime: number;
  freeFlowTime: number;
  onTime: boolean;
}

export interface TripFailedEvent {
  reason: TripFailureReason;
  origin: number;
  destination: number;
  vehicleId: number | null;
}

export interface SimEvents {
  tripCompleted: TripCompletedEvent;
  tripFailed: TripFailedEvent;
  vehicleSpawned: Vehicle;
  gridlock: GridlockInfo[];
  networkChanged: { changedEdges: number; failedVehicles: number };
}

export interface StatSample {
  time: number;
  active: number;
  completed: number;
  failed: number;
  queued: number;
}

export interface SimStats {
  spawned: number;
  completed: number;
  failed: number;
  failedByReason: Record<TripFailureReason, number>;
  onTime: number;
  totalTravelTime: number;
  totalFreeFlowTime: number;
  totalWaitTime: number;
  longestQueueEver: number;
  queueSampleSum: number;
  queueSamples: number;
  history: StatSample[];
}

export function emptyStats(): SimStats {
  return {
    spawned: 0,
    completed: 0,
    failed: 0,
    failedByReason: { noRoute: 0, roadRemoved: 0 },
    onTime: 0,
    totalTravelTime: 0,
    totalFreeFlowTime: 0,
    totalWaitTime: 0,
    longestQueueEver: 0,
    queueSampleSum: 0,
    queueSamples: 0,
    history: [],
  };
}

export interface SimulationOptions {
  seed: number;
  demandMultiplier?: number;
  /** Overflow rules of the chosen mode (defaults to the hardest mode). */
  rules?: Pick<ModeRules, 'overflowPins' | 'overflowTime'>;
}

/**
 * Deterministic traffic simulation. Advances in fixed steps of `DT`; it
 * never reads wall-clock time, so identical seeds, maps and edit sequences
 * yield identical results.
 */
export class Simulation {
  readonly events = new EventBus<SimEvents>();
  readonly grid: Grid;
  buildings: Building[];
  vehicles: Vehicle[] = [];
  graph: RoadGraph;
  readonly lanes = new LaneManager();
  readonly junctions = new JunctionController();
  readonly queues = new QueueManager();
  readonly routes = new RouteCache();
  readonly demand: DemandGenerator;
  readonly rng: Random;
  readonly trailing = new Map<number, TrailingHold>();
  readonly costs: CostModel;
  readonly rules: Pick<ModeRules, 'overflowPins' | 'overflowTime'>;
  readonly system: VehicleSystem;

  time = 0;
  tick = 0;
  nextVehicleId = 1;
  nextTripId = 1;
  demandEnabled = true;
  gridlocks: GridlockInfo[] = [];
  stats: SimStats = emptyStats();
  private sampleTimer = 0;
  private queueSampleTimer = 0;

  constructor(grid: Grid, buildings: Building[], options: SimulationOptions) {
    this.grid = grid;
    this.buildings = buildings;
    this.rng = new Random(options.seed);
    this.demand = new DemandGenerator(options.demandMultiplier ?? 1);
    this.rules = options.rules ?? {
      overflowPins: MODES.zor.overflowPins,
      overflowTime: MODES.zor.overflowTime,
    };
    this.graph = new RoadGraph(0);
    this.costs = {
      edgeCost: (e: GraphEdge) => {
        const q = this.queues;
        const occ = q.occupancy(e);
        return (
          e.freeFlowTime +
          ((q.queued[e.index] ?? 0) / e.lanes) * ROUTING.queueWeight +
          q.delay(e.id) * ROUTING.junctionDelayWeight +
          ROUTING.densityWeight * occ * occ
        );
      },
      movementCost: turnCost,
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const sim = this;
    const world: TrafficWorld = {
      get graph() {
        return sim.graph;
      },
      lanes: this.lanes,
      junctions: this.junctions,
      queues: this.queues,
      costs: this.costs,
      routes: this.routes,
      rng: this.rng,
      get time() {
        return sim.time;
      },
      get vehicles() {
        return sim.vehicles;
      },
      set vehicles(list: Vehicle[]) {
        sim.vehicles = list;
      },
      get buildings() {
        return sim.buildings;
      },
      trailing: this.trailing,
      nextVehicleId: () => this.nextVehicleId++,
      onSpawn: (v) => {
        this.stats.spawned++;
        this.events.emit('vehicleSpawned', v);
      },
      onArrive: (v) => this.handleArrival(v),
      onVehicleFail: (v, reason) => this.handleVehicleFailure(v, reason),
      onGridlock: (info) => {
        const changed = info.length !== this.gridlocks.length;
        this.gridlocks = info;
        if (changed && info.length > 0) this.events.emit('gridlock', info);
      },
    };
    this.system = new VehicleSystem(world);
    this.rebuildNetwork();
  }

  /** Advances the simulation by one fixed step. */
  step(): void {
    this.time += DT;
    this.tick++;
    if (this.demandEnabled) {
      this.demand.update({
        time: this.time,
        dt: DT,
        buildings: this.buildings,
        rng: this.rng,
        nextTripId: () => this.nextTripId++,
        reachable: (house, workplace) => this.reachable(house, workplace),
      });
      this.updateOverflow();
    }
    this.system.step(DT);
    this.sampleStats();
  }

  /** Whether a house currently has a route to a workplace (cached). */
  reachable(house: Building, workplace: Building): boolean {
    const r = this.system.routeFrom({ node: house.door }, workplace.door);
    return r !== null && r.edges.length > 0;
  }

  /** Workplaces with too many pins fill their overflow timer; others drain it. */
  private updateOverflow(): void {
    const pins = new Map<number, number>();
    for (const b of this.buildings) {
      if (b.kind === 'ticari') pins.set(b.id, b.incoming);
    }
    for (const b of this.buildings) {
      for (const t of b.pending) pins.set(t.destination, (pins.get(t.destination) ?? 0) + 1);
    }
    for (const b of this.buildings) {
      if (b.kind !== 'ticari') continue;
      if ((pins.get(b.id) ?? 0) >= this.rules.overflowPins)
        b.overflow = Math.min(1, b.overflow + DT / this.rules.overflowTime);
      else b.overflow = Math.max(0, b.overflow - (DT * DEMAND.overflowRecovery) / this.rules.overflowTime);
    }
  }

  private sampleStats(): void {
    const snap = this.queues.snapshot;
    if (snap.longestQueue > this.stats.longestQueueEver) this.stats.longestQueueEver = snap.longestQueue;
    this.queueSampleTimer += DT;
    if (this.queueSampleTimer >= 1) {
      this.queueSampleTimer = 0;
      this.stats.queueSampleSum += snap.averageQueue;
      this.stats.queueSamples++;
    }
    this.sampleTimer += DT;
    if (this.sampleTimer >= STATS.sampleInterval) {
      this.sampleTimer = 0;
      this.stats.history.push({
        time: this.time,
        active: this.vehicles.length,
        completed: this.stats.completed,
        failed: this.stats.failed,
        queued: snap.queuedVehicles,
      });
      if (this.stats.history.length > STATS.historyLength) this.stats.history.shift();
    }
  }

  private handleArrival(v: Vehicle): void {
    const travel = this.time - v.departTime;
    const free = Math.max(v.freeFlowTime, 1);
    const onTime = travel <= free * TRIP.onTimeFactor + TRIP.onTimeSlack;
    const s = this.stats;
    s.completed++;
    if (onTime) s.onTime++;
    s.totalTravelTime += travel;
    s.totalFreeFlowTime += free;
    s.totalWaitTime += v.waitTime;
    this.events.emit('tripCompleted', { vehicle: v, travelTime: travel, freeFlowTime: free, onTime });
  }

  /**
   * A vehicle that cannot finish its trip is removed, but the trip itself is
   * not lost: it goes back to the house's queue and its pin stays visible.
   */
  private handleVehicleFailure(v: Vehicle, reason: TripFailureReason): void {
    this.stats.failed++;
    this.stats.failedByReason[reason]++;
    const origin = this.buildingById(v.origin);
    if (origin) {
      origin.failed++;
      origin.pending.unshift({
        id: v.tripId,
        origin: v.origin,
        destination: v.destination,
        createdAt: this.time,
      });
    }
    this.events.emit('tripFailed', { reason, origin: v.origin, destination: v.destination, vehicleId: v.id });
  }

  /**
   * Rebuilds the road graph after a grid edit. Vehicles are mapped onto the
   * new edges by the cell step they are on; only vehicles whose road no
   * longer exists fail (and are reported). Route cache entries are
   * invalidated only for changed edges, and routes that became invalid are
   * re-planned.
   */
  rebuildNetwork(): { changedEdges: number; failedVehicles: number } {
    const old = this.graph;
    const next = buildGraph(this.grid);
    const changed = new Set<string>();
    for (const [id, e] of old.edges) {
      const n = next.edges.get(id);
      if (!n || n.signature !== e.signature) changed.add(id);
    }
    const oldTrailing = new Map(this.trailing);
    this.graph = next;
    this.queues.resize(next);
    this.junctions.reset();
    this.trailing.clear();
    this.routes.invalidate(changed);

    let failed = 0;
    for (const v of this.vehicles) {
      const ok = v.junction ? this.remapJunctionVehicle(v, old, next) : this.remapEdgeVehicle(v, old, next);
      if (!ok) {
        v.junction = null;
        v.granted = null;
        this.system.failVehicle(v, 'roadRemoved');
        failed++;
      }
    }
    this.system.flushRemoved();

    for (const v of this.vehicles) {
      v.granted = null;
      if (v.junction) {
        const pass = v.junction;
        const to = next.edge(pass.toEdge) as GraphEdge;
        this.junctions.acquire(
          pass.node,
          pass.zones,
          pass.key,
          laneKey(to.index, pass.toLane),
          pass.reserved,
        );
        continue;
      }
      const hold = oldTrailing.get(v.id);
      const edge = next.edge(v.edge);
      if (hold && edge && edge.from === hold.node && v.s < v.length && next.nodes.has(hold.node)) {
        const lane = Math.min(hold.exitLane, edge.lanes - 1);
        this.trailing.set(v.id, { ...hold, exitEdge: edge.id, exitLane: lane });
        this.junctions.acquire(hold.node, hold.zones, hold.key, laneKey(edge.index, lane), hold.need);
      }
    }

    for (const v of this.vehicles) {
      const dest = this.buildingById(v.destination)?.door ?? -1;
      if (v.junction) {
        if (!routeValid(next, v.route, v.routeIndex + 1, dest)) this.replanAfterJunction(v);
      } else if (v.state === 'noRoute' || !routeValid(next, v.route, v.routeIndex, dest)) {
        this.system.replan(v);
      }
    }
    const result = { changedEdges: changed.size, failedVehicles: failed };
    if (old.edges.size > 0 || next.edges.size > 0) this.events.emit('networkChanged', result);
    return result;
  }

  private remapEdgeVehicle(v: Vehicle, old: RoadGraph, next: RoadGraph): boolean {
    const oldEdge = old.edge(v.edge);
    if (!oldEdge) return false;
    const same = next.edge(v.edge);
    if (same && same.signature === oldEdge.signature) {
      if (v.lane >= same.lanes) v.lane = same.lanes - 1;
      return true;
    }
    const C = GEOM.cellSize;
    const R = GEOM.junctionRadius;
    const steps = oldEdge.cells.length - 1;
    const u = v.s + R;
    const k = Math.min(Math.max(Math.floor(u / C), 0), steps - 1);
    const f = u - k * C;
    const ref = next.steps.get(RoadGraph.stepKey(oldEdge.cells[k] as number, oldEdge.cells[k + 1] as number));
    if (!ref) return false;
    const ne = next.edge(ref.edge) as GraphEdge;
    v.edge = ne.id;
    v.s = Math.min(Math.max(ref.index * C + f - R, 0), ne.length);
    v.lane = Math.min(v.lane, ne.lanes - 1);
    if (v.laneChange && v.laneChange.to >= ne.lanes) v.laneChange = null;
    v.route = [ne.id, ...v.route.slice(v.routeIndex + 1)];
    v.routeIndex = 0;
    return true;
  }

  private remapJunctionVehicle(v: Vehicle, old: RoadGraph, next: RoadGraph): boolean {
    const pass = v.junction;
    if (!pass) return false;
    const oldTo = old.edge(pass.toEdge);
    if (!oldTo || !next.nodes.has(pass.node)) return false;
    const ref = next.steps.get(RoadGraph.stepKey(oldTo.cells[0] as number, oldTo.cells[1] as number));
    if (!ref) return false;
    const ne = next.edge(ref.edge) as GraphEdge;
    const tail = v.route.slice(v.routeIndex + 2);
    if (ref.index === 0 && ne.from === pass.node) {
      pass.toEdge = ne.id;
      pass.toLane = Math.min(pass.toLane, ne.lanes - 1);
      v.route = [pass.fromEdge, ne.id, ...tail];
      v.routeIndex = 0;
      return true;
    }
    // The node became a plain road cell: continue on the edge through it.
    v.junction = null;
    v.edge = ne.id;
    v.s = Math.min(Math.max(ref.index * GEOM.cellSize - GEOM.junctionRadius, 0), ne.length);
    v.lane = Math.min(pass.toLane, ne.lanes - 1);
    v.route = [ne.id, ...tail];
    v.routeIndex = 0;
    return true;
  }

  private replanAfterJunction(v: Vehicle): void {
    const pass = v.junction;
    if (!pass) return;
    const to = this.graph.edge(pass.toEdge);
    const dest = this.buildings.find((b) => b.id === v.destination);
    if (!to || !dest) return;
    const r = to.to === dest.door ? { edges: [] } : this.system.routeFrom({ edge: to }, dest.door);
    v.route = r ? [pass.fromEdge, to.id, ...r.edges] : [pass.fromEdge, to.id];
    v.routeIndex = 0;
  }

  vehicleById(id: number): Vehicle | undefined {
    return this.vehicles.find((v) => v.id === id);
  }

  buildingById(id: number): Building | undefined {
    return this.buildings.find((b) => b.id === id);
  }

  totalPending(): number {
    let n = 0;
    for (const b of this.buildings) n += b.pending.length;
    return n;
  }

  /** Compact fingerprint of the dynamic state, used by determinism tests. */
  stateHash(): string {
    let h = `${this.tick}|${this.stats.completed}|${this.stats.failed}|${this.vehicles.length}`;
    for (const v of this.vehicles) h += `|${v.id}:${v.edge}:${v.lane}:${v.s.toFixed(4)}:${v.v.toFixed(4)}`;
    return h;
  }
}
