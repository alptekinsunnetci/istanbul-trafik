import {
  DEFAULT_MODE,
  type GameMode,
  type ResourceKind,
  VEHICLE_TYPES,
  type VehicleKind,
} from '../core/constants';
import type { SimStats, StatSample } from '../core/simulation';
import type { Building, BuildingKind, TransitStation, TripRequest } from '../core/world-state';
import type { GameSummary } from '../gameplay/game-over';
import type { Upgrade } from '../gameplay/game-session';
import type { ScoreState } from '../gameplay/scoring';
import type { Bounds } from '../map/map-generator';
import type { Resources } from '../map/road-editor';
import type { Dir } from '../map/grid';
import type { Turn } from '../map/road-graph';
import type { JunctionPass, LaneChange, Vehicle, VehicleState } from '../traffic/vehicle-model';
import type { TrailingHold } from '../traffic/vehicle-system';
import { arr, bool, int, nullable, num, obj, oneOf, str } from './validate';

const GAME_MODES: readonly GameMode[] = ['rahat', 'normal', 'zor'];

export const SETTINGS_VERSION = 1;
export const RECORDS_VERSION = 1;
export const SAVE_VERSION = 4;

export type ReduceMotion = 'system' | 'on' | 'off';

export interface Settings {
  version: number;
  /** 0..1 */
  volume: number;
  /** Background music, 0..1 (0 = off). */
  music: number;
  muted: boolean;
  reduceMotion: ReduceMotion;
  highContrast: boolean;
  showGrid: boolean;
  /** Camera keyboard pan speed multiplier, 0.5..2. */
  panSpeed: number;
  /** Invert mouse wheel zoom direction. */
  invertZoom: boolean;
  /** Last chosen difficulty mode. */
  mode: GameMode;
}

export const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  volume: 0.6,
  music: 0.4,
  muted: false,
  reduceMotion: 'system',
  highContrast: false,
  showGrid: true,
  panSpeed: 1,
  invertZoom: false,
  mode: DEFAULT_MODE,
};

export function parseSettings(raw: unknown): Settings {
  const o = obj(raw, 'settings');
  return {
    version: SETTINGS_VERSION,
    volume: num(o.volume, 'volume', 0, 1),
    music: o.music === undefined ? DEFAULT_SETTINGS.music : num(o.music, 'music', 0, 1),
    muted: bool(o.muted, 'muted'),
    reduceMotion: oneOf(o.reduceMotion, 'reduceMotion', ['system', 'on', 'off'] as const),
    highContrast: bool(o.highContrast, 'highContrast'),
    showGrid: bool(o.showGrid, 'showGrid'),
    panSpeed: num(o.panSpeed, 'panSpeed', 0.5, 2),
    invertZoom: bool(o.invertZoom, 'invertZoom'),
    mode: oneOf(o.mode, 'mode', GAME_MODES),
  };
}

export interface Records {
  version: number;
  bestScores: Record<string, number>;
  history: GameSummary[];
  /** Unlocked achievement ids. */
  achievements: string[];
  /** Running totals across games (e.g. gulls caught, ferry and metro passengers). */
  counters: Record<string, number>;
  /** Best score of each day's daily map, by date (YYYY-MM-DD). */
  daily: Record<string, number>;
}

export const MAX_HISTORY = 20;

/** Best scores are kept per district and difficulty mode. */
export function bestScoreKey(districtId: string, mode: GameMode): string {
  return `${districtId}:${mode}`;
}

export function emptyRecords(): Records {
  return { version: RECORDS_VERSION, bestScores: {}, history: [], achievements: [], counters: {}, daily: {} };
}

function parseSummary(raw: unknown, p: string): GameSummary {
  const o = obj(raw, p);
  return {
    districtId: str(o.districtId, `${p}.districtId`, 40),
    districtName: str(o.districtName, `${p}.districtName`, 60),
    mode: o.mode === undefined ? DEFAULT_MODE : oneOf(o.mode, `${p}.mode`, GAME_MODES),
    seed: int(o.seed, `${p}.seed`, 0, 0xffffffff),
    score: num(o.score, `${p}.score`, 0),
    duration: num(o.duration, `${p}.duration`, 0),
    week: int(o.week, `${p}.week`, 1),
    completed: int(o.completed, `${p}.completed`, 0),
    failed: int(o.failed, `${p}.failed`, 0),
    spawned: int(o.spawned, `${p}.spawned`, 0),
    averageTravelTime: num(o.averageTravelTime, `${p}.averageTravelTime`, 0),
    averageWaitTime: num(o.averageWaitTime, `${p}.averageWaitTime`, 0),
    onTimeRate: num(o.onTimeRate, `${p}.onTimeRate`, 0, 1),
    efficiency: num(o.efficiency, `${p}.efficiency`, 0, 1),
    longestQueue: num(o.longestQueue, `${p}.longestQueue`, 0),
    reason: str(o.reason, `${p}.reason`, 300),
    finishedAt: str(o.finishedAt, `${p}.finishedAt`, 40),
  };
}

