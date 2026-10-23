import { buildingCells } from '../core/world-state';
import { DIRS, Terrain } from '../map/grid';
import { SAVE_VERSION, type SavedGame } from '../persistence/save-schema';
import { base64ToBytes, bytesToBase64 } from '../persistence/validate';
import { laneKey } from '../traffic/lane-manager';
import { GameSession } from './game-session';

/** Serialises a session that has not ended. Derived data (graph, lanes, caches) is not stored. */
export function toSnapshot(session: GameSession, now: Date = new Date()): SavedGame {
  if (session.phase === 'over') throw new Error('Biten oyun kaydedilemez');
  const sim = session.sim;
  const g = sim.grid;
  const clone = <T>(x: T): T => structuredClone(x);
  return {
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    districtId: session.district.id,
    seed: session.seed,
    width: g.width,
    height: g.height,
    phase: session.phase,
    time: sim.time,
    tick: sim.tick,
    resources: { ...session.resources },
    mode: session.mode,
    bounds: { ...session.bounds },
    week: session.week,
    colors: session.colors,
    nextGrowthAt: session.nextGrowthAt,
    growthCount: session.growthCount,
    pendingUpgrades: session.pendingUpgrades ? structuredClone(session.pendingUpgrades) : null,
    score: session.score.toState(),
    rng: sim.rng.getState(),
    growthRng: session.growthRng.getState(),
    demandReassign: sim.demand.reassignTimer,
    nextVehicleId: sim.nextVehicleId,
    nextTripId: sim.nextTripId,
    grid: {
      road: bytesToBase64(g.road),
      links: bytesToBase64(g.links),
      lanes: bytesToBase64(g.lanes),
      locked: bytesToBase64(g.locked),
      signal: bytesToBase64(g.signal),
      overpass: bytesToBase64(g.overpass),
      paid: bytesToBase64(g.paid),
      roundabout: bytesToBase64(g.roundabout),
    },
    buildings: clone(sim.buildings),
    vehicles: clone(sim.vehicles),
    trailing: clone([...sim.trailing.values()]),
    stats: clone(sim.stats),
    junctionDelay: [...sim.queues.junctionDelay.entries()],
  };
}

/**
 * Rebuilds a session from a structurally valid save and checks its semantic
 * consistency against the regenerated district. Throws on any mismatch so
 * that a corrupt save never produces an inconsistent world.
 */
export function restoreSession(save: SavedGame): GameSession {
  const session = new GameSession({
    districtId: save.districtId,
    seed: save.seed,
    mode: save.mode,
    orientation: save.bounds.y1 - save.bounds.y0 > save.bounds.x1 - save.bounds.x0 ? 'tall' : 'wide',
    width: save.width,
    height: save.height,
  });
  try {
    applySnapshot(session, save);
  } catch (err) {
    session.dispose();
    throw err;
  }
  return session;
}

