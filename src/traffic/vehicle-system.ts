import {
  DEMAND,
  IDM,
  JUNCTION,
  LANE_CHANGE,
  ROAD,
  ROUTING,
  STATS,
  VEHICLE_TYPES,
  type VehicleKind,
  ROUNDABOUT,
} from '../core/constants';
import type { Random } from '../core/random';
import { type Building, type TripFailureReason, doorsOf, isHighwayTrip } from '../core/world-state';
import { curveLength, junctionCurve } from '../map/geometry';
import type { Grid } from '../map/grid';
import {
  type GraphEdge,
  type RoadGraph,
  type Turn,
  exitLaneFor,
  laneOffset,
  lanesForTurn,
  turnBetween,
} from '../map/road-graph';
import { idmAcceleration, integrate, stopLineGap } from './car-following';
import { ALL_ZONES, zonesFor } from './conflict-zones';
import type { JunctionController, JunctionRequest } from './junction-controller';
import { chooseLaneChange } from './lane-changing';
import { type LaneManager, laneKey } from './lane-manager';
import { type GridlockInfo, type QueueManager, detectGridlock } from './queue-manager';
import { type CostModel, type Route, type RouteCache, findRoute, freeFlowCosts, routeCost } from './routing';
import { type JunctionPass, type Vehicle, createVehicle } from './vehicle-model';

/** Hold kept on a junction until the rear of a vehicle has left the box. */
export interface TrailingHold {
  vehicle: number;
  node: number;
  key: string;
  zones: number[];
  exitEdge: string;
  exitLane: number;
  need: number;
}

export interface TrafficWorld {
  readonly grid: Grid;
  /** All speed limits are multiplied by this (rain slows traffic down). */
  readonly speedScale: number;
  graph: RoadGraph;
  lanes: LaneManager;
  junctions: JunctionController;
  queues: QueueManager;
  costs: CostModel;
  routes: RouteCache;
  rng: Random;
  time: number;
  vehicles: Vehicle[];
  buildings: Building[];
  trailing: Map<number, TrailingHold>;
  nextVehicleId(): number;
  onSpawn(v: Vehicle): void;
  onArrive(v: Vehicle): void;
  onVehicleFail(v: Vehicle, reason: TripFailureReason): void;
  onGridlock(info: GridlockInfo[]): void;
}

interface Move {
  next: GraphEdge;
  turn: Turn;
}

const KIND_KEYS = Object.keys(VEHICLE_TYPES) as VehicleKind[];
const KIND_WEIGHTS = KIND_KEYS.map((k) => VEHICLE_TYPES[k].weight);
/** Longest vehicle that can be picked at random (buses are only sent on purpose). */
const MAX_LENGTH = Math.max(
  ...KIND_KEYS.filter((k) => VEHICLE_TYPES[k].weight > 0).map((k) => VEHICLE_TYPES[k].length),
);
/** Departure speed when the lane ahead of a door is clear. */
const SPAWN_SPEED = 5;

export function movementKey(fromEdge: string, fromLane: number, toEdge: string, toLane: number): string {
  return `${fromEdge}#${fromLane}>${toEdge}#${toLane}`;
}

/** A vehicle inside a junction together with its pass (kept even if it exits during the step). */
interface Occupant {
  v: Vehicle;
  pass: JunctionPass;
}

function approachKey(edge: string, lane: number): string {
  return `${edge}#${lane}`;
}

export class VehicleSystem {
  private gridlockTimer = 0;
  private removed = new Set<number>();
  private buildingIndex = new Map<number, Building>();
  /** Vehicles inside a junction, rearmost first, by movement key. */
  private byMovement = new Map<string, Occupant[]>();
  /** Rearmost junction vehicle that entered from an approach lane. */
  private byApproach = new Map<string, Occupant>();

  constructor(private readonly w: TrafficWorld) {}

