import {
  DEFAULT_MODE,
  ECONOMY,
  type GameMode,
  GROWTH,
  MODES,
  type ModeRules,
  PLAYFIELD,
  AMBIENCE,
  EVENTS,
  TRANSIT,
  DT,
  GEOM,
  type ResourceKind,
  TIPS,
  UPGRADES,
} from '../core/constants';
import { EventBus } from '../core/event-bus';
import { Random, hashString } from '../core/random';
import { Simulation } from '../core/simulation';
import { demandFactor, hourAt } from './daytime';
import { type Building, type BuildingKind, type TransitMode, buildingCells } from '../core/world-state';
import { type District, districtById } from '../map/districts';
import { DIRS, type Dir, type Grid, Terrain } from '../map/grid';
import {
  type Bounds,
  buildingName,
  createDistrictGrid,
  doorCell,
  findSite,
  generateInitialBuildings,
  inBounds,
  landRegions,
  makeBuilding,
  placeBuilding,
  type Site,
} from '../map/map-generator';
import {
  type EditResult,
  type Resources,
  type StrokePreview,
  buildRoad,
  eraseRoad,
  noResources,
  previewBuild,
  previewErase,
  setBoulevard,
  toggleRoundabout,
  toggleSignal,
  smoothStroke,
  toggleOneWay,
} from '../map/road-editor';
import { pinsAt } from '../traffic/demand-generator';
import { growthAddsWorkplace, growthInterval } from './difficulty';
import { type GameSummary, summarize } from './game-over';
import { ScoreKeeper } from './scoring';

export type SessionPhase = 'ready' | 'running' | 'over';

export type EditTool = 'road' | 'boulevard' | 'oneway' | 'erase' | 'signal' | 'roundabout' | 'transit';

export type Orientation = 'wide' | 'tall';

export interface Upgrade {
  kind: ResourceKind;
  amount: number;
  label: string;
  text: string;
}

export interface SessionEvents {
  notice: { kind: 'info' | 'warning' | 'error' | 'success'; text: string };
  gameOver: GameSummary;
  week: number;
  upgrade: Upgrade[];
  newColor: number;
  buildingAdded: number;
  networkChanged: undefined;
  boundsChanged: Bounds;
  /** A city event started (match, rain, road works) or ended (null). */
  cityEvent: CityEvent | null;
  /** A gull appeared, or a flying gull calls. */
  gullCall: undefined;
  /** The player caught a gull (world position) and got road pieces. */
  gullCaught: { x: number; y: number; roads: number };
  /** Drivers stuck in a heavy jam honk. */
  horn: undefined;
  /** People who came by ferry or metro reached their workplace. */
  transitDelivered: number;
}

export type CityEventKind = 'mac' | 'yagmur' | 'yol';

export interface CityEvent {
  kind: CityEventKind;
  until: number;
  /** Match day: the workplace with the crowd. Road works: the closed cell. */
  target: number;
  text: string;
}

/** A gull flying over open water, in world metres. */
export interface Gull {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  calls: number;
}

export interface SessionInit {
  districtId: string;
  seed: number;
  mode?: GameMode;
  /** Shape of the playable area (default wide). */
  orientation?: Orientation;
  width?: number;
  height?: number;
}

interface RoadSnapshot {
  road: Uint8Array;
  links: Uint8Array;
  lanes: Uint8Array;
  locked: Uint8Array;
  signal: Uint8Array;
  overpass: Uint8Array;
  paid: Uint8Array;
  roundabout: Uint8Array;
  /** Entrance cell and side of every building at snapshot time. */
  doors: Map<number, [number, Dir]>;
  resources: Resources;
}

const UNDO_LIMIT = 30;

/** Initial playable rectangle around the district centre, clamped to the map. */
export function initialBounds(
  grid: Grid,
  center: [number, number],
  orientation: Orientation = 'wide',
): Bounds {
  const tall = orientation === 'tall';
  const w = Math.min(tall ? PLAYFIELD.startHeight : PLAYFIELD.startWidth, grid.width);
  const h = Math.min(tall ? PLAYFIELD.startWidth : PLAYFIELD.startHeight, grid.height);
  const x0 = Math.max(0, Math.min(grid.width - w, Math.round(center[0] - w / 2)));
  const y0 = Math.max(0, Math.min(grid.height - h, Math.round(center[1] - h / 2)));
  return { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 };
}

/**
 * A single play-through: owns the simulation, the building pieces, weekly
 * rewards, the growing playable area, city growth, undo history, the score
 * and the end condition. The session is advanced only via `step()`, which
 * performs exactly one fixed simulation step (and none while a weekly reward
 * is waiting to be chosen).
 */
