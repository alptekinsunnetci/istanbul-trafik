import type { ResourceKind } from '../core/constants';
import { diagonalRuns } from './geometry';
import { type Dir, type Grid, Terrain, dirBetween, opposite } from './grid';

/** Countable building pieces: one piece per cell. */
export type Resources = Record<ResourceKind, number>;

export function noResources(): Resources {
  return { roads: 0, bridges: 0, boulevards: 0, lights: 0, roundabouts: 0, lines: 0 };
}

export const UNLIMITED: Resources = {
  roads: 1e9,
  bridges: 1e9,
  boulevards: 1e9,
  lights: 1e9,
  roundabouts: 1e9,
  lines: 1e9,
};

export interface EditResult {
  ok: boolean;
  /** Pieces used (positive) or returned (negative). */
  spent: Resources;
  changed: number;
  message?: string;
}

export interface PreviewCell {
  cell: number;
  valid: boolean;
  /** The street crosses a highway here on an overpass (uses a bridge piece). */
  overpass?: boolean;
  /** Inside a diagonal: every second cell costs nothing. */
  free?: boolean;
}

export interface StrokePreview {
  cells: PreviewCell[];
  spent: Resources;
  message?: string;
}

/** Pieces that a road cell occupies (returned when it is erased). */
export function cellPieces(grid: Grid, i: number): Resources {
  const r = noResources();
  if (grid.overpass[i] === 1) {
    r.bridges = 1;
    return r;
  }
  if (!grid.isRoad(i) || grid.locked[i] === 1) return r;
  if (grid.signal[i] === 1) r.lights = 1;
  if (grid.roundabout[i] === 1) r.roundabouts = 1;
  if (grid.paid[i] === 0) return r;
  if (grid.isBridge(i)) r.bridges = 1;
  else r.roads = 1;
  if (grid.lanes[i] === 2) r.boulevards = 1;
  return r;
}

function addTo(a: Resources, b: Resources, sign = 1): void {
  a.roads += sign * b.roads;
  a.bridges += sign * b.bridges;
  a.boulevards += sign * b.boulevards;
  a.lights += sign * b.lights;
  a.roundabouts += sign * b.roundabouts;
  a.lines += sign * b.lines;
}

/**
 * Turns a raw list of pointer cells into a 4-connected path without repeats
 * of the same cell in sequence. Diagonal jumps are filled with an L-shaped step.
 */
export function normalizeStroke(grid: Grid, cells: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (c < 0 || c >= grid.size) continue;
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(c);
      continue;
    }
    if (last === c) continue;
    let x = grid.cx(last);
    let y = grid.cy(last);
    const tx = grid.cx(c);
    const ty = grid.cy(c);
    while (x !== tx || y !== ty) {
      if (Math.abs(tx - x) >= Math.abs(ty - y)) x += Math.sign(tx - x);
      else y += Math.sign(ty - y);
      const next = grid.idx(x, y);
      if (out[out.length - 1] !== next) out.push(next);
    }
  }
  return out;
}

function isObstacle(grid: Grid, i: number): boolean {
  return grid.building[i] !== -1 || grid.terrain[i] === Terrain.Park;
}

/** Shortest 4-connected detour around buildings and parks (excluding `from`), or null. */
function detour(grid: Grid, from: number, to: number, maxVisited = 600): number[] | null {
  const prev = new Map<number, number>([[from, -1]]);
  const queue = [from];
  for (let qi = 0; qi < queue.length && queue.length < maxVisited; qi++) {
    const c = queue[qi] as number;
    if (c === to) break;
    for (const d of [0, 1, 2, 3] as const) {
      const n = grid.neighbor(c, d);
      if (n < 0 || prev.has(n) || (n !== to && isObstacle(grid, n))) continue;
      prev.set(n, c);
      queue.push(n);
    }
  }
  if (!prev.has(to)) return null;
  const path: number[] = [];
  for (let c = to; c !== from; c = prev.get(c) as number) path.push(c);
  return path.reverse();
}

/**
 * Like `normalizeStroke`, but when the straight fill between two pointer
 * samples would cut through a building or park, it walks around it instead.
 * This keeps fast or sloppy drags (and touch input) drawing what was meant.
 */
