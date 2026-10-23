import { DT } from '../src/core/constants';
import { Simulation } from '../src/core/simulation';
import type { Building, BuildingKind } from '../src/core/world-state';
import { type Dir, Grid } from '../src/map/grid';
import { checkSite, makeBuilding, placeBuilding } from '../src/map/map-generator';
import { UNLIMITED, buildRoad } from '../src/map/road-editor';
import type { GameSession } from '../src/gameplay/game-session';

export function testGrid(width = 24, height = 24): Grid {
  return new Grid(width, height);
}

/** Cells of a straight horizontal or vertical segment, inclusive. */
export function segment(grid: Grid, x0: number, y0: number, x1: number, y1: number): number[] {
  const cells: number[] = [];
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  cells.push(grid.idx(x, y));
  while (x !== x1 || y !== y1) {
    x += dx;
    y += dy;
    cells.push(grid.idx(x, y));
  }
  return cells;
}

/** Builds a polyline road through the given points (axis-aligned legs). */
export function road(grid: Grid, ...points: [number, number][]): void {
  const cells: number[] = [];
  for (let k = 1; k < points.length; k++) {
    const [x0, y0] = points[k - 1] as [number, number];
    const [x1, y1] = points[k] as [number, number];
    const seg = segment(grid, x0, y0, x1, y1);
    cells.push(...(k === 1 ? seg : seg.slice(1)));
  }
  const r = buildRoad(grid, cells, UNLIMITED);
  if (!r.ok) throw new Error(`road failed: ${r.message ?? ''}`);
}

export function addBuilding(
  grid: Grid,
  buildings: Building[],
  kind: BuildingKind,
  x: number,
  y: number,
  doorDir: Dir,
  createdAt = -1000,
): Building {
  const door = checkSite(grid, kind, x, y, doorDir);
  if (door < 0) throw new Error(`invalid site ${kind} ${x},${y}`);
  const b = makeBuilding(
    buildings.length,
    kind,
    0,
    { x, y, doorDir, door },
    `${kind}-${buildings.length}`,
    createdAt,
  );
  placeBuilding(grid, b);
  buildings.push(b);
  return b;
}

export function makeSim(grid: Grid, buildings: Building[], seed = 1, demand = false): Simulation {
  const sim = new Simulation(grid, buildings, { seed });
  sim.demandEnabled = demand;
  return sim;
}

export function addTrip(sim: Simulation, origin: Building, destination: Building, count = 1): void {
  for (let i = 0; i < count; i++) {
    origin.pending.push({
      id: sim.nextTripId++,
      origin: origin.id,
      destination: destination.id,
      createdAt: sim.time,
    });
  }
}

export function runFor(sim: Simulation, seconds: number, each?: () => void): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    sim.step();
    each?.();
  }
}

/** Shortest 4-connected cell path that avoids buildings and parks (BFS). */
export function cellPath(grid: Grid, from: number, to: number): number[] {
  const prev = new Int32Array(grid.size).fill(-2);
  prev[from] = -1;
  const queue = [from];
  for (let qi = 0; qi < queue.length; qi++) {
    const c = queue[qi] as number;
    if (c === to) break;
    for (const d of [0, 1, 2, 3] as const) {
      const n = grid.neighbor(c, d);
      if (n < 0 || prev[n] !== -2) continue;
      if (
        n !== to &&
        (grid.building[n] !== -1 || grid.terrain[n] === 2 || (grid.locked[n] === 1 && n !== from))
      )
        continue;
      prev[n] = c;
      queue.push(n);
    }
  }
  if (prev[to] === -2) return [];
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c] as number) path.push(c);
  return path.reverse();
}

/** Connects every building door of a session to the first building's door. */
export function connectAll(session: GameSession): void {
  session.resources = { roads: 100_000, bridges: 100_000, boulevards: 100_000, lights: 100 };
  // Test networks may span the whole district, not only the initial playable area.
  const g = session.sim.grid;
  session.bounds = { x0: 0, y0: 0, x1: g.width - 1, y1: g.height - 1 };
  const sim = session.sim;
  const first = sim.buildings[0];
  if (!first) return;
  for (const b of sim.buildings.slice(1)) {
    if (b.kind === 'kapi') continue;
    const path = cellPath(sim.grid, b.door, first.door);
    if (path.length > 1) session.edit('road', path);
  }
}

/**
 * Runs a session for up to `seconds` of simulated time, always picking the
 * first weekly reward. Stops early when the game ends.
 */
export function play(session: GameSession, seconds: number, each?: () => void): void {
  const target = session.sim.time + seconds;
  let guard = Math.round(seconds / DT) * 2 + 100;
  while (session.sim.time < target && session.phase === 'running' && guard-- > 0) {
    if (session.pendingUpgrades) session.chooseUpgrade(0);
    session.step();
    each?.();
  }
}

/** Asserts that no two vehicles in the same lane overlap. */
export function assertNoOverlap(sim: Simulation): void {
  const byLane = new Map<string, { s: number; len: number; id: number }[]>();
  for (const v of sim.vehicles) {
    if (v.junction) continue;
    const lanes = v.laneChange ? [v.lane, v.laneChange.to] : [v.lane];
    for (const l of lanes) {
      const key = `${v.edge}#${l}`;
      const list = byLane.get(key) ?? [];
      list.push({ s: v.s, len: v.length, id: v.id });
      byLane.set(key, list);
    }
  }
  for (const [key, list] of byLane) {
    list.sort((a, b) => b.s - a.s);
    for (let i = 1; i < list.length; i++) {
      const front = list[i - 1] as { s: number; len: number; id: number };
      const back = list[i] as { s: number; len: number; id: number };
      if (back.s > front.s - front.len + 1e-6) {
        throw new Error(
          `overlap on ${key}: vehicle ${back.id} at ${back.s} behind ${front.id} at ${front.s}`,
        );
      }
    }
  }
}
