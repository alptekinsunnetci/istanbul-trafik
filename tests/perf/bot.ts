import type { GameMode } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import { GameSession } from '../../src/gameplay/game-session';
import { Terrain } from '../../src/map/grid';
import { previewBuild } from '../../src/map/road-editor';

/** Shortest walkable path between two doors (land preferred, then water), like a careful player. */
function path(s: GameSession, from: number, to: number, water: boolean): number[] | null {
  const g = s.sim.grid;
  const b = s.bounds;
  const prev = new Int32Array(g.size).fill(-2);
  prev[from] = -1;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i] as number;
    if (c === to) break;
    for (const d of [0, 1, 2, 3] as const) {
      const n = g.neighbor(c, d);
      if (n < 0 || prev[n] !== -2) continue;
      const x = g.cx(n);
      const y = g.cy(n);
      if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
      if (n !== to) {
        if (g.building[n] !== -1 || g.terrain[n] === Terrain.Park) continue;
        if (g.terrain[n] === Terrain.Water && !water) continue;
        if (g.locked[n] === 1 && !g.isHighway(n)) continue;
      }
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[to] === -2) return null;
  const out: number[] = [];
  for (let c = to; c !== -1; c = prev[c] as number) out.push(c);
  return out.reverse();
}

function connect(s: GameSession, a: Building, b: Building): boolean {
  for (const water of [false, true]) {
    const p = path(s, a.door, b.door, water);
    if (!p) continue;
    const preview = previewBuild(s.sim.grid, p, s.resources);
    if (preview.cells.some((c) => !c.valid)) continue;
    s.edit('road', p);
    return true;
  }
  return false;
}

/** The unsignalled junction with the most cars standing in front of it. */
function busiestJunction(s: GameSession): number | null {
  const waiting = new Map<number, number>();
  for (const v of s.sim.vehicles) {
    if (v.v > 0.5 || v.junction) continue;
    const e = s.sim.graph.edge(v.edge);
    if (!e) continue;
    const n = s.sim.graph.node(e.to);
    if (!n || n.degree < 3 || s.sim.grid.signal[e.to] === 1) continue;
    waiting.set(e.to, (waiting.get(e.to) ?? 0) + 1);
  }
  let best: number | null = null;
  let most = 3;
  for (const [node, n] of waiting)
    if (n > most) {
      most = n;
      best = node;
    }
  return best;
}

export interface BotResult {
  district: string;
  mode: GameMode;
  time: number;
  over: boolean;
  score: number;
  through: number;
  meanActive: number;
  lights: number;
  overpasses: number;
}

/**
 * A simple, honest bot: every two seconds it links houses that cannot reach
 * a workplace of their colour (nearest first) and workplaces that no house
 * can reach yet, with the pieces it has; it puts a light on a crowded
 * junction and picks weekly rewards by need.
 */
export function playBot(
  district: string,
  mode: GameMode,
  seed: number,
  limit: number,
  log?: (s: GameSession) => void,
): BotResult {
  const s = new GameSession({ districtId: district, seed, mode });
  s.start();
  let activeSum = 0;
  let samples = 0;
  let timer = 0;
  while (s.phase === 'running' && s.sim.time < limit) {
    if (s.pendingUpgrades) {
      const r = s.resources;
      const want =
        r.roads < 25
          ? 'roads'
          : r.bridges < 2 && s.usesBridges
            ? 'bridges'
            : r.lines < 1
              ? 'lines'
              : r.lights < 1
                ? 'lights'
                : 'roads';
      const i = s.pendingUpgrades.findIndex((u) => u.kind === want);
      s.chooseUpgrade(i >= 0 ? i : 0);
    }
    s.step();
    timer += 1 / 20;
    if (timer < 2) continue;
    timer = 0;
    if (log && Math.round(s.sim.time) % 30 === 0) log(s);
    activeSum += s.sim.vehicles.length;
    samples++;
    const works = s.sim.buildings.filter((b) => b.kind === 'ticari');
    for (const h of s.sim.buildings) {
      if (h.kind !== 'konut') continue;
      const own = works.filter((w) => w.color === h.color);
      if (own.length === 0 || own.some((w) => s.sim.reachable(h, w))) continue;
      own.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
      // Prefer joining the nearest existing road of the network over a whole new line.
      if (!connect(s, h, own[0]!)) for (const w of own.slice(1)) if (connect(s, h, w)) break;
    }
    // A new workplace nobody can reach yet: link it to its nearest house of the same colour.
    for (const w of works) {
      const houses = s.sim.buildings.filter((h) => h.kind === 'konut' && h.color === w.color);
      if (houses.length === 0 || houses.some((h) => s.sim.reachable(h, w))) continue;
      houses.sort((a, b) => Math.hypot(a.x - w.x, a.y - w.y) - Math.hypot(b.x - w.x, b.y - w.y));
      for (const h of houses.slice(0, 3)) if (connect(s, h, w)) break;
    }
    // Busy junctions get a light, or a roundabout when no light is left (not on highways).
    const j = busiestJunction(s);
    if (j !== null) {
      if (s.resources.lights > 0) s.edit('signal', [j]);
      else if (s.resources.roundabouts > 0 && !s.sim.grid.isHighway(j)) s.edit('roundabout', [j]);
    }
    // A house it could not link by road: put a ferry/metro line from next to it to its workplace.
    if (s.resources.lines > 0) {
      const lonely = s.sim.buildings.find(
        (h) =>
          h.kind === 'konut' &&
          !works.some((w) => w.color === h.color && s.sim.reachable(h, w)) &&
          s.sim.time - h.createdAt > 20,
      );
      const target = lonely && works.find((w) => w.color === lonely.color);
      if (lonely && target) {
        const g = s.sim.grid;
        const r = s.edit('transit', [g.idx(lonely.x, lonely.y), g.idx(target.x, target.y)]);
        if (r.ok) {
          const far = s.sim.buildings.filter((b) => b.kind === 'durak').at(-1);
          if (far) connect(s, far, target);
        }
      }
    }
  }
  const g = s.sim.grid;
  const result: BotResult = {
    district,
    mode,
    time: Math.round(s.sim.time),
    over: s.phase === 'over',
    score: s.score.score,
    through: s.sim.throughCompleted,
    meanActive: samples > 0 ? Math.round(activeSum / samples) : 0,
    lights: s.sim.junctions.signalCount,
    overpasses: g.overpass.reduce((a, x) => a + x, 0),
  };
  s.dispose();
  return result;
}