export class GameSession {
  readonly events = new EventBus<SessionEvents>();
  readonly district: District;
  readonly seed: number;
  readonly mode: GameMode;
  readonly rules: ModeRules;
  /** Shape of the playable area: wide for landscape screens, tall for portrait phones. */
  readonly orientation: Orientation;
  readonly sim: Simulation;
  readonly score = new ScoreKeeper();
  /** Separate stream for city growth so that it is independent from traffic randomness. */
  readonly growthRng: Random;
  phase: SessionPhase = 'ready';
  resources: Resources;
  /** Playable area; it grows every week. Roads and buildings stay inside it. */
  bounds: Bounds;
  week = 1;
  /** Number of colour groups introduced so far. */
  colors = 1;
  nextGrowthAt: number = GROWTH.firstGrowthAt;
  growthCount = 0;
  /** Weekly reward options waiting for the player's choice. */
  pendingUpgrades: Upgrade[] | null = null;
  summary: GameSummary | null = null;
  private undoStack: RoadSnapshot[] = [];
  /** The gull currently flying, if any. */
  gull: Gull | null = null;
  private nextGullAt: number = AMBIENCE.gullFirst;
  private readonly ambienceRng: Random;
  /** Open-water cells (water all around), where gulls fly. */
  private readonly openWater: number[] = [];
  /** The city event going on, if any. */
  event: CityEvent | null = null;
  private nextEventAt = (EVENTS.firstWeek - 1) * ECONOMY.weekLength + 20;
  private hornBursts = 0;
  private nextHornAt = 0;
  private calmSince = 0;
  private lightTipShown = false;
  /** Separate pieces of dry ground; buildings on different pieces need a bridge. */
  private readonly regions: Int32Array;
  /** Bridges cross water and highways (overpasses); a map with neither never offers them. */
  readonly usesBridges: boolean;
  private unsubscribers: (() => void)[] = [];

  constructor(init: SessionInit) {
    const district = districtById(init.districtId);
    if (!district) throw new Error(`Bilinmeyen ilçe: ${init.districtId}`);
    this.district = district;
    this.seed = init.seed >>> 0;
    this.mode = init.mode ?? DEFAULT_MODE;
    this.rules = MODES[this.mode];
    const mapRng = new Random(hashString(`${district.id}:${this.seed}`));
    const grid = createDistrictGrid(district, init.width, init.height);
    const scale = grid.width / 64;
    this.orientation = init.orientation ?? 'wide';
    this.bounds = initialBounds(
      grid,
      [district.center[0] * scale, district.center[1] * scale],
      this.orientation,
    );
    const buildings = generateInitialBuildings(grid, district, mapRng, this.bounds);
    this.regions = landRegions(grid);
    this.usesBridges = grid.terrain.some((t) => t === Terrain.Water) || district.highways.length > 0;
    for (let i = 0; i < grid.size; i++) {
      if (grid.terrain[i] !== Terrain.Water) continue;
      const open = DIRS.every((d) => {
        const n = grid.neighbor(i, d);
        return n < 0 || grid.terrain[n] === Terrain.Water;
      });
      if (open) this.openWater.push(i);
    }
    this.growthRng = new Random(hashString(`growth:${district.id}:${this.seed}`));
    this.ambienceRng = new Random(hashString(`ambience:${district.id}:${this.seed}`));
    this.sim = new Simulation(grid, buildings, {
      seed: this.seed,
      demandMultiplier: district.demandMultiplier / this.rules.pinIntervalFactor,
      rules: this.rules,
    });
    this.resources = {
      roads: district.startRoads,
      bridges: this.usesBridges ? ECONOMY.startBridges : 0,
      boulevards: ECONOMY.startBoulevards,
      lights: ECONOMY.startLights,
      roundabouts: ECONOMY.startRoundabouts,
      lines: ECONOMY.startLines,
    };
    this.unsubscribers.push(
      this.sim.events.on('tripCompleted', (e) => {
        this.score.onCompleted(e.vehicle.passengers);
        if (this.sim.buildingById(e.vehicle.origin)?.kind === 'durak')
          this.events.emit('transitDelivered', e.vehicle.passengers);
      }),
    );
    this.unsubscribers.push(this.sim.events.on('gridlock', () => this.lightTip(true)));
  }

  // ----------------------------------------------------------------- transit

  /** A line across mostly water (between two shores) is a ferry line, otherwise a metro line. */
  private lineMode(a: number, b: number): TransitMode {
    const g = this.sim.grid;
    const ax = g.cx(a);
    const ay = g.cy(a);
    const bx = g.cx(b);
    const by = g.cy(b);
    let water = 0;
    const n = 24;
    for (let k = 1; k < n; k++) {
      const x = Math.round(ax + ((bx - ax) * k) / n);
      const y = Math.round(ay + ((by - ay) * k) / n);
      if (g.inBounds(x, y) && g.terrain[g.idx(x, y)] === Terrain.Water) water++;
    }
    return water / (n - 1) >= TRANSIT.ferryWater ? 'vapur' : 'metro';
  }