function applySnapshot(session: GameSession, save: SavedGame): void {
  const sim = session.sim;
  const g = sim.grid;
  const n = g.size;
  g.road.set(base64ToBytes(save.grid.road, n, 'grid.road'));
  g.links.set(base64ToBytes(save.grid.links, n, 'grid.links'));
  g.lanes.set(base64ToBytes(save.grid.lanes, n, 'grid.lanes'));
  g.locked.set(base64ToBytes(save.grid.locked, n, 'grid.locked'));
  g.signal.set(base64ToBytes(save.grid.signal, n, 'grid.signal'));
  g.overpass.set(base64ToBytes(save.grid.overpass, n, 'grid.overpass'));
  // Older saves did not record free diagonal cells: every road cell counts as paid.
  if (save.grid.paid !== undefined) g.paid.set(base64ToBytes(save.grid.paid, n, 'grid.paid'));
  if (save.grid.roundabout !== undefined)
    g.roundabout.set(base64ToBytes(save.grid.roundabout, n, 'grid.roundabout'));
  else for (let i = 0; i < n; i++) g.paid[i] = g.road[i] === 1 && g.locked[i] === 0 ? 1 : 0;
  g.building.fill(-1);

  // Sanitise the road layer: links only between road cells, valid lane counts.
  for (let i = 0; i < n; i++) {
    if (g.isHighway(i) && (g.road[i] !== 1 || g.lanes[i] !== 2 || g.locked[i] !== 1))
      throw new Error('Kayıt: otoyol eksik');
    if (!g.isHighway(i)) g.overpass[i] = 0;
    if (g.road[i] !== 1) {
      g.road[i] = 0;
      g.links[i] = 0;
      g.lanes[i] = 0;
      g.locked[i] = 0;
      g.signal[i] = 0;
      g.overpass[i] = 0;
      g.roundabout[i] = 0;
      continue;
    }
    if (g.terrain[i] === Terrain.Park) throw new Error('Kayıt: park üzerinde yol');
    g.lanes[i] = g.lanes[i] === 2 ? 2 : 1;
    g.links[i] = (g.links[i] as number) & 0b1111;
    for (const d of DIRS) {
      if (g.hasLink(i, d) && !g.isRoad(g.neighbor(i, d))) g.setLink(i, d, false);
    }
  }
  const ids = new Set<number>();
  for (const b of save.buildings) {
    if (ids.has(b.id)) throw new Error('Kayıt: yinelenen bina kimliği');
    ids.add(b.id);
    if (b.x + b.w > g.width || b.y + b.h > g.height) throw new Error('Kayıt: bina harita dışında');
    for (const c of buildingCells(b, g.width)) {
      // Gateways sit where a highway leaves the map, which may be over water (a bridge).
      const groundOk = b.kind === 'kapi' || g.terrain[c] === Terrain.Land;
      if (!groundOk || g.isRoad(c) || g.building[c] !== -1) throw new Error('Kayıt: geçersiz bina konumu');
      g.building[c] = b.id;
    }
    if (!g.isRoad(b.door) || g.locked[b.door] !== 1) throw new Error('Kayıt: bina girişi eksik');
  }
  for (const b of save.buildings) {
    for (const t of b.pending) {
      if (!ids.has(t.destination) || t.origin !== b.id) throw new Error('Kayıt: geçersiz yolculuk talebi');
    }
  }
  g.touch();
  sim.buildings = save.buildings;
  sim.vehicles = [];
  sim.trailing.clear();
  sim.rebuildNetwork();

  const graph = sim.graph;
  const vehicleIds = new Set<number>();
  for (const v of save.vehicles) {
    if (vehicleIds.has(v.id)) throw new Error('Kayıt: yinelenen araç kimliği');
    vehicleIds.add(v.id);
    if (!ids.has(v.destination) || !ids.has(v.origin)) throw new Error('Kayıt: aracın hedefi yok');
    if (v.routeIndex >= v.route.length) throw new Error('Kayıt: geçersiz rota adımı');
    if (v.junction) {
      const to = graph.edge(v.junction.toEdge);
      if (!to || to.from !== v.junction.node) throw new Error('Kayıt: kavşaktaki araç tutarsız');
      if (v.junction.toLane >= to.lanes) throw new Error('Kayıt: geçersiz şerit');
    } else {
      const e = graph.edge(v.edge);
      if (!e) throw new Error('Kayıt: araç olmayan bir yolda');
      if (v.lane >= e.lanes || (v.laneChange && v.laneChange.to >= e.lanes))
        throw new Error('Kayıt: geçersiz şerit');
      if (v.route[v.routeIndex] !== v.edge) throw new Error('Kayıt: rota ile konum uyuşmuyor');
      v.s = Math.min(Math.max(v.s, 0), e.length);
      // Reservations obtained while approaching are re-requested.
      v.granted = null;
    }
    if (v.id >= save.nextVehicleId) throw new Error('Kayıt: araç sayacı tutarsız');
  }

  sim.vehicles = save.vehicles;
  sim.time = save.time;
  sim.tick = save.tick;
  sim.rng.setState(save.rng);
  sim.demand.reassignTimer = save.demandReassign;
  sim.nextVehicleId = save.nextVehicleId;
  sim.nextTripId = save.nextTripId;
  sim.stats = save.stats;
  sim.queues.junctionDelay.clear();
  for (const [id, d] of save.junctionDelay) if (graph.edges.has(id)) sim.queues.junctionDelay.set(id, d);

  for (const v of sim.vehicles) {
    if (!v.junction) continue;
    const to = graph.edge(v.junction.toEdge);
    if (to)
      sim.junctions.acquire(
        v.junction.node,
        v.junction.zones,
        v.junction.key,
        laneKey(to.index, v.junction.toLane),
        v.junction.reserved,
      );
  }
  for (const t of save.trailing) {
    const e = graph.edge(t.exitEdge);
    if (!e || !vehicleIds.has(t.vehicle) || t.exitLane >= e.lanes) continue;
    sim.trailing.set(t.vehicle, t);
    sim.junctions.acquire(t.node, t.zones, t.key, laneKey(e.index, t.exitLane), t.need);
  }

  session.resources = { ...save.resources };
  session.bounds = { ...save.bounds };
  session.week = save.week;
  session.colors = save.colors;
  session.nextGrowthAt = save.nextGrowthAt;
  session.growthCount = save.growthCount;
  session.pendingUpgrades = save.pendingUpgrades;
  session.score.load(save.score);
  session.growthRng.setState(save.growthRng);
  session.phase = save.phase;
}