export function smoothStroke(grid: Grid, cells: readonly number[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    if (c < 0 || c >= grid.size) continue;
    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(c);
      continue;
    }
    if (last === c) continue;
    const straight = normalizeStroke(grid, [last, c]).slice(1);
    const blocked = straight.slice(0, -1).some((x) => isObstacle(grid, x));
    const seg = blocked ? (detour(grid, last, c) ?? straight) : straight;
    for (const x of seg) if (out[out.length - 1] !== x) out.push(x);
  }
  return out;
}

function stepDir(grid: Grid, a: number, b: number): Dir | null {
  return dirBetween(grid.cx(b) - grid.cx(a), grid.cy(b) - grid.cy(a));
}

function buildBlockReason(grid: Grid, i: number): string | null {
  if (grid.building[i] !== -1) return 'Binaların üzerine yol yapılamaz';
  if (grid.terrain[i] === Terrain.Park) return 'Parklara yol yapılamaz';
  return null;
}

/**
 * True when the stroke runs straight across a plain highway cell (one that is
 * not a junction yet): that crossing becomes an overpass instead of a junction.
 */
function crossesHighway(grid: Grid, stroke: readonly number[], k: number): boolean {
  const c = stroke[k] as number;
  const a = stroke[k - 1];
  const b = stroke[k + 1];
  if (a === undefined || b === undefined || !grid.isHighway(c) || grid.overpass[c] === 1) return false;
  if (grid.isHighway(a) || grid.isHighway(b) || grid.degree(c) !== 2) return false;
  const d1 = stepDir(grid, a, c);
  const d2 = stepDir(grid, c, b);
  // Straight through, across the highway (which runs along the other axis).
  return d1 !== null && d1 === d2 && !grid.connected(c, d1) && !grid.connected(c, opposite(d1));
}

/**
 * Validates a road stroke. New land cells use a road piece, new water cells
 * use a bridge piece, and so does crossing a highway on an overpass; the
 * stroke is valid up to the first blocked cell. Without a bridge piece left,
 * a highway crossing becomes an ordinary junction.
 */
export function previewBuild(grid: Grid, stroke: readonly number[], budget: Resources): StrokePreview {
  const cells: PreviewCell[] = [];
  const spent = noResources();
  let message: string | undefined;
  let blocked = false;
  // A diagonal step is as cheap as a straight one: every second staircase cell is free.
  const dirs: Dir[] = [];
  for (let k = 1; k < stroke.length; k++) {
    const d = stepDir(grid, stroke[k - 1] as number, stroke[k] as number);
    if (d !== null) dirs.push(d);
  }
  const free = new Uint8Array(stroke.length);
  if (dirs.length === stroke.length - 1)
    for (const [a, b] of diagonalRuns(dirs)) for (let k = a + 1; k < b; k += 2) free[k] = 1;
  for (let k = 0; k < stroke.length; k++) {
    const c = stroke[k] as number;
    if (blocked) {
      cells.push({ cell: c, valid: false });
      continue;
    }
    if (crossesHighway(grid, stroke, k)) {
      if (spent.bridges + 1 <= budget.bridges) {
        spent.bridges++;
        cells.push({ cell: c, valid: true, overpass: true });
      } else {
        message ??= 'Köprü parçası yok: otoyolla kavşak yapılacak';
        cells.push({ cell: c, valid: true });
      }
      continue;
    }
    const reason = buildBlockReason(grid, c);
    const isFree = free[k] === 1 && !grid.isRoad(c);
    const kind: ResourceKind | null =
      grid.isRoad(c) || isFree ? null : grid.isBridge(c) ? 'bridges' : 'roads';
    if (reason) {
      message = reason;
      blocked = true;
    } else if (kind && spent[kind] + 1 > budget[kind]) {
      message = kind === 'bridges' ? 'Köprü parçası kalmadı' : 'Yol parçası kalmadı';
      blocked = true;
    }
    if (!blocked && kind) spent[kind]++;
    cells.push(isFree ? { cell: c, valid: !blocked, free: true } : { cell: c, valid: !blocked });
  }
  return message === undefined ? { cells, spent } : { cells, spent, message };
}