  /** A free spot for a station near a cell; a pier has to stand on the shore. */
  private stationSite(cell: number, mode: TransitMode): Site | null {
    const g = this.sim.grid;
    const shore = (x: number, y: number): boolean => {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (g.inBounds(x + dx, y + dy) && g.terrain[g.idx(x + dx, y + dy)] === Terrain.Water) return true;
      return false;
    };
    return findSite(g, this.sim.buildings, 'durak', this.ambienceRng, {
      center: [g.cx(cell), g.cy(cell)],
      minRadius: 0,
      maxRadius: mode === 'vapur' ? 3 : 2.5,
      minDistance: 1,
      attempts: 120,
      bounds: this.bounds,
      ...(mode === 'vapur' ? { accept: shore } : {}),
    });
  }

  /**
   * The transit tool: dragging from one place to another builds a line with a
   * station at each end; tapping a station removes its line again.
   */
  private transitEdit(raw: readonly number[]): EditResult {
    const none = noResources();
    const g = this.sim.grid;
    const cells = raw.filter((c) => c >= 0);
    const first = cells[0];
    const last = cells[cells.length - 1];
    if (first === undefined || last === undefined)
      return { ok: false, spent: none, changed: 0, message: 'Hat için iki yer arasında sürükleyin' };
    const tapped = this.sim.buildingById(g.building[first] as number);
    const short = Math.hypot(g.cx(first) - g.cx(last), g.cy(first) - g.cy(last)) < TRANSIT.minLength;
    if (tapped?.kind === 'durak' && short) return this.removeLine(tapped);
    if (short)
      return {
        ok: false,
        spent: none,
        changed: 0,
        message: `Hat en az ${TRANSIT.minLength} hücre uzun olmalı`,
      };
    if (this.resources.lines < 1)
      return { ok: false, spent: none, changed: 0, message: 'Vapur/metro hattı kalmadı' };
    const mode = this.lineMode(first, last);
    const a = this.stationSite(first, mode);
    const b = a ? this.stationSite(last, mode) : null;
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < TRANSIT.minLength)
      return {
        ok: false,
        spent: none,
        changed: 0,
        message:
          mode === 'vapur' ? 'İskele için iki kıyıda da boş yer gerekir' : 'İstasyon için boş yer bulunamadı',
      };
    const used = new Set(this.sim.buildings.map((x) => x.name));
    const nextId = this.sim.buildings.reduce((m, x) => Math.max(m, x.id), -1) + 1;
    const suffix = mode === 'vapur' ? 'İskelesi' : 'Metro';
    const make = (id: number, partner: number, site: Site): Building => {
      let name = `${this.ambienceRng.pick(this.district.neighbourhoods)} ${suffix}`;
      if (used.has(name)) name = `${name} ${id}`;
      used.add(name);
      const st = makeBuilding(id, 'durak', 0, site, name, this.sim.time);
      st.transit = { mode, partner, riders: [] };
      placeBuilding(g, st);
      this.sim.buildings.push(st);
      return st;
    };
    // A station whose site is already taken by the first one cannot be placed twice.
    const sa = make(nextId, nextId + 1, a);
    if (g.building[b.door] !== -1 || g.building[g.idx(b.x, b.y)] !== -1) {
      this.dropStation(sa);
      return { ok: false, spent: none, changed: 0, message: 'İstasyon için boş yer bulunamadı' };
    }
    const sb = make(nextId + 1, nextId, b);
    this.resources.lines--;
    // Buildings appeared: old undo steps no longer fit.
    this.undoStack = [];
    this.settle();
    this.events.emit('buildingAdded', sa.id);
    this.events.emit('buildingAdded', sb.id);
    return {
      ok: true,
      spent: { ...none, lines: 1 },
      changed: 1,
      message: `${mode === 'vapur' ? 'Vapur' : 'Metro'} hattı açıldı`,
    };
  }

  /** Removes a line: passengers on it go back home and wait for a car instead. */
  private removeLine(station: Building): EditResult {
    const partner = this.sim.buildingById(station.transit?.partner ?? -1);
    for (const st of [station, partner]) {
      if (!st) continue;
      for (const r of st.transit?.riders ?? []) {
        const home = this.sim.buildingById(r.trip.origin);
        if (home?.kind === 'konut') home.pending.push({ ...r.trip, createdAt: this.sim.time });
      }
      this.dropStation(st);
    }
    this.resources.lines++;
    this.undoStack = [];
    this.settle();
    return { ok: true, spent: { ...noResources(), lines: -1 }, changed: 1, message: 'Hat kaldırıldı' };
  }

  private dropStation(st: Building): void {
    const g = this.sim.grid;
    for (const c of buildingCells(st, g.width)) g.building[c] = -1;
    g.locked[st.door] = 0;
    if (g.degree(st.door) === 0) {
      g.road[st.door] = 0;
      g.links[st.door] = 0;
      g.lanes[st.door] = 0;
    }
    g.touch();
    this.sim.buildings = this.sim.buildings.filter((b) => b !== st);
  }

  /** City events: one at a time, from week 3 on, each for half a minute or so. */
  private updateEvent(): void {
    const time = this.sim.time;
    const ev = this.event;
    if (ev) {
      if (time >= ev.until) this.endEvent();
      return;
    }
    if (time < this.nextEventAt) return;
    const rng = this.ambienceRng;
    this.nextEventAt = time + rng.range(EVENTS.gapMin, EVENTS.gapMax);
    const until = time + rng.range(EVENTS.durationMin, EVENTS.durationMax);
    const kinds: CityEventKind[] = ['mac', 'yagmur', 'yol'];
    const kind = rng.pick(kinds);
    const grid = this.sim.grid;
    if (kind === 'mac') {
      const works = this.sim.buildings.filter((b) => b.kind === 'ticari');
      if (works.length === 0) return;
      const w = rng.pick(works);
      this.sim.demand.boosts.set(w.id, EVENTS.matchBoost);
      this.startEvent({ kind, until, target: w.id, text: `Maç günü! ${w.name} çevresinde trafik artıyor.` });
    } else if (kind === 'yagmur') {
      this.sim.speedScale = EVENTS.rainSpeed;
      this.startEvent({ kind, until, target: -1, text: 'Yağmur başladı: araçlar yavaşladı.' });
    } else {
      const cells: number[] = [];
      for (let i = 0; i < grid.size; i++) {
        if (!grid.isRoad(i) || grid.locked[i] === 1 || grid.isBridge(i) || grid.degree(i) !== 2) continue;
        if (grid.signal[i] === 1 || grid.roundabout[i] === 1 || grid.overpass[i] === 1) continue;
        cells.push(i);
      }
      if (cells.length === 0) return;
      const c = rng.pick(cells);
      grid.closed[c] = 1;
      this.settle();
      this.startEvent({
        kind,
        until,
        target: c,
        text: 'Yol çalışması: bir yol bir süre kapalı, araçlar başka yoldan gider.',
      });
    }
  }

  private startEvent(ev: CityEvent): void {
    this.event = ev;
    this.events.emit('notice', { kind: 'info', text: ev.text });
    this.events.emit('cityEvent', ev);
  }

  private endEvent(): void {
    const ev = this.event;
    if (!ev) return;
    this.event = null;
    if (ev.kind === 'mac') this.sim.demand.boosts.delete(ev.target);
    else if (ev.kind === 'yagmur') this.sim.speedScale = 1;
    else {
      this.sim.grid.closed[ev.target] = 0;
      this.settle();
    }
    this.events.emit('cityEvent', null);
  }

  /** Gulls: now and then one flies over open water near the playable area and calls. */
  private updateGull(): void {
    const time = this.sim.time;
    const g = this.gull;
    if (g) {
      g.age += DT;
      g.x += g.vx * DT;
      g.y += g.vy * DT;
      if (g.calls < AMBIENCE.gullCalls && g.age >= g.calls * AMBIENCE.gullCallEvery) {
        g.calls++;
        this.events.emit('gullCall', undefined);
      }
      if (g.age >= AMBIENCE.gullLife) this.gull = null;
      return;
    }
    if (time < this.nextGullAt) return;
    const rng = this.ambienceRng;
    this.nextGullAt = time + rng.range(AMBIENCE.gullIntervalMin, AMBIENCE.gullIntervalMax);
    const grid = this.sim.grid;
    const b = this.bounds;
    const near = this.openWater.filter((c) => {
      const x = grid.cx(c);
      const y = grid.cy(c);
      return x >= b.x0 - 2 && x <= b.x1 + 2 && y >= b.y0 - 2 && y <= b.y1 + 2;
    });
    if (near.length === 0) return;
    const c = rng.pick(near);
    const angle = rng.range(0, Math.PI * 2);
    const C = GEOM.cellSize;
    this.gull = {
      x: (grid.cx(c) + 0.5) * C,
      y: (grid.cy(c) + 0.5) * C,
      vx: Math.cos(angle) * AMBIENCE.gullSpeed,
      vy: Math.sin(angle) * AMBIENCE.gullSpeed,
      age: 0,
      calls: 0,
    };
  }

  /** Catching the gull gives road pieces; returns false when there is none (any more). */
  catchGull(): boolean {
    const g = this.gull;
    if (!g || !this.editable) return false;
    this.gull = null;
    this.resources.roads += AMBIENCE.gullReward;
    this.events.emit('gullCaught', { x: g.x, y: g.y, roads: AMBIENCE.gullReward });
    return true;
  }

  /**
   * Horns in a heavy jam: a few bursts with pauses in between, then silence
   * until the traffic has been calm for a while.
   */
  private updateHorns(): void {
    const time = this.sim.time;
    const jam = this.sim.gridlocks.length > 0 || this.sim.queues.snapshot.longestQueue >= AMBIENCE.hornQueue;
    if (!jam) {
      if (time - this.calmSince >= AMBIENCE.hornCalm) this.hornBursts = 0;
      return;
    }
    this.calmSince = time;
    if (this.hornBursts >= AMBIENCE.hornMaxPerJam || time < this.nextHornAt) return;
    this.hornBursts++;
    this.nextHornAt = time + AMBIENCE.hornGap + this.ambienceRng.range(0, 3);
    this.events.emit('horn', undefined);
  }

  /** Shown once per game, when a junction gets crowded and a light could help. */
  private lightTip(gridlock: boolean): void {
    if (this.lightTipShown || this.resources.lights <= 0) return;
    const g = this.sim.grid;
    let open = false;
    for (const [cell, node] of this.sim.graph.nodes)
      if (node.degree >= 3 && g.signal[cell] === 0) open = true;
    if (!open) return;
    this.lightTipShown = true;
    this.events.emit('notice', {
      kind: 'info',
      text: gridlock
        ? 'Bir kavşak kilitlendi. İkinci bir yol aç ya da kavşağa trafik ışığı koy (Işık).'
        : 'Kuyruk uzuyor: kalabalık kavşağa trafik ışığı koyabilirsin (Işık).',
    });
  }

  start(): void {
    if (this.phase === 'ready') this.phase = 'running';
  }

  /** True while the simulation can advance. */
  get active(): boolean {
    return this.phase === 'running' && this.pendingUpgrades === null;
  }

  /** One fixed simulation step. Does nothing unless the game is running and no reward is pending. */
  step(): void {
    if (!this.active) return;
    // Rush hours and quiet nights.
    this.sim.demand.timeFactor = demandFactor(hourAt(this.sim.time));
    this.sim.step();
    const time = this.sim.time;

    const week = Math.floor(time / ECONOMY.weekLength) + 1;
    if (week > this.week) this.startWeek(week);

    if (this.sim.tick % 20 === 0 && this.sim.queues.snapshot.longestQueue >= TIPS.queueForLight)
      this.lightTip(false);
    this.updateGull();
    this.updateEvent();
    if (this.sim.tick % 20 === 0) this.updateHorns();

    if (time >= this.nextGrowthAt) {
      this.growCity();
      this.nextGrowthAt = time + growthInterval(time);
    }

    if (!this.rules.endless) {
      const full = this.sim.buildings.find((b) => b.kind === 'ticari' && b.overflow >= 1);
      if (full) this.finish(`${full.name} taştı: bekleyen yolculuklar çok birikti.`);
    }
  }

  private startWeek(week: number): void {
    this.week = week;
    this.resources.roads += ECONOMY.weeklyRoads;
    this.expandBounds();
    // City changes (new area, new buildings) make old undo steps meaningless.
    this.undoStack = [];
    if (GROWTH.newColorWeeks.includes(week) && this.colors < GROWTH.maxColors) {
      this.introduceColor();
    }
    const pool = UPGRADES.filter((u) => this.usesBridges || u.kind !== 'bridges');
    const first = pool.splice(this.growthRng.int(0, pool.length - 1), 1)[0] as Upgrade;
    const second = pool[this.growthRng.int(0, pool.length - 1)] as Upgrade;
    this.pendingUpgrades = [first, second];
    this.events.emit('week', week);
    this.events.emit('upgrade', this.pendingUpgrades);
  }

  private expandBounds(): void {
    const g = this.sim.grid;
    const b = this.bounds;
    const tall = this.orientation === 'tall';
    const hx = (tall ? PLAYFIELD.growY : PLAYFIELD.growX) / 2;
    const hy = (tall ? PLAYFIELD.growX : PLAYFIELD.growY) / 2;
    const next: Bounds = {
      x0: Math.max(0, b.x0 - hx),
      y0: Math.max(0, b.y0 - hy),
      x1: Math.min(g.width - 1, b.x1 + hx),
      y1: Math.min(g.height - 1, b.y1 + hy),
    };
    if (next.x0 === b.x0 && next.y0 === b.y0 && next.x1 === b.x1 && next.y1 === b.y1) return;
    this.bounds = next;
    this.events.emit('boundsChanged', next);
  }

  /** Applies one of the offered weekly rewards and lets the simulation continue. */
  chooseUpgrade(index: number): Upgrade | null {
    const options = this.pendingUpgrades;
    const choice = options?.[index];
    if (!choice) return null;
    this.resources[choice.kind] += choice.amount;
    this.pendingUpgrades = null;
    return choice;
  }

  // ------------------------------------------------------------------ growth

  private addBuilding(
    kind: BuildingKind,
    color: number,
    around: [number, number],
    minR: number,
    maxR: number,
    accept?: (x: number, y: number) => boolean,
  ): Building | null {
    const sim = this.sim;
    const b0 = this.bounds;
    const extra = accept ? { accept } : {};
    const site =
      findSite(sim.grid, sim.buildings, kind, this.growthRng, {
        center: around,
        minRadius: minR,
        maxRadius: maxR,
        minDistance: 2,
        bounds: b0,
        ...extra,
      }) ??
      findSite(sim.grid, sim.buildings, kind, this.growthRng, {
        center: [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2],
        minRadius: 0,
        maxRadius: Math.max(b0.x1 - b0.x0, b0.y1 - b0.y0),
        minDistance: 2,
        attempts: 200,
        bounds: b0,
        ...extra,
      });
    if (!site) return null;
    const used = new Set(sim.buildings.map((b) => b.name));
    const id = sim.buildings.reduce((m, b) => Math.max(m, b.id), -1) + 1;
    const b = makeBuilding(
      id,
      kind,
      color,
      site,
      buildingName(this.district, kind, this.growthRng, used),
      sim.time,
    );
    placeBuilding(sim.grid, b);
    sim.buildings.push(b);
    return b;
  }

  private settle(): void {
    this.sim.rebuildNetwork();
    this.events.emit('networkChanged', undefined);
  }

  private introduceColor(): void {
    const color = this.colors++;
    const b0 = this.bounds;
    const c: [number, number] = [(b0.x0 + b0.x1) / 2, (b0.y0 + b0.y1) / 2];
    const work = this.addBuilding('ticari', color, c, 5, 14);
    if (!work) return;
    const anchor: [number, number] = [work.x + 1, work.y + 1];
    // The first house of a new colour stands on the same bank as its workplace.
    const g = this.sim.grid;
    const bank = this.regions[g.idx(work.x, work.y)];
    this.addBuilding('konut', color, anchor, 4, 9, (x, y) => this.regions[g.idx(x, y)] === bank);
    this.settle();
    this.events.emit('newColor', color);
    this.events.emit('buildingAdded', work.id);
  }

  private growCity(): void {
    const sim = this.sim;
    if (sim.buildings.length >= GROWTH.maxBuildings) return;
    const n = this.growthCount++;
    const workplaces = sim.buildings.filter((b) => b.kind === 'ticari');
    let b: Building | null;
    if (growthAddsWorkplace(n)) {
      const color = this.growthRng.int(0, this.colors - 1);
      const sameColor = workplaces.filter((w) => w.color === color);
      const anchor = this.growthRng.pick(sameColor.length > 0 ? sameColor : workplaces);
      const across =
        this.week >= GROWTH.acrossWaterFromWeek && this.growthRng.next() < GROWTH.acrossWaterWorkplace
          ? this.acrossWater(anchor)
          : null;
      b =
        (across && this.addBuilding('ticari', color, [anchor.x, anchor.y], 6, 14, across)) ||
        this.addBuilding('ticari', color, [anchor.x, anchor.y], 6, 12);
    } else {
      // A house for the colour that is most short of houses relative to its pins.
      let bestColor = 0;
      let bestNeed = -Infinity;
      for (let color = 0; color < this.colors; color++) {
        const houses = sim.buildings.filter((x) => x.kind === 'konut' && x.color === color).length;
        const pins = workplaces
          .filter((w) => w.color === color)
          .reduce((s, w) => s + pinsAt(sim.buildings, w) + 1, 0);
        const need = pins / (1 + houses);
        if (need > bestNeed) {
          bestNeed = need;
          bestColor = color;
        }
      }
      const city = sim.buildings.filter((x) => x.kind === 'konut' || x.kind === 'ticari');
      const sameColor = city.filter((x) => x.color === bestColor);
      const anchor = this.growthRng.pick(sameColor.length > 0 ? sameColor : city);
      const across =
        this.week >= GROWTH.acrossWaterFromWeek && this.growthRng.next() < GROWTH.acrossWaterHouse
          ? this.acrossWater(anchor)
          : null;
      b =
        (across && this.addBuilding('konut', bestColor, [anchor.x, anchor.y], 3, 12, across)) ||
        this.addBuilding('konut', bestColor, [anchor.x, anchor.y], 3, 8);
    }
    if (!b) return;
    this.settle();
    this.events.emit('buildingAdded', b.id);
  }

  /**
   * A site condition for "on the other side of the water" from a building,
   * or null when the playable area has only one piece of dry ground.
   */
  private acrossWater(from: Building): ((x: number, y: number) => boolean) | null {
    const g = this.sim.grid;
    const own = this.regions[g.idx(from.x, from.y)];
    const b = this.bounds;
    let other = false;
    for (let y = b.y0; y <= b.y1 && !other; y++)
      for (let x = b.x0; x <= b.x1 && !other; x++) {
        const r = this.regions[g.idx(x, y)] as number;
        if (r >= 0 && r !== own) other = true;
      }
    if (!other) return null;
    return (x, y) => {
      const r = this.regions[g.idx(x, y)] as number;
      return r >= 0 && r !== own;
    };
  }

  finish(reason: string): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.sim.demandEnabled = false;
    this.summary = summarize(
      this.sim.stats,
      {
        districtId: this.district.id,
        districtName: this.district.name,
        mode: this.mode,
        seed: this.seed,
        score: this.score.score,
        duration: this.sim.time,
        week: this.week,
        reason,
      },
      new Date(),
    );
    this.events.emit('gameOver', this.summary);
  }

  // ------------------------------------------------------------------ edits

  get editable(): boolean {
    return this.phase !== 'over';
  }

  /**
   * Turns raw pointer cells into the stroke that is actually applied:
   * strokes that start on a building start at its entrance, a stroke that
   * reaches another building ends at that building's entrance, gaps are
   * filled around obstacles, and the stroke stops at the edge of the
   * playable area. An entrance that is not connected to any road yet turns
   * to the side the road comes from; with `apply` the turn is carried out.
   */
  prepareStroke(
    tool: EditTool,
    raw: readonly number[],
    apply = false,
  ): { cells: number[]; clipped: boolean; rotated: boolean } {
    const grid = this.sim.grid;
    let rotated = false;
    const snapped: number[] = [];
    if (tool === 'road') {
      let start: Building | null = null;
      let end: Building | null = null;
      const outside: number[] = [];
      for (const c of raw) {
        if (c < 0) continue;
        const bid = grid.building[c] as number;
        // Gateways at the map edge are not something to connect to.
        if (bid >= 0 && this.sim.buildingById(bid)?.kind === 'kapi') continue;
        if (bid < 0) {
          outside.push(c);
          continue;
        }
        if (outside.length === 0 && (start === null || start.id === bid)) {
          start ??= this.sim.buildingById(bid) ?? null;
          continue;
        }
        if (start && bid === start.id) continue;
        end = this.sim.buildingById(bid) ?? null;
        break;
      }
      let startDoor = -1;
      if (start) {
        const r = this.entranceFacing(start, outside[0] ?? null, apply);
        startDoor = r.door;
        rotated ||= r.rotated;
        snapped.push(startDoor);
      }
      snapped.push(...outside);
      if (end) {
        const toward = outside[outside.length - 1] ?? (startDoor >= 0 ? startDoor : null);
        const r = this.entranceFacing(end, toward, apply);
        rotated ||= r.rotated;
        snapped.push(r.door);
      }
    } else {
      for (const c of raw) if (c >= 0 && grid.building[c] === -1) snapped.push(c);
    }
    const smooth = smoothStroke(
      grid,
      snapped.filter((c) => c >= 0),
    );
    const cells: number[] = [];
    let clipped = false;
    for (const c of smooth) {
      if (!inBounds(this.bounds, grid.cx(c), grid.cy(c))) {
        clipped = true;
        break;
      }
      cells.push(c);
    }
    return { cells, clipped, rotated };
  }

  /**
   * Entrance of a building as seen from a road coming from `toward`. A
   * building whose entrance has no road yet turns it to the closest valid
   * side; connected entrances never move (that would cut existing roads).
   */
  private entranceFacing(
    b: Building,
    toward: number | null,
    apply: boolean,
  ): { door: number; rotated: boolean } {
    const grid = this.sim.grid;
    if (toward === null || grid.degree(b.door) > 0) return { door: b.door, rotated: false };
    const tx = grid.cx(toward);
    const ty = grid.cy(toward);
    const dist = (c: number): number => Math.abs(grid.cx(c) - tx) + Math.abs(grid.cy(c) - ty);
    let best = { cell: b.door, dir: b.doorDir, d: dist(b.door) };
    for (const dir of DIRS) {
      const cell = doorCell(grid, b.kind, b.x, b.y, dir);
      if (cell < 0 || cell === b.door) continue;
      if (!inBounds(this.bounds, grid.cx(cell), grid.cy(cell))) continue;
      if (grid.terrain[cell] !== Terrain.Land || grid.building[cell] !== -1 || grid.locked[cell] === 1)
        continue;
      const d = dist(cell);
      if (d < best.d) best = { cell, dir, d };
    }
    if (best.cell === b.door) return { door: b.door, rotated: false };
    if (apply) this.moveEntrance(b, best.cell, best.dir);
    return { door: best.cell, rotated: true };
  }

  /** Moves an unconnected entrance to another side of its building. */
  private moveEntrance(b: Building, cell: number, dir: Dir): void {
    const g = this.sim.grid;
    const old = b.door;
    g.road[old] = 0;
    g.links[old] = 0;
    g.lanes[old] = 0;
    g.locked[old] = 0;
    if (!g.isRoad(cell)) {
      g.road[cell] = 1;
      g.lanes[cell] = 1;
      g.links[cell] = 0;
    }
    g.locked[cell] = 1;
    b.door = cell;
    b.doorDir = dir;
    g.touch();
  }

  preview(tool: EditTool, rawStroke: readonly number[]): StrokePreview {
    const grid = this.sim.grid;
    if (tool === 'transit') {
      const cells = rawStroke.filter((c) => c >= 0);
      const a = cells[0];
      const b = cells[cells.length - 1];
      if (a === undefined || b === undefined) return { cells: [], spent: noResources() };
      const long = Math.hypot(grid.cx(a) - grid.cx(b), grid.cy(a) - grid.cy(b)) >= TRANSIT.minLength;
      const p: StrokePreview = {
        cells: [
          { cell: a, valid: long },
          { cell: b, valid: long },
        ],
        spent: noResources(),
      };
      if (cells.length > 1)
        p.message = long ? `${this.lineMode(a, b) === 'vapur' ? 'Vapur' : 'Metro'} hattı` : 'Hat çok kısa';
      return p;
    }
    const { cells: stroke, clipped } = this.prepareStroke(tool, rawStroke);
    let p: StrokePreview;
    if (tool === 'road') p = previewBuild(grid, stroke, this.resources);
    else if (tool === 'erase') p = previewErase(grid, stroke);
    else if (tool === 'signal' || tool === 'roundabout') {
      const c = stroke[0];
      const ok = c !== undefined && grid.isRoad(c) && (grid.signal[c] === 1 || grid.degree(c) >= 3);
      p = { cells: c === undefined ? [] : [{ cell: c, valid: ok }], spent: noResources() };
    } else p = { cells: stroke.map((c) => ({ cell: c, valid: grid.isRoad(c) })), spent: noResources() };
    if (clipped && !p.message) p.message = 'Şehrin sınırına ulaştın';
    return p;
  }

  edit(tool: EditTool, rawStroke: readonly number[]): EditResult {
    if (!this.editable) return { ok: false, spent: noResources(), changed: 0, message: 'Oyun bitti' };
    if (tool === 'transit') return this.transitEdit(rawStroke);
    const grid = this.sim.grid;
    const before = this.snapshotRoads();
    const { cells: stroke, clipped, rotated } = this.prepareStroke(tool, rawStroke, true);
    if (stroke.length === 0) {
      if (rotated) this.commitEdit(before);
      return {
        ok: false,
        spent: noResources(),
        changed: rotated ? 1 : 0,
        message: clipped ? 'Şehrin sınırına ulaştın' : 'Geçersiz konum',
      };
    }
    let result: EditResult;
    switch (tool) {
      case 'road':
        result = buildRoad(grid, stroke, this.resources);
        break;
      case 'erase':
        result = eraseRoad(grid, stroke);
        break;
      case 'boulevard':
        result = setBoulevard(grid, stroke, this.resources);
        break;
      case 'oneway':
        result = toggleOneWay(grid, stroke);
        break;
      case 'signal':
        result = toggleSignal(grid, stroke, this.resources);
        break;
      case 'roundabout':
        result = toggleRoundabout(grid, stroke, this.resources);
        break;
    }
    if (clipped && result.ok && tool === 'road') {
      result = { ...result, ok: false, message: 'Şehrin sınırına ulaştın' };
    }
    if (result.changed > 0 || rotated) {
      this.resources.roads -= result.spent.roads;
      this.resources.bridges -= result.spent.bridges;
      this.resources.boulevards -= result.spent.boulevards;
      this.resources.lights -= result.spent.lights;
      this.resources.roundabouts -= result.spent.roundabouts;
      this.commitEdit(before);
      if (rotated && result.changed === 0) result = { ...result, changed: 1 };
    }
    return result;
  }

  private commitEdit(before: RoadSnapshot): void {
    this.undoStack.push(before);
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.afterRoadChange();
  }

  get canUndo(): boolean {
    return this.editable && this.undoStack.length > 0;
  }

  /** Reverts the last road edit (including turned entrances) and gives its pieces back. */
  undo(): boolean {
    const snap = this.undoStack.pop();
    if (!snap || !this.editable) return false;
    const g = this.sim.grid;
    g.road.set(snap.road);
    g.links.set(snap.links);
    g.lanes.set(snap.lanes);
    g.locked.set(snap.locked);
    g.signal.set(snap.signal);
    g.overpass.set(snap.overpass);
    g.paid.set(snap.paid);
    g.roundabout.set(snap.roundabout);
    for (const b of this.sim.buildings) {
      const door = snap.doors.get(b.id);
      if (door) {
        b.door = door[0];
        b.doorDir = door[1];
      }
      // Buildings that appeared after the snapshot keep their entrance.
      g.locked[b.door] = 1;
      if (g.road[b.door] !== 1) {
        g.road[b.door] = 1;
        g.lanes[b.door] = 1;
        g.links[b.door] = 0;
      }
    }
    g.touch();
    this.resources = { ...snap.resources };
    this.afterRoadChange();
    return true;
  }

  private snapshotRoads(): RoadSnapshot {
    const g = this.sim.grid;
    return {
      road: g.road.slice(),
      links: g.links.slice(),
      lanes: g.lanes.slice(),
      locked: g.locked.slice(),
      signal: g.signal.slice(),
      overpass: g.overpass.slice(),
      paid: g.paid.slice(),
      roundabout: g.roundabout.slice(),
      doors: new Map(this.sim.buildings.map((b) => [b.id, [b.door, b.doorDir] as [number, Dir]])),
      resources: { ...this.resources },
    };
  }

  private afterRoadChange(): void {
    const net = this.sim.rebuildNetwork();
    if (net.failedVehicles > 0) {
      this.events.emit('notice', {
        kind: 'info',
        text: `${net.failedVehicles} araç silinen yoldan geri döndü.`,
      });
    }
    this.events.emit('networkChanged', undefined);
  }

  dispose(): void {
    for (const off of this.unsubscribers) off();
    this.unsubscribers = [];
    this.sim.events.clear();
    this.events.clear();
  }
}