  step(dt: number): void {
    const w = this.w;
    this.buildingIndex.clear();
    for (const b of w.buildings) this.buildingIndex.set(b.id, b);
    this.removed.clear();

    w.lanes.rebuild(w.graph, w.vehicles);
    w.queues.update(w.graph, w.lanes);
    this.indexJunctionVehicles();

    this.updateRouting(dt);
    this.flushRemoved();
    const requests = this.collectRequests();
    this.collectSpawnRequests(requests);
    const granted = w.junctions.resolve(requests);
    this.applyGrants(granted);

    this.updateLaneChanges(dt);
    this.computeAccelerations();
    this.integrateAll(dt);

    if (this.removed.size > 0) w.vehicles = w.vehicles.filter((v) => !this.removed.has(v.id));

    this.gridlockTimer += dt;
    if (this.gridlockTimer >= 1) {
      this.gridlockTimer = 0;
      w.onGridlock(this.findGridlocks());
    }
  }

  private indexJunctionVehicles(): void {
    this.byMovement.clear();
    this.byApproach.clear();
    for (const v of this.w.vehicles) {
      const p = v.junction;
      if (!p) continue;
      let list = this.byMovement.get(p.key);
      if (!list) {
        list = [];
        this.byMovement.set(p.key, list);
      }
      list.push({ v, pass: p });
      const ak = approachKey(p.fromEdge, p.fromLane);
      const cur = this.byApproach.get(ak);
      if (!cur || cur.pass.pos > p.pos) this.byApproach.set(ak, { v, pass: p });
    }
    for (const list of this.byMovement.values()) {
      list.sort((a, b) => a.pass.pos - b.pass.pos);
    }
  }

  // ---------------------------------------------------------------- routing

  routeFrom(start: { node: number } | { edge: GraphEdge }, destNode: number): Route | null {
    const w = this.w;
    const key = 'node' in start ? `n${start.node}|${destNode}` : `e${start.edge.id}|${destNode}`;
    const cached = w.routes.get(key, w.time);
    if (cached !== undefined) return cached;
    const route = findRoute(w.graph, w.costs, start, destNode);
    w.routes.set(key, route, w.time);
    return route;
  }

  private destNode(v: Vehicle): number {
    const b = this.buildingIndex.get(v.destination) ?? this.w.buildings.find((x) => x.id === v.destination);
    if (!b) return -1;
    // Keep driving to the chosen entrance while it exists (a car park may be removed).
    if (v.destDoor >= 0 && doorsOf(b, this.w.buildings).includes(v.destDoor)) return v.destDoor;
    return b.door;
  }

  /** The cheapest route from a node to any entrance of a building (its door or a car park). */
  bestRoute(from: number, dest: Building): { door: number; route: Route } | null {
    let best: { door: number; route: Route } | null = null;
    for (const door of doorsOf(dest, this.w.buildings)) {
      const route = this.routeFrom({ node: from }, door);
      if (!route || route.edges.length === 0) continue;
      if (!best || route.cost < best.route.cost) best = { door, route };
    }
    return best;
  }

  private nextMove(v: Vehicle, edge: GraphEdge): Move | null {
    if (v.state === 'noRoute' || v.routeIndex + 1 >= v.route.length) return null;
    const next = this.w.graph.edge(v.route[v.routeIndex + 1] as string);
    if (!next) return null;
    return { next, turn: turnBetween(edge.lastDir, next.firstDir) };
  }

