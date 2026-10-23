import { describe, expect, it } from 'vitest';
import { DT } from '../../src/core/constants';
import { Random } from '../../src/core/random';
import { GameSession } from '../../src/gameplay/game-session';
import { buildingName, findSite, makeBuilding, placeBuilding } from '../../src/map/map-generator';
import { UNLIMITED, setBoulevard } from '../../src/map/road-editor';
import { assertNoOverlap, segment } from '../helpers';

/** BFS from a cell to the nearest existing road cell, avoiding buildings and parks. */
function pathToRoad(session: GameSession, from: number): number[] {
  const g = session.sim.grid;
  const prev = new Int32Array(g.size).fill(-2);
  prev[from] = -1;
  const queue = [from];
  let found = -1;
  for (let qi = 0; qi < queue.length && found < 0; qi++) {
    const c = queue[qi]!;
    for (const d of [0, 1, 2, 3] as const) {
      const n = g.neighbor(c, d);
      if (n < 0 || prev[n] !== -2) continue;
      if (g.building[n] !== -1 || g.terrain[n] === 2 || g.locked[n] === 1) continue;
      prev[n] = c;
      if (g.isRoad(n)) {
        found = n;
        break;
      }
      queue.push(n);
    }
  }
  if (found < 0) return [];
  const path: number[] = [];
  for (let c = found; c !== -1; c = prev[c]!) path.push(c);
  return path.reverse();
}

function buildCity(): GameSession {
  const s = new GameSession({ districtId: 'sisli', seed: 77 });
  s.resources = { ...UNLIMITED };
  s.bounds = { x0: 0, y0: 0, x1: s.sim.grid.width - 1, y1: s.sim.grid.height - 1 };
  const sim = s.sim;
  const g = sim.grid;
  const rng = new Random(5);
  const used = new Set(sim.buildings.map((b) => b.name));
  for (let i = 0; i < 70; i++) {
    const kind = i % 3 === 0 ? 'ticari' : 'konut';
    const site = findSite(g, sim.buildings, kind, rng, {
      center: [32, 32],
      minRadius: 0,
      maxRadius: 30,
      minDistance: 1,
    });
    if (!site) continue;
    const name = buildingName(s.district, kind, rng, used);
    used.add(name);
    const b = makeBuilding(sim.buildings.length + 100, kind, 0, site, name, -1000);
    placeBuilding(g, b);
    sim.buildings.push(b);
  }
  // Street grid every 7 cells, split around buildings and parks.
  for (let k = 3; k < 62; k += 7) {
    for (const horizontal of [true, false]) {
      let run: number[] = [];
      for (let t = 1; t < 63; t++) {
        const c = horizontal ? g.idx(t, k) : g.idx(k, t);
        if (g.building[c] !== -1 || g.terrain[c] === 2) {
          if (run.length > 1) s.edit('road', run);
          run = [];
        } else run.push(c);
      }
      if (run.length > 1) s.edit('road', run);
    }
  }
  setBoulevard(g, segment(g, 1, 31, 62, 31), UNLIMITED);
  setBoulevard(g, segment(g, 31, 1, 31, 62), UNLIMITED);
  for (const b of sim.buildings) {
    const p = pathToRoad(s, b.door);
    if (p.length > 1) s.edit('road', p);
  }
  sim.rebuildNetwork();
  return s;
}

describe('performance and stability', () => {
  it('runs 15 simulated minutes with ~500 vehicles without errors, leaks or overlaps', () => {
    const s = buildCity();
    const sim = s.sim;
    const tripRng = new Random(99);
    const homes = sim.buildings.filter((b) => b.kind === 'konut');
    const places = sim.buildings.filter((b) => b.kind !== 'konut');
    // This test injects its own trips; the game's pin generator and overflow rule are off.
    sim.demandEnabled = false;
    s.start();
    const ticks = (15 * 60) / DT;
    const durations: number[] = [];
    let maxActive = 0;
    let activeSum = 0;
    const heapStart = process.memoryUsage().heapUsed;
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      // Weekly rewards would pause the session; pick one immediately.
      if (s.pendingUpgrades) s.chooseUpgrade(0);
      // Top up demand beyond the game's rate cap to hold ~500 simultaneous vehicles.
      for (let k = 0; k < 4 && sim.vehicles.length + sim.totalPending() < 560; k++) {
        const o = tripRng.pick(homes);
        const d = tripRng.pick(places);
        if (o.pending.length < 6 && sim.reachable(o, d)) {
          o.pending.push({ id: sim.nextTripId++, origin: o.id, destination: d.id, createdAt: sim.time });
        }
      }
      const a = performance.now();
      s.step();
      durations.push(performance.now() - a);
      maxActive = Math.max(maxActive, sim.vehicles.length);
      activeSum += sim.vehicles.length;
      if (i % 200 === 0) {
        assertNoOverlap(sim);
        for (const v of sim.vehicles) {
          expect(Number.isFinite(v.s) && Number.isFinite(v.v)).toBe(true);
          expect(v.v).toBeGreaterThanOrEqual(0);
        }
      }
    }
    const wall = (performance.now() - t0) / 1000;
    durations.sort((x, y) => x - y);
    const mean = durations.reduce((x, y) => x + y, 0) / durations.length;
    const p95 = durations[Math.floor(durations.length * 0.95)]!;
    const p99 = durations[Math.floor(durations.length * 0.99)]!;
    const heapEnd = process.memoryUsage().heapUsed;
    const report = {
      simulatedMinutes: 15,
      wallSeconds: +wall.toFixed(1),
      buildings: sim.buildings.length,
      edges: sim.graph.edges.size,
      nodes: sim.graph.nodes.size,
      maxActive,
      meanActive: Math.round(activeSum / ticks),
      spawned: sim.stats.spawned,
      completed: sim.stats.completed,
      failed: sim.stats.failed,
      failedByReason: sim.stats.failedByReason,
      gridlocksNow: sim.gridlocks.length,
      longestQueueEver: sim.stats.longestQueueEver,
      tickMeanMs: +mean.toFixed(3),
      tickP95Ms: +p95.toFixed(3),
      tickP99Ms: +p99.toFixed(3),
      heapDeltaMB: +((heapEnd - heapStart) / 1048576).toFixed(1),
      routeCacheSize: sim.routes.size,
    };
    process.stdout.write(`PERF ${JSON.stringify(report)}
`);
    expect(maxActive).toBeGreaterThanOrEqual(450);
    // The network must keep flowing under load (trips here span the whole district).
    expect(sim.stats.completed).toBeGreaterThan(500);
    expect(sim.gridlocks).toHaveLength(0);
    // A 20 Hz simulation must fit into its 50 ms budget with plenty of room for rendering.
    expect(p95).toBeLessThan(16);
    s.dispose();
  });
});
