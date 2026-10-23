import {
  DEFAULT_MODE,
  ECONOMY,
  type GameMode,
  GROWTH,
  MODES,
  type ModeRules,
  PLAYFIELD,
  type ResourceKind,
  UPGRADES,
} from '../core/constants';
import { EventBus } from '../core/event-bus';
import { Random, hashString } from '../core/random';
import { Simulation } from '../core/simulation';
import type { Building, BuildingKind } from '../core/world-state';
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
  toggleSignal,
  smoothStroke,
  toggleOneWay,
} from '../map/road-editor';
import { pinsAt } from '../traffic/demand-generator';
import { growthAddsWorkplace, growthInterval } from './difficulty';
import { type GameSummary, summarize } from './game-over';
import { ScoreKeeper } from './scoring';

export type SessionPhase = 'ready' | 'running' | 'over';

export type EditTool = 'road' | 'boulevard' | 'oneway' | 'erase' | 'signal';

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
  /** Separate pieces of dry ground; buildings on different pieces need a bridge. */
  private readonly regions: Int32Array;
  /** Districts without water never offer bridges. */
  readonly hasWater: boolean;
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
    this.hasWater = grid.terrain.some((t) => t === Terrain.Water);
    this.growthRng = new Random(hashString(`growth:${district.id}:${this.seed}`));
    this.sim = new Simulation(grid, buildings, {
      seed: this.seed,
      demandMultiplier: district.demandMultiplier / this.rules.pinIntervalFactor,
      rules: this.rules,
    });
    this.resources = {
      roads: district.startRoads,
      bridges: this.hasWater ? ECONOMY.startBridges : 0,
      boulevards: ECONOMY.startBoulevards,
      lights: ECONOMY.startLights,
    };
    this.unsubscribers.push(this.sim.events.on('tripCompleted', () => this.score.onCompleted()));
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
    this.sim.step();
    const time = this.sim.time;

    const week = Math.floor(time / ECONOMY.weekLength) + 1;
    if (week > this.week) this.startWeek(week);

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
    const pool = UPGRADES.filter((u) => this.hasWater || u.kind !== 'bridges');
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
    this.addBuilding('konut', color, anchor, 4, 9);
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
      const across = this.growthRng.next() < GROWTH.acrossWaterWorkplace ? this.acrossWater(anchor) : null;
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
      const city = sim.buildings.filter((x) => x.kind !== 'kapi');
      const sameColor = city.filter((x) => x.color === bestColor);
      const anchor = this.growthRng.pick(sameColor.length > 0 ? sameColor : city);
      const across = this.growthRng.next() < GROWTH.acrossWaterHouse ? this.acrossWater(anchor) : null;
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
    const { cells: stroke, clipped } = this.prepareStroke(tool, rawStroke);
    let p: StrokePreview;
    if (tool === 'road') p = previewBuild(grid, stroke, this.resources);
    else if (tool === 'erase') p = previewErase(grid, stroke);
    else if (tool === 'signal') {
      const c = stroke[0];
      const ok = c !== undefined && grid.isRoad(c) && (grid.signal[c] === 1 || grid.degree(c) >= 3);
      p = { cells: c === undefined ? [] : [{ cell: c, valid: ok }], spent: noResources() };
    } else p = { cells: stroke.map((c) => ({ cell: c, valid: grid.isRoad(c) })), spent: noResources() };
    if (clipped && !p.message) p.message = 'Şehrin sınırına ulaştın';
    return p;
  }

  edit(tool: EditTool, rawStroke: readonly number[]): EditResult {
    if (!this.editable) return { ok: false, spent: noResources(), changed: 0, message: 'Oyun bitti' };
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
    }
    if (clipped && result.ok && tool === 'road') {
      result = { ...result, ok: false, message: 'Şehrin sınırına ulaştın' };
    }
    if (result.changed > 0 || rotated) {
      this.resources.roads -= result.spent.roads;
      this.resources.bridges -= result.spent.bridges;
      this.resources.boulevards -= result.spent.boulevards;
      this.resources.lights -= result.spent.lights;
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