  private updateRouting(dt: number): void {
    const w = this.w;
    for (const v of w.vehicles) {
      if (v.junction || v.granted) continue;
      const edge = w.graph.edge(v.edge);
      if (!edge) continue;
      const dest = this.destNode(v);
      if (v.state === 'noRoute') {
        v.noRouteTimer += dt;
        v.rerouteTimer -= dt;
        if (v.rerouteTimer <= 0) {
          v.rerouteTimer = ROUTING.noRouteRetry;
          const r = edge.to === dest ? { edges: [], cost: 0 } : this.routeFrom({ edge }, dest);
          if (r) {
            v.route = [edge.id, ...r.edges];
            v.routeIndex = 0;
            v.state = 'moving';
            v.noRouteTimer = 0;
            continue;
          }
        }
        if (v.noRouteTimer >= ROUTING.noRouteTimeout) this.failVehicle(v, 'noRoute');
        continue;
      }
      if (v.routeIndex + 1 >= v.route.length) {
        // A finished route that does not end at the destination needs a new plan.
        if (edge.to !== dest) {
          v.state = 'noRoute';
          v.rerouteTimer = 0;
        }
        continue;
      }
      v.rerouteTimer -= dt;
      if (v.rerouteTimer > 0) continue;
      v.rerouteTimer = ROUTING.rerouteInterval;
      const remaining = v.route.slice(v.routeIndex + 1);
      const current = routeCost(w.graph, w.costs, edge, remaining);
      const best = this.routeFrom({ edge }, dest);
      if (!best) continue;
      const gain = current - best.cost;
      if (
        !Number.isFinite(current) ||
        (gain >= ROUTING.rerouteMinGain && best.cost < current * (1 - ROUTING.rerouteImprovement))
      ) {
        v.route = [edge.id, ...best.edges];
        v.routeIndex = 0;
      }
    }
  }

  /** Re-plans the route of a vehicle from the end of its current edge (used after network edits). */
  replan(v: Vehicle): void {
    const edge = this.w.graph.edge(v.edge);
    if (!edge) return;
    const dest = this.destNode(v);
    if (edge.to === dest) {
      v.route = [edge.id];
      v.routeIndex = 0;
      if (v.state === 'noRoute') v.state = 'moving';
      return;
    }
    const r = findRoute(this.w.graph, this.w.costs, { edge }, dest);
    if (r) {
      v.route = [edge.id, ...r.edges];
      v.routeIndex = 0;
      if (v.state === 'noRoute') v.state = 'moving';
    } else {
      v.route = [edge.id];
      v.routeIndex = 0;
      v.state = 'noRoute';
      v.rerouteTimer = ROUTING.noRouteRetry;
    }
  }

  // --------------------------------------------------------------- junctions

  private exitAvailable(next: GraphEdge, lane: number): number {
    const last = this.w.lanes.last(laneKey(next.index, lane));
    return last ? last.s - last.length : next.length;
  }

  /**
   * Directions of travel approaching (or inside) each junction, used for the
   * give-way rule at junctions without lights.
   */
  private approaches(): Map<number, number> {
    const w = this.w;
    const near = new Map<number, number>();
    const mark = (node: number, dir: number): void => {
      near.set(node, (near.get(node) ?? 0) | (1 << dir));
    };
    for (const v of w.vehicles) {
      if (v.junction) {
        mark(v.junction.node, v.junction.inDir);
        continue;
      }
      const edge = w.graph.edge(v.edge);
      if (edge && edge.length - v.s <= JUNCTION.yieldWatch) mark(edge.to, edge.lastDir);
    }
    return near;
  }

  /**
   * True when a car must slow down and give way before entering this
   * junction. Where a street joins a highway, the highway has priority: its
   * cars never yield. A car from the street that turns right merges like on a
   * ramp: it only gives way when a highway car is coming in the lane it joins.
   * Any other movement from the street gives way to all nearby traffic.
   */
  private mustYield(edge: GraphEdge, mv: Move, near: Map<number, number>): boolean {
    const w = this.w;
    const node = edge.to;
    if (w.junctions.signal(node) || w.grid.roundabout[node] === 1) return false;
    const n = w.graph.node(node);
    if (!n || n.degree < 3) return false;
    const grid = w.grid;
    const before = edge.cells[edge.cells.length - 2] as number;
    if (grid.isHighway(node)) {
      if (grid.isHighway(before)) return false;
      const around = near.get(node) ?? 0;
      if (mv.turn === 'right') return (around & (1 << mv.next.firstDir)) !== 0;
      // Crossing or turning left from the side street: wait for a gap in all highway traffic.
      return (around & ~(1 << edge.lastDir)) !== 0;
    }
    const inDir = edge.lastDir;
    const crossing = inDir === 0 || inDir === 2 ? 0b1010 : 0b0101;
    return ((near.get(node) ?? 0) & crossing) !== 0;
  }