/** Builds the valid prefix of a stroke and connects consecutive cells in both directions. */
export function buildRoad(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  const preview = previewBuild(grid, stroke, budget);
  let changed = 0;
  let prev = -1;
  for (const p of preview.cells) {
    if (!p.valid) break;
    const c = p.cell;
    if (p.overpass) {
      grid.overpass[c] = 1;
      changed++;
    }
    if (!grid.isRoad(c)) {
      grid.road[c] = 1;
      grid.lanes[c] = 1;
      grid.links[c] = 0;
      grid.paid[c] = p.free ? 0 : 1;
      changed++;
    }
    if (prev >= 0) {
      const d = stepDir(grid, prev, c);
      if (d !== null && !grid.connected(prev, d)) {
        grid.setLink(prev, d, true);
        grid.setLink(c, opposite(d), true);
        changed++;
      }
    }
    prev = c;
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: preview.message === undefined, spent: preview.spent, changed };
  if (preview.message !== undefined) result.message = preview.message;
  return result;
}

export function previewErase(grid: Grid, stroke: readonly number[]): StrokePreview {
  const cells = stroke.map((c) => ({ cell: c, valid: grid.isRoad(c) && grid.locked[c] !== 1 }));
  const spent = noResources();
  for (const c of new Set(stroke)) addTo(spent, cellPieces(grid, c), -1);
  return { cells, spent };
}

/** Takes the street off an overpass (the highway below stays) and returns its bridge piece. */
function removeOverpass(grid: Grid, c: number, spent: Resources): void {
  if (grid.overpass[c] !== 1) return;
  grid.overpass[c] = 0;
  spent.bridges--;
  for (const d of [0, 1, 2, 3] as const) {
    const n = grid.neighbor(c, d);
    if (n < 0 || grid.isHighway(n)) continue;
    grid.setLink(c, d, false);
    grid.setLink(n, opposite(d), false);
  }
}

export function eraseRoad(grid: Grid, stroke: readonly number[]): EditResult {
  const spent = noResources();
  let changed = 0;
  let lockedHit = false;
  let highwayHit = false;
  for (const c of new Set(stroke)) {
    if (!grid.isRoad(c)) continue;
    if (grid.overpass[c] === 1) {
      removeOverpass(grid, c, spent);
      changed++;
      continue;
    }
    if (grid.locked[c] === 1) {
      lockedHit = true;
      if (grid.isHighway(c)) highwayHit = true;
      continue;
    }
    addTo(spent, cellPieces(grid, c), -1);
    for (const d of [0, 1, 2, 3] as const) {
      const n = grid.neighbor(c, d);
      if (n < 0) continue;
      // An overpass that loses one of its ends goes with it.
      if (grid.overpass[n] === 1) removeOverpass(grid, n, spent);
      grid.setLink(n, opposite(d), false);
    }
    grid.links[c] = 0;
    grid.road[c] = 0;
    grid.lanes[c] = 0;
    grid.signal[c] = 0;
    grid.roundabout[c] = 0;
    grid.closed[c] = 0;
    grid.paid[c] = 0;
    changed++;
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: changed > 0, spent, changed };
  if (lockedHit) result.message = highwayHit ? 'Otoyol silinemez' : 'Bina girişleri silinemez';
  else if (changed === 0) result.message = 'Silinecek yol yok';
  return result;
}

/**
 * Upgrades road cells to two-lane boulevards (one boulevard piece per cell),
 * or downgrades them if the stroke starts on a boulevard.
 */
export function setBoulevard(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  // Highways keep their lanes.
  const roads = [...new Set(stroke)].filter((c) => grid.isRoad(c) && !grid.isHighway(c));
  const spent = noResources();
  if (roads.length === 0)
    return { ok: false, spent, changed: 0, message: 'Bulvarı mevcut bir yolun üstüne çizin' };
  const downgrade = grid.lanes[roads[0] as number] === 2;
  let changed = 0;
  let message: string | undefined;
  for (const c of roads) {
    if (downgrade) {
      if (grid.lanes[c] === 2) {
        spent.boulevards--;
        grid.lanes[c] = 1;
        changed++;
      }
    } else if (grid.lanes[c] === 1) {
      if (spent.boulevards + 1 > budget.boulevards) {
        message = 'Bulvar parçası kalmadı';
        break;
      }
      spent.boulevards++;
      grid.lanes[c] = 2;
      changed++;
    }
  }
  if (changed > 0) grid.touch();
  const result: EditResult = { ok: message === undefined && changed > 0, spent, changed };
  if (message !== undefined) result.message = message;
  else if (changed === 0) result.message = downgrade ? 'Değişiklik yok' : 'Bu yollar zaten bulvar';
  return result;
}