export function parseRecords(raw: unknown): Records {
  const o = obj(raw, 'records');
  const best = obj(o.bestScores, 'bestScores');
  const bestScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(best)) {
    if (k.length <= 40) bestScores[k] = num(v, `bestScores.${k}`, 0);
  }
  const history = arr(o.history, 'history', MAX_HISTORY * 2)
    .slice(0, MAX_HISTORY)
    .map((h, i) => parseSummary(h, `history[${i}]`));
  // Added later: older records simply have none yet.
  const achievements =
    o.achievements === undefined
      ? []
      : arr(o.achievements, 'achievements', 100).map((a, i) => str(a, `achievements[${i}]`, 40));
  const numbers = (raw: unknown, p: string, limit: number): Record<string, number> => {
    const out: Record<string, number> = {};
    if (raw === undefined) return out;
    for (const [k, v] of Object.entries(obj(raw, p)).slice(0, limit)) {
      if (k.length <= 40) out[k] = num(v, `${p}.${k}`, 0);
    }
    return out;
  };
  return {
    version: RECORDS_VERSION,
    bestScores,
    history,
    achievements,
    counters: numbers(o.counters, 'counters', 50),
    daily: numbers(o.daily, 'daily', 400),
  };
}

// ------------------------------------------------------------------- saves

export interface SavedGame {
  version: number;
  savedAt: string;
  districtId: string;
  seed: number;
  width: number;
  height: number;
  phase: 'ready' | 'running';
  time: number;
  tick: number;
  resources: Resources;
  mode: GameMode;
  bounds: Bounds;
  week: number;
  colors: number;
  nextGrowthAt: number;
  growthCount: number;
  pendingUpgrades: Upgrade[] | null;
  score: ScoreState;
  rng: number;
  growthRng: number;
  demandReassign: number;
  nextVehicleId: number;
  nextTripId: number;
  grid: {
    road: string;
    links: string;
    lanes: string;
    locked: string;
    signal: string;
    overpass: string;
    paid?: string;
    roundabout?: string;
  };
  buildings: Building[];
  vehicles: Vehicle[];
  trailing: TrailingHold[];
  stats: SimStats;
  junctionDelay: [string, number][];
}

const RESOURCE_KINDS: readonly ResourceKind[] = [
  'roads',
  'bridges',
  'boulevards',
  'lights',
  'roundabouts',
  'lines',
];

function parseBounds(raw: unknown, width: number, height: number): Bounds {
  const o = obj(raw, 'bounds');
  const b = {
    x0: int(o.x0, 'bounds.x0', 0, width - 1),
    y0: int(o.y0, 'bounds.y0', 0, height - 1),
    x1: int(o.x1, 'bounds.x1', 0, width - 1),
    y1: int(o.y1, 'bounds.y1', 0, height - 1),
  };
  if (b.x1 < b.x0 || b.y1 < b.y0) throw new Error('bounds: geçersiz alan');
  return b;
}

function parseResources(raw: unknown, p: string): Resources {
  const o = obj(raw, p);
  return {
    roads: int(o.roads, `${p}.roads`, 0, 1_000_000),
    bridges: int(o.bridges, `${p}.bridges`, 0, 1_000_000),
    boulevards: int(o.boulevards, `${p}.boulevards`, 0, 1_000_000),
    lights: int(o.lights, `${p}.lights`, 0, 1_000_000),
    roundabouts: o.roundabouts === undefined ? 0 : int(o.roundabouts, `${p}.roundabouts`, 0, 1_000_000),
    lines: o.lines === undefined ? 0 : int(o.lines, `${p}.lines`, 0, 1_000_000),
  };
}

function parseUpgrade(raw: unknown, p: string): Upgrade {
  const o = obj(raw, p);
  return {
    kind: oneOf(o.kind, `${p}.kind`, RESOURCE_KINDS),
    amount: int(o.amount, `${p}.amount`, 1, 1000),
    label: str(o.label, `${p}.label`, 60),
    text: str(o.text, `${p}.text`, 120),
  };
}