  private collectRequests(): JunctionRequest[] {
    const w = this.w;
    const requests: JunctionRequest[] = [];
    const near = this.approaches();
    for (const v of w.vehicles) {
      if (v.junction || v.granted || v.laneChange) continue;
      const edge = w.graph.edge(v.edge);
      if (!edge) continue;
      const mv = this.nextMove(v, edge);
      if (!mv) continue;
      if (w.lanes.leader(laneKey(edge.index, v.lane), v.s, v)) continue;
      const dist = edge.length - v.s;
      // Ask early enough to keep driving if the junction is free: comfortable braking distance plus margin.
      const reach = Math.max(
        JUNCTION.minRequestDistance,
        (v.v * v.v) / (2 * IDM.comfortDecel) + v.v + JUNCTION.requestMargin,
      );
      if (dist > reach) continue;
      // No light and traffic on the crossing road: slow down and look first.
      if (this.mustYield(edge, mv, near) && (dist > JUNCTION.yieldDistance || v.v > JUNCTION.yieldSpeed))
        continue;
      // Roundabout: slow down to enter, but no need to stop.
      if (w.grid.roundabout[edge.to] === 1 && v.v > ROUNDABOUT.entrySpeed) continue;
      // Prefer reaching a suitable lane first; fall back to any lane at the stop line.
      if (!lanesForTurn(edge.lanes, mv.turn).includes(v.lane) && dist > 8) continue;
      const exitLane = exitLaneFor(mv.turn, v.lane, mv.next.lanes);
      requests.push({
        id: v.id,
        node: edge.to,
        zones: zonesFor(edge.lastDir, mv.turn),
        inDir: edge.lastDir,
        turn: mv.turn,
        key: movementKey(edge.id, v.lane, mv.next.id, exitLane),
        exitLaneKey: laneKey(mv.next.index, exitLane),
        need: v.length + IDM.minGap,
        available: this.exitAvailable(mv.next, exitLane),
        wait: v.stopTimer,
        instant: false,
      });
    }
    return requests;
  }

  private collectSpawnRequests(requests: JunctionRequest[]): void {
    const w = this.w;
    if (w.vehicles.length >= DEMAND.maxActiveVehicles) return;
    for (const b of w.buildings) {
      const trip = b.pending[0];
      if (!trip) continue;
      const dest = this.buildingIndex.get(trip.destination);
      if (!dest) continue;
      const route = this.bestRoute(b.door, dest)?.route;
      if (!route || route.edges.length === 0) {
        b.unreachable = true;
        continue;
      }
      b.unreachable = false;
      const first = w.graph.edge(route.edges[0] as string);
      if (!first) continue;
      requests.push({
        id: -(b.id + 1),
        node: b.door,
        zones: ALL_ZONES,
        key: `spawn:${b.id}`,
        exitLaneKey: laneKey(first.index, 0),
        need: (trip.kind ? VEHICLE_TYPES[trip.kind].length : MAX_LENGTH) + IDM.minGap,
        available: this.exitAvailable(first, 0),
        wait: Math.min(3, w.time - trip.createdAt),
        instant: true,
      });
    }
  }

  private applyGrants(granted: JunctionRequest[]): void {
    const w = this.w;
    const byId = new Map<number, Vehicle>();
    for (const v of w.vehicles) byId.set(v.id, v);
    for (const g of granted) {
      if (g.id < 0) {
        this.spawn(-g.id - 1);
        continue;
      }
      const v = byId.get(g.id);
      if (!v) continue;
      const edge = w.graph.edge(v.edge) as GraphEdge;
      const mv = this.nextMove(v, edge) as Move;
      v.granted = this.makePass(v, edge, mv, g.need, g.key);
    }
  }

