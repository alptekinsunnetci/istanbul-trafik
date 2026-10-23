import { VEHICLE_TYPES, type VehicleKind } from '../core/constants';
import type { Dir } from '../map/grid';
import type { Turn } from '../map/road-graph';

export type VehicleState =
  'moving' | 'following' | 'waitingJunction' | 'changingLane' | 'inJunction' | 'noRoute';

/** A movement through one junction, reserved before entry. */
export interface JunctionPass {
  node: number;
  /** Movement identity: vehicles with the same key follow the same path. */
  key: string;
  fromEdge: string;
  fromLane: number;
  toEdge: string;
  toLane: number;
  turn: Turn;
  zones: number[];
  /** Path length through the junction box. */
  length: number;
  /** Distance travelled inside the junction. */
  pos: number;
  /** Space reserved at the start of the exit lane. */
  reserved: number;
  inDir: Dir;
  outDir: Dir;
  inOffset: number;
  outOffset: number;
}

export interface LaneChange {
  from: number;
  to: number;
  /** 0..1 */
  progress: number;
}

export interface Vehicle {
  id: number;
  kind: VehicleKind;
  length: number;
  speedFactor: number;
  tripId: number;
  origin: number;
  destination: number;
  departTime: number;
  /** Free-flow travel time of the route at departure, for delay statistics. */
  freeFlowTime: number;

  edge: string;
  lane: number;
  /** Position of the front bumper along the edge's drivable length. */
  s: number;
  v: number;
  acc: number;

  route: string[];
  /** Index of the current edge in `route`. */
  routeIndex: number;

  /** Reservation obtained while approaching a junction. */
  granted: JunctionPass | null;
  /** Junction currently being traversed. */
  junction: JunctionPass | null;
  laneChange: LaneChange | null;
  laneChangeCooldown: number;

  state: VehicleState;
  /** Total seconds spent below queue speed. */
  waitTime: number;
  /** Current continuous waiting time at a stop line. */
  stopTimer: number;
  noRouteTimer: number;
  rerouteTimer: number;
  /** Deterministic per-vehicle variation used for colours. */
  paint: number;
}

export function createVehicle(
  id: number,
  kind: VehicleKind,
  trip: { id: number; origin: number; destination: number },
  route: string[],
  time: number,
  freeFlowTime: number,
  paint: number,
): Vehicle {
  const type = VEHICLE_TYPES[kind];
  return {
    id,
    kind,
    length: type.length,
    speedFactor: type.speedFactor,
    tripId: trip.id,
    origin: trip.origin,
    destination: trip.destination,
    departTime: time,
    freeFlowTime,
    edge: route[0] as string,
    lane: 0,
    s: 0,
    v: 0,
    acc: 0,
    route,
    routeIndex: 0,
    granted: null,
    junction: null,
    laneChange: null,
    laneChangeCooldown: 0,
    state: 'moving',
    waitTime: 0,
    stopTimer: 0,
    noRouteTimer: 0,
    // Stagger periodic route checks so they do not all happen in one tick.
    rerouteTimer: (id % 20) / 5,
    paint,
  };
}

export const VEHICLE_STATE_LABELS: Record<VehicleState, string> = {
  moving: 'Seyir hâlinde',
  following: 'Öndeki aracı takip ediyor',
  waitingJunction: 'Kavşakta bekliyor',
  changingLane: 'Şerit değiştiriyor',
  inJunction: 'Kavşaktan geçiyor',
  noRoute: 'Rota bulunamadı',
};

export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  car: 'Otomobil',
  taxi: 'Taksi',
  dolmus: 'Dolmuş',
};