const TURNS: readonly Turn[] = ['straight', 'right', 'left', 'uturn'];
const VEHICLE_STATES: readonly VehicleState[] = [
  'moving',
  'following',
  'waitingJunction',
  'changingLane',
  'inJunction',
  'noRoute',
];
const KINDS = Object.keys(VEHICLE_TYPES) as VehicleKind[];
const BUILDING_KINDS: readonly BuildingKind[] = ['konut', 'ticari', 'kapi', 'durak'];

function dir(v: unknown, p: string): Dir {
  return int(v, p, 0, 3) as Dir;
}

function edgeId(v: unknown, p: string): string {
  const s = str(v, p, 24);
  if (!/^\d+>[0-3]$/.test(s)) throw new Error(`${p}: geçersiz yol kimliği`);
  return s;
}

function parseTrip(raw: unknown, p: string): TripRequest {
  const o = obj(raw, p);
  return {
    id: int(o.id, `${p}.id`, 0),
    origin: int(o.origin, `${p}.origin`, 0),
    destination: int(o.destination, `${p}.destination`, 0),
    createdAt: num(o.createdAt, `${p}.createdAt`),
    ...(o.passengers === undefined ? {} : { passengers: int(o.passengers, `${p}.passengers`, 1, 50) }),
    ...(o.kind === undefined ? {} : { kind: oneOf(o.kind, `${p}.kind`, KINDS) }),
  };
}

function parseStation(raw: unknown, p: string): TransitStation {
  const o = obj(raw, p);
  return {
    mode: oneOf(o.mode, `${p}.mode`, ['vapur', 'metro'] as const),
    partner: int(o.partner, `${p}.partner`, 0, 10_000),
    riders: arr(o.riders, `${p}.riders`, 500).map((r, i) => {
      const ro = obj(r, `${p}.riders[${i}]`);
      return {
        trip: parseTrip(ro.trip, `${p}.riders[${i}].trip`),
        readyAt: num(ro.readyAt, `${p}.riders[${i}].readyAt`),
      };
    }),
  };
}

function parseBuilding(raw: unknown, p: string, cells: number): Building {
  const o = obj(raw, p);
  return {
    id: int(o.id, `${p}.id`, 0, 10_000),
    kind: oneOf(o.kind, `${p}.kind`, BUILDING_KINDS),
    color: int(o.color, `${p}.color`, 0, 9),
    x: int(o.x, `${p}.x`, 0, 255),
    y: int(o.y, `${p}.y`, 0, 255),
    w: int(o.w, `${p}.w`, 1, 4),
    h: int(o.h, `${p}.h`, 1, 4),
    door: int(o.door, `${p}.door`, 0, cells - 1),
    doorDir: dir(o.doorDir, `${p}.doorDir`),
    name: str(o.name, `${p}.name`, 80),
    createdAt: num(o.createdAt, `${p}.createdAt`),
    pending: arr(o.pending, `${p}.pending`, 50).map((t, i) => parseTrip(t, `${p}.pending[${i}]`)),
    incoming: int(o.incoming, `${p}.incoming`, 0),
    completed: int(o.completed, `${p}.completed`, 0),
    failed: int(o.failed, `${p}.failed`, 0),
    unreachable: bool(o.unreachable, `${p}.unreachable`),
    pinTimer: num(o.pinTimer, `${p}.pinTimer`, -1000, 1000),
    overflow: num(o.overflow, `${p}.overflow`, 0, 1),
    ...(o.transit === undefined ? {} : { transit: parseStation(o.transit, `${p}.transit`) }),
  };
}

function parsePass(raw: unknown, p: string): JunctionPass {
  const o = obj(raw, p);
  return {
    node: int(o.node, `${p}.node`, 0),
    key: str(o.key, `${p}.key`, 80),
    fromEdge: edgeId(o.fromEdge, `${p}.fromEdge`),
    fromLane: int(o.fromLane, `${p}.fromLane`, 0, 3),
    toEdge: edgeId(o.toEdge, `${p}.toEdge`),
    toLane: int(o.toLane, `${p}.toLane`, 0, 3),
    turn: oneOf(o.turn, `${p}.turn`, TURNS),
    zones: arr(o.zones, `${p}.zones`, 4).map((z, i) => int(z, `${p}.zones[${i}]`, 0, 3)),
    length: num(o.length, `${p}.length`, 0, 100),
    pos: num(o.pos, `${p}.pos`, 0, 100),
    reserved: num(o.reserved, `${p}.reserved`, 0, 50),
    inDir: dir(o.inDir, `${p}.inDir`),
    outDir: dir(o.outDir, `${p}.outDir`),
    inOffset: num(o.inOffset, `${p}.inOffset`, -20, 20),
    outOffset: num(o.outOffset, `${p}.outOffset`, -20, 20),
  };
}