  private makePass(v: Vehicle, edge: GraphEdge, mv: Move, need: number, key: string): JunctionPass {
    const node = this.w.graph.node(edge.to);
    const toLane = exitLaneFor(mv.turn, v.lane, mv.next.lanes);
    const inOffset = laneOffset(edge, v.lane);
    const outOffset = laneOffset(mv.next, toLane);
    const curve = junctionCurve(
      node?.cx ?? 0,
      node?.cy ?? 0,
      edge.lastDir,
      inOffset,
      mv.next.firstDir,
      outOffset,
      this.w.grid.roundabout[edge.to] === 1 ? ROUNDABOUT.bulge : 0,
    );
    return {
      node: edge.to,
      key,
      fromEdge: edge.id,
      fromLane: v.lane,
      toEdge: mv.next.id,
      toLane,
      turn: mv.turn,
      zones: zonesFor(edge.lastDir, mv.turn),
      length: curveLength(curve),
      pos: 0,
      reserved: need,
      inDir: edge.lastDir,
      outDir: mv.next.firstDir,
      inOffset,
      outOffset,
    };
  }

  private spawn(buildingId: number): void {
    const w = this.w;
    const b = this.buildingIndex.get(buildingId);
    const trip = b?.pending[0];
    if (!b || !trip) return;
    const dest = this.buildingIndex.get(trip.destination);
    if (!dest) return;
    const best = this.bestRoute(b.door, dest);
    if (!best) return;
    const route = best.route;
    b.pending.shift();
    const kind: VehicleKind = trip.kind ?? KIND_KEYS[w.rng.weightedIndex(KIND_WEIGHTS)] ?? 'car';
    const freeFlow = routeCost(w.graph, freeFlowCosts, null, route.edges);
    const v = createVehicle(w.nextVehicleId(), kind, trip, [...route.edges], w.time, freeFlow, w.rng.next());
    v.destDoor = best.door;
    const first = w.graph.edge(v.edge) as GraphEdge;
    v.s = v.length;
    // Pull out briskly when the lane ahead is clear.
    if (this.exitAvailable(first, 0) - v.s > 25) v.v = Math.min(SPAWN_SPEED, first.speedLimit);
    w.vehicles.push(v);
    w.lanes.insert(laneKey(first.index, 0), v);
    if (!isHighwayTrip(b, dest)) dest.incoming += v.passengers;
    w.onSpawn(v);
  }

  // ------------------------------------------------------------ lane change

  private updateLaneChanges(dt: number): void {
    const w = this.w;
    for (const v of w.vehicles) {
      if (v.laneChangeCooldown > 0) v.laneChangeCooldown -= dt;
      if (v.laneChange) {
        v.laneChange.progress += dt / LANE_CHANGE.duration;
        if (v.laneChange.progress >= 1) {
          v.lane = v.laneChange.to;
          v.laneChange = null;
          v.laneChangeCooldown = LANE_CHANGE.cooldown;
        }
        continue;
      }
      if (v.junction || v.granted || v.laneChangeCooldown > 0) continue;
      const edge = w.graph.edge(v.edge);
      if (!edge || edge.lanes < 2) continue;
      if (v.s < LANE_CHANGE.edgeMargin || edge.length - v.s < LANE_CHANGE.edgeMargin) continue;
      const mv = this.nextMove(v, edge);
      const required = mv ? lanesForTurn(edge.lanes, mv.turn) : null;
      const target = chooseLaneChange(v, edge, required, edge.speedLimit * v.speedFactor, w);
      if (target === null) continue;
      v.laneChange = { from: v.lane, to: target, progress: 0 };
      w.lanes.insert(laneKey(edge.index, target), v);
    }
  }

  // --------------------------------------------------------------- dynamics