/**
 * Makes connected consecutive cells of the stroke one-way in drawing
 * direction. Drawing again in the same direction restores two-way traffic.
 */
export function toggleOneWay(grid: Grid, stroke: readonly number[]): EditResult {
  const pairs: { a: number; b: number; d: Dir }[] = [];
  for (let k = 1; k < stroke.length; k++) {
    const a = stroke[k - 1] as number;
    const b = stroke[k] as number;
    const d = stepDir(grid, a, b);
    if (d !== null && grid.connected(a, d) && !(grid.isHighway(a) && grid.isHighway(b)))
      pairs.push({ a, b, d });
  }
  if (pairs.length === 0) {
    return {
      ok: false,
      spent: noResources(),
      changed: 0,
      message: 'Tek yön için bağlı bir yol boyunca sürükleyin',
    };
  }
  const alreadyOneWay = pairs.every((p) => grid.hasLink(p.a, p.d) && !grid.hasLink(p.b, opposite(p.d)));
  for (const p of pairs) {
    grid.setLink(p.a, p.d, true);
    grid.setLink(p.b, opposite(p.d), alreadyOneWay);
  }
  grid.touch();
  return {
    ok: true,
    spent: noResources(),
    changed: pairs.length,
    message: alreadyOneWay ? 'Çift yön' : 'Tek yön',
  };
}

/**
 * Puts a traffic light on a junction (a road cell with three or more arms),
 * or takes it away again, returning the piece.
 */
export function toggleSignal(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  const spent = noResources();
  const c = stroke[0];
  if (c === undefined || !grid.isRoad(c))
    return { ok: false, spent, changed: 0, message: 'Trafik ışığını bir kavşağa koyun' };
  if (grid.signal[c] === 1) {
    grid.signal[c] = 0;
    spent.lights = -1;
    grid.touch();
    return { ok: true, spent, changed: 1, message: 'Trafik ışığı kaldırıldı' };
  }
  if (grid.degree(c) < 3 || grid.overpass[c] === 1)
    return { ok: false, spent, changed: 0, message: 'Trafik ışığı yalnızca kavşağa konur' };
  if (grid.roundabout[c] === 1) return { ok: false, spent, changed: 0, message: 'Bu kavşakta göbek var' };
  if (budget.lights < 1) return { ok: false, spent, changed: 0, message: 'Trafik ışığı kalmadı' };
  grid.signal[c] = 1;
  spent.lights = 1;
  grid.touch();
  return { ok: true, spent, changed: 1 };
}

/**
 * Turns a junction (three or more arms, not on a highway) into a roundabout,
 * or back into a plain junction, returning the piece.
 */
export function toggleRoundabout(grid: Grid, stroke: readonly number[], budget: Resources): EditResult {
  const spent = noResources();
  const c = stroke[0];
  if (c === undefined || !grid.isRoad(c))
    return { ok: false, spent, changed: 0, message: 'Göbeği bir kavşağa koyun' };
  if (grid.roundabout[c] === 1) {
    grid.roundabout[c] = 0;
    spent.roundabouts = -1;
    grid.touch();
    return { ok: true, spent, changed: 1, message: 'Göbek kaldırıldı' };
  }
  if (grid.degree(c) < 3 || grid.overpass[c] === 1)
    return { ok: false, spent, changed: 0, message: 'Göbek yalnızca kavşağa konur' };
  if (grid.isHighway(c)) return { ok: false, spent, changed: 0, message: 'Otoyola göbek konmaz' };
  if (grid.signal[c] === 1) return { ok: false, spent, changed: 0, message: 'Önce trafik ışığını kaldırın' };
  if (budget.roundabouts < 1) return { ok: false, spent, changed: 0, message: 'Göbek kalmadı' };
  grid.roundabout[c] = 1;
  spent.roundabouts = 1;
  grid.touch();
  return { ok: true, spent, changed: 1 };
}