function parseLaneChange(raw: unknown, p: string): LaneChange {
  const o = obj(raw, p);
  return {
    from: int(o.from, `${p}.from`, 0, 3),
    to: int(o.to, `${p}.to`, 0, 3),
    progress: num(o.progress, `${p}.progress`, 0, 1.5),
  };
}

function parseVehicle(raw: unknown, p: string): Vehicle {
  const o = obj(raw, p);
  return {
    id: int(o.id, `${p}.id`, 1),
    kind: oneOf(o.kind, `${p}.kind`, KINDS),
    length: num(o.length, `${p}.length`, 1, 20),
    speedFactor: num(o.speedFactor, `${p}.speedFactor`, 0.1, 3),
    tripId: int(o.tripId, `${p}.tripId`, 0),
    origin: int(o.origin, `${p}.origin`, 0),
    destination: int(o.destination, `${p}.destination`, 0),
    departTime: num(o.departTime, `${p}.departTime`),
    freeFlowTime: num(o.freeFlowTime, `${p}.freeFlowTime`, 0),
    edge: edgeId(o.edge, `${p}.edge`),
    lane: int(o.lane, `${p}.lane`, 0, 3),
    s: num(o.s, `${p}.s`, -50, 10_000),
    v: num(o.v, `${p}.v`, 0, 100),
    acc: num(o.acc, `${p}.acc`, -100, 100),
    route: arr(o.route, `${p}.route`, 5000).map((e, i) => edgeId(e, `${p}.route[${i}]`)),
    routeIndex: int(o.routeIndex, `${p}.routeIndex`, 0),
    granted: nullable(o.granted, (g) => parsePass(g, `${p}.granted`)),
    junction: nullable(o.junction, (g) => parsePass(g, `${p}.junction`)),
    laneChange: nullable(o.laneChange, (g) => parseLaneChange(g, `${p}.laneChange`)),
    laneChangeCooldown: num(o.laneChangeCooldown, `${p}.laneChangeCooldown`),
    state: oneOf(o.state, `${p}.state`, VEHICLE_STATES),
    waitTime: num(o.waitTime, `${p}.waitTime`, 0),
    stopTimer: num(o.stopTimer, `${p}.stopTimer`, 0),
    noRouteTimer: num(o.noRouteTimer, `${p}.noRouteTimer`, 0),
    rerouteTimer: num(o.rerouteTimer, `${p}.rerouteTimer`),
    paint: num(o.paint, `${p}.paint`, 0, 1),
    passengers: o.passengers === undefined ? 1 : int(o.passengers, `${p}.passengers`, 1, 50),
  };
}

function parseTrailing(raw: unknown, p: string): TrailingHold {
  const o = obj(raw, p);
  return {
    vehicle: int(o.vehicle, `${p}.vehicle`, 1),
    node: int(o.node, `${p}.node`, 0),
    key: str(o.key, `${p}.key`, 80),
    zones: arr(o.zones, `${p}.zones`, 4).map((z, i) => int(z, `${p}.zones[${i}]`, 0, 3)),
    exitEdge: edgeId(o.exitEdge, `${p}.exitEdge`),
    exitLane: int(o.exitLane, `${p}.exitLane`, 0, 3),
    need: num(o.need, `${p}.need`, 0, 50),
  };
}

function parseSample(raw: unknown, p: string): StatSample {
  const o = obj(raw, p);
  return {
    time: num(o.time, `${p}.time`, 0),
    active: int(o.active, `${p}.active`, 0),
    completed: int(o.completed, `${p}.completed`, 0),
    failed: int(o.failed, `${p}.failed`, 0),
    queued: int(o.queued, `${p}.queued`, 0),
  };
}