  /**
   * Nearest vehicle ahead on the same movement inside the junction. For a
   * vehicle that has not entered yet, every occupant of its movement is ahead.
   */
  private junctionLeader(v: Vehicle, pass: JunctionPass, pos: number): Occupant | null {
    const list = this.byMovement.get(pass.key);
    if (!list) return null;
    const inside = v.junction !== null;
    let best: Occupant | null = null;
    for (const o of list) {
      if (o.v === v) continue;
      if ((!inside || o.pass.pos > pos) && (!best || o.pass.pos < best.pass.pos)) best = o;
    }
    return best;
  }

  /** Bumper gap from a junction position to whatever is ahead (Infinity if nothing). */
  private junctionGap(v: Vehicle, pass: JunctionPass, pos: number): { gap: number; speed: number } {
    const ahead = this.junctionLeader(v, pass, pos);
    if (ahead) return { gap: ahead.pass.pos - ahead.v.length - pos, speed: ahead.v.v };
    const next = this.w.graph.edge(pass.toEdge);
    if (!next) return { gap: Infinity, speed: 0 };
    const last = this.w.lanes.last(laneKey(next.index, pass.toLane));
    if (!last) return { gap: Infinity, speed: 0 };
    return { gap: pass.length - pos + last.s - last.length, speed: last.v };
  }

  private computeAccelerations(): void {
    const w = this.w;
    for (const v of w.vehicles) {
      if (v.junction) {
        const pass = v.junction;
        const next = w.graph.edge(pass.toEdge);
        let v0 = next && pass.turn === 'straight' ? next.speedLimit * v.speedFactor * 0.9 : ROAD.turnSpeed;
        // Round the island slowly.
        if (w.grid.roundabout[pass.node] === 1) v0 = Math.min(v0, ROUNDABOUT.entrySpeed);
        const ahead = this.junctionGap(v, pass, pass.pos);
        v.acc = idmAcceleration(v.v, v0, ahead.gap, v.v - ahead.speed);
        v.state = 'inJunction';
        continue;
      }
      const edge = w.graph.edge(v.edge);
      if (!edge) {
        v.acc = -IDM.maxDecel;
        continue;
      }
      const v0 = edge.speedLimit * v.speedFactor * w.speedScale;
      const mv = this.nextMove(v, edge);
      const dist = edge.length - v.s;
      let desired = v0;
      if (mv) {
        let vt = mv.turn === 'straight' ? Math.min(v0, mv.next.speedLimit * v.speedFactor) : ROAD.turnSpeed;
        // Approaching a roundabout: arrive at entry speed.
        if (w.grid.roundabout[edge.to] === 1) vt = Math.min(vt, ROUNDABOUT.entrySpeed * 0.9);
        desired = Math.min(v0, Math.sqrt(vt * vt + 2 * IDM.comfortDecel * Math.max(0, dist)));
      }
      let acc = Infinity;
      let following = false;
      const lanesToCheck = v.laneChange ? [v.lane, v.laneChange.to] : [v.lane];
      for (const lane of lanesToCheck) {
        const leader = w.lanes.leader(laneKey(edge.index, lane), v.s, v);
        if (leader) {
          const gap = leader.s - leader.length - v.s;
          acc = Math.min(acc, idmAcceleration(v.v, desired, gap, v.v - leader.v));
          if (gap < 2 * (IDM.minGap + v.v * IDM.timeHeadway)) following = true;
        } else {
          acc = Math.min(acc, this.endOfLaneAccel(v, edge, lane, mv, desired, dist));
        }
      }
      v.acc = acc;
      if (v.state === 'noRoute') continue;
      if (v.laneChange) v.state = 'changingLane';
      else if (mv && !v.granted && dist < 25 && (v.v < STATS.queueSpeed || v.acc < -0.5) && !following)
        v.state = 'waitingJunction';
      else if (following) v.state = 'following';
      else v.state = 'moving';
    }
  }

  private endOfLaneAccel(
    v: Vehicle,
    edge: GraphEdge,
    lane: number,
    mv: Move | null,
    desired: number,
    dist: number,
  ): number {
    // A vehicle that just entered the junction from this lane may still overhang the stop line.
    const inBox = this.byApproach.get(approachKey(edge.id, lane));
    let acc = Infinity;
    if (inBox) {
      const p = inBox.pass;
      acc = idmAcceleration(v.v, desired, dist + p.pos - inBox.v.length, v.v - inBox.v.v);
    }
    if (!mv || !v.granted) return Math.min(acc, idmAcceleration(v.v, desired, stopLineGap(dist), v.v));
    if (inBox) return acc;
    const ahead = this.junctionGap(v, v.granted, 0);
    if (!Number.isFinite(ahead.gap)) return Math.min(acc, idmAcceleration(v.v, desired, Infinity, 0));
    return Math.min(acc, idmAcceleration(v.v, desired, dist + ahead.gap, v.v - ahead.speed));
  }

  private integrateAll(dt: number): void {
    const w = this.w;
    for (const v of w.vehicles) {
      if (this.removed.has(v.id)) continue;
      const step = integrate(v.v, v.acc, dt);
      if (step.v < STATS.queueSpeed) {
        v.waitTime += dt;
        v.stopTimer += dt;
      } else if (step.v > 3) {
        v.stopTimer = 0;
      }

      if (v.junction) {
        const pass = v.junction;
        let pos = pass.pos + step.ds;
        let nv = step.v;
        const ahead = this.junctionGap(v, pass, pass.pos);
        const limit = pass.pos + ahead.gap - 0.1;
        if (pos > limit) {
          pos = Math.max(pass.pos, limit);
          nv = Math.min(nv, ahead.speed);
        }
        pass.pos = pos;
        v.v = nv;
        if (pass.pos >= pass.length) this.exitJunction(v);
        continue;
      }

      const edge = w.graph.edge(v.edge);
      if (!edge) continue;
      let ns = v.s + step.ds;
      let nv = step.v;
      const lanesToCheck = v.laneChange ? [v.lane, v.laneChange.to] : [v.lane];
      for (const lane of lanesToCheck) {
        const leader = w.lanes.leader(laneKey(edge.index, lane), v.s, v);
        let limit = Infinity;
        let leaderSpeed = 0;
        if (leader) {
          limit = leader.s - leader.length - 0.1;
          leaderSpeed = leader.v;
        } else {
          const inBox = this.byApproach.get(approachKey(edge.id, lane));
          if (inBox) {
            limit = edge.length + inBox.pass.pos - inBox.v.length - 0.1;
            leaderSpeed = inBox.v.v;
          }
        }
        if (ns > limit) {
          ns = Math.max(v.s, limit);
          nv = Math.min(nv, leaderSpeed);
        }
      }
      const mv = this.nextMove(v, edge);
      if ((!mv || !v.granted) && ns > edge.length) {
        ns = edge.length;
        nv = 0;
      }
      v.s = ns;
      v.v = nv;

      if (w.trailing.has(v.id) && v.s >= v.length) this.releaseTrailing(v.id);

      if (!mv) {
        if (v.state !== 'noRoute' && edge.to === this.destNode(v) && v.s >= edge.length - 1) this.arrive(v);
      } else if (v.granted && v.s >= edge.length) {
        this.enterJunction(v, edge);
      }
    }
  }

  private enterJunction(v: Vehicle, edge: GraphEdge): void {
    const pass = v.granted as JunctionPass;
    pass.pos = Math.min(v.s - edge.length, pass.length);
    v.junction = pass;
    v.granted = null;
    v.laneChange = null;
    this.w.queues.recordJunctionDelay(edge.id, v.stopTimer);
    if (pass.pos >= pass.length) this.exitJunction(v);
  }