function parseStats(raw: unknown): SimStats {
  const o = obj(raw, 'stats');
  const fr = obj(o.failedByReason, 'stats.failedByReason');
  return {
    spawned: int(o.spawned, 'stats.spawned', 0),
    completed: int(o.completed, 'stats.completed', 0),
    failed: int(o.failed, 'stats.failed', 0),
    failedByReason: {
      noRoute: int(fr.noRoute, 'stats.failedByReason.noRoute', 0),
      roadRemoved: int(fr.roadRemoved, 'stats.failedByReason.roadRemoved', 0),
    },
    onTime: int(o.onTime, 'stats.onTime', 0),
    totalTravelTime: num(o.totalTravelTime, 'stats.totalTravelTime', 0),
    totalFreeFlowTime: num(o.totalFreeFlowTime, 'stats.totalFreeFlowTime', 0),
    totalWaitTime: num(o.totalWaitTime, 'stats.totalWaitTime', 0),
    longestQueueEver: num(o.longestQueueEver, 'stats.longestQueueEver', 0),
    queueSampleSum: num(o.queueSampleSum, 'stats.queueSampleSum', 0),
    queueSamples: int(o.queueSamples, 'stats.queueSamples', 0),
    history: arr(o.history, 'stats.history', 1000).map((s, i) => parseSample(s, `stats.history[${i}]`)),
  };
}

/** Structural validation of a saved game. Semantic checks happen when it is restored. */
export function parseSavedGame(raw: unknown): SavedGame {
  const o = obj(raw, 'save');
  const version = int(o.version, 'version');
  if (version !== SAVE_VERSION) throw new Error(`Desteklenmeyen kayıt sürümü: ${version}`);
  const width = int(o.width, 'width', 4, 256);
  const height = int(o.height, 'height', 4, 256);
  const cells = width * height;
  const grid = obj(o.grid, 'grid');
  const score = obj(o.score, 'score');
  return {
    version,
    savedAt: str(o.savedAt, 'savedAt', 40),
    districtId: str(o.districtId, 'districtId', 40),
    seed: int(o.seed, 'seed', 0, 0xffffffff),
    width,
    height,
    phase: oneOf(o.phase, 'phase', ['ready', 'running'] as const),
    time: num(o.time, 'time', 0),
    tick: int(o.tick, 'tick', 0),
    resources: parseResources(o.resources, 'resources'),
    mode: oneOf(o.mode, 'mode', GAME_MODES),
    bounds: parseBounds(o.bounds, width, height),
    week: int(o.week, 'week', 1),
    colors: int(o.colors, 'colors', 1, 9),
    nextGrowthAt: num(o.nextGrowthAt, 'nextGrowthAt', 0),
    growthCount: int(o.growthCount, 'growthCount', 0),
    pendingUpgrades: nullable(o.pendingUpgrades, (u) =>
      arr(u, 'pendingUpgrades', 4).map((x, i) => parseUpgrade(x, `pendingUpgrades[${i}]`)),
    ),
    score: {
      points: int(score.points, 'score.points', 0),
    },
    rng: int(o.rng, 'rng', 0, 0xffffffff),
    growthRng: int(o.growthRng, 'growthRng', 0, 0xffffffff),
    demandReassign: num(o.demandReassign, 'demandReassign', 0, 100),
    nextVehicleId: int(o.nextVehicleId, 'nextVehicleId', 1),
    nextTripId: int(o.nextTripId, 'nextTripId', 1),
    grid: {
      road: str(grid.road, 'grid.road', cells * 2),
      links: str(grid.links, 'grid.links', cells * 2),
      lanes: str(grid.lanes, 'grid.lanes', cells * 2),
      locked: str(grid.locked, 'grid.locked', cells * 2),
      signal: str(grid.signal, 'grid.signal', cells * 2),
      overpass: str(grid.overpass, 'grid.overpass', cells * 2),
      ...(grid.paid === undefined ? {} : { paid: str(grid.paid, 'grid.paid', cells * 2) }),
      ...(grid.roundabout === undefined
        ? {}
        : { roundabout: str(grid.roundabout, 'grid.roundabout', cells * 2) }),
    },
    buildings: arr(o.buildings, 'buildings', 500).map((b, i) => parseBuilding(b, `buildings[${i}]`, cells)),
    vehicles: arr(o.vehicles, 'vehicles', 2000).map((v, i) => parseVehicle(v, `vehicles[${i}]`)),
    trailing: arr(o.trailing, 'trailing', 2000).map((t, i) => parseTrailing(t, `trailing[${i}]`)),
    stats: parseStats(o.stats),
    junctionDelay: arr(o.junctionDelay, 'junctionDelay', 50_000).map((e, i) => {
      const pair = arr(e, `junctionDelay[${i}]`, 2);
      return [edgeId(pair[0], `junctionDelay[${i}][0]`), num(pair[1], `junctionDelay[${i}][1]`, 0)] as [
        string,
        number,
      ];
    }),
  };
}