  private exitJunction(v: Vehicle): void {
    const w = this.w;
    const pass = v.junction as JunctionPass;
    const next = w.graph.edge(pass.toEdge);
    v.junction = null;
    if (!next) {
      w.junctions.release(pass.node, pass.zones, pass.key, -1, pass.reserved);
      this.failVehicle(v, 'roadRemoved');
      return;
    }
    v.edge = next.id;
    v.lane = pass.toLane;
    v.s = Math.min(pass.pos - pass.length, next.length);
    v.routeIndex = Math.min(v.routeIndex + 1, v.route.length - 1);
    // The zones stay held until the rear of the vehicle has cleared the box.
    w.trailing.set(v.id, {
      vehicle: v.id,
      node: pass.node,
      key: pass.key,
      zones: pass.zones,
      exitEdge: next.id,
      exitLane: pass.toLane,
      need: pass.reserved,
    });
    if (v.s >= v.length) this.releaseTrailing(v.id);
  }

  releaseTrailing(id: number): void {
    const w = this.w;
    const t = w.trailing.get(id);
    if (!t) return;
    w.trailing.delete(id);
    const edge = w.graph.edge(t.exitEdge);
    w.junctions.release(t.node, t.zones, t.key, edge ? laneKey(edge.index, t.exitLane) : -1, t.need);
  }

  /** Releases every junction resource held by a vehicle. */
  releaseAll(v: Vehicle): void {
    const w = this.w;
    const pass = v.junction ?? v.granted;
    if (pass) {
      const edge = w.graph.edge(pass.toEdge);
      w.junctions.release(
        pass.node,
        pass.zones,
        pass.key,
        edge ? laneKey(edge.index, pass.toLane) : -1,
        pass.reserved,
      );
    }
    v.junction = null;
    v.granted = null;
    this.releaseTrailing(v.id);
  }

  private arrive(v: Vehicle): void {
    this.releaseAll(v);
    this.removed.add(v.id);
    const dest = this.buildingIndex.get(v.destination);
    if (dest && isHighwayTrip(this.buildingIndex.get(v.origin), dest)) {
      // Only gateways keep count of highway cars (cars that left the city there).
      if (dest.kind === 'kapi') dest.completed++;
    } else if (dest) {
      dest.incoming = Math.max(0, dest.incoming - v.passengers);
      dest.completed += v.passengers;
    }
    this.w.onArrive(v);
  }

  failVehicle(v: Vehicle, reason: TripFailureReason): void {
    if (this.removed.has(v.id)) return;
    this.releaseAll(v);
    this.removed.add(v.id);
    const dest =
      this.buildingIndex.get(v.destination) ?? this.w.buildings.find((b) => b.id === v.destination);
    const origin = this.buildingIndex.get(v.origin) ?? this.w.buildings.find((b) => b.id === v.origin);
    if (dest && !isHighwayTrip(origin, dest)) dest.incoming = Math.max(0, dest.incoming - v.passengers);
    this.w.onVehicleFail(v, reason);
  }

  /** Removes vehicles marked as removed outside of `step` (e.g. after a network rebuild). */
  flushRemoved(): void {
    if (this.removed.size === 0) return;
    this.w.vehicles = this.w.vehicles.filter((v) => !this.removed.has(v.id));
    this.removed.clear();
  }

  // --------------------------------------------------------------- gridlock

  private findGridlocks(): GridlockInfo[] {
    const w = this.w;
    const waiting = new Map<number, { target: number; node: number }>();
    for (const v of w.vehicles) {
      if (v.junction || v.granted || v.v > 0.1 || v.stopTimer < 5) continue;
      const edge = w.graph.edge(v.edge);
      if (!edge) continue;
      const mv = this.nextMove(v, edge);
      if (!mv || edge.length - v.s > 2) continue;
      const ownKey = laneKey(edge.index, v.lane);
      if (w.lanes.leader(ownKey, v.s, v)) continue;
      const exitLane = exitLaneFor(mv.turn, v.lane, mv.next.lanes);
      const exitKey = laneKey(mv.next.index, exitLane);
      const free = this.exitAvailable(mv.next, exitLane) - w.junctions.reservedOn(exitKey);
      if (free >= v.length + IDM.minGap) continue;
      waiting.set(ownKey, { target: exitKey, node: edge.to });
    }
    return detectGridlock(waiting);
  }
}
