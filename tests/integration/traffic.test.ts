import { describe, expect, it } from 'vitest';
import { DT, IDM, MODES, STATS } from '../../src/core/constants';
import type { Building } from '../../src/core/world-state';
import type { GameSummary } from '../../src/gameplay/game-over';
import { GameSession } from '../../src/gameplay/game-session';
import { eraseRoad } from '../../src/map/road-editor';
import { pinsAt } from '../../src/traffic/demand-generator';
import { laneKey } from '../../src/traffic/lane-manager';
import { addBuilding, addTrip, assertNoOverlap, makeSim, play, road, runFor, testGrid } from '../helpers';

describe('traffic integration', () => {
  it('vehicles drive between two connected buildings and arrive', () => {
    const g = testGrid();
    const buildings: Building[] = [];
    const home = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const shop = addBuilding(g, buildings, 'ticari', 19, 10, 3);
    road(g, [3, 10], [12, 10], [12, 14], [18, 14], [18, 10]);
    const sim = makeSim(g, buildings);
    addTrip(sim, home, shop, 5);
    let maxSpeed = 0;
    runFor(sim, 90, () => {
      assertNoOverlap(sim);
      for (const v of sim.vehicles) maxSpeed = Math.max(maxSpeed, v.v);
    });
    expect(sim.stats.completed).toBe(5);
    expect(sim.stats.failed).toBe(0);
    expect(sim.vehicles).toHaveLength(0);
    expect(maxSpeed).toBeGreaterThan(8);
    expect(maxSpeed).toBeLessThanOrEqual(13.9 * 1.05 + 1e-6);
  });

  it('heavy traffic through a conflicting junction forms queues without collisions', () => {
    const g = testGrid(30, 30);
    const buildings: Building[] = [];
    const west = addBuilding(g, buildings, 'konut', 2, 14, 1);
    const north = addBuilding(g, buildings, 'konut', 14, 2, 2);
    const east = addBuilding(g, buildings, 'ticari', 26, 14, 3);
    const south = addBuilding(g, buildings, 'ticari', 14, 26, 0);
    road(g, [3, 14], [25, 14]);
    road(g, [14, 3], [14, 25]);
    const sim = makeSim(g, buildings);
    addTrip(sim, west, east, 6);
    addTrip(sim, north, south, 6);
    addTrip(sim, east, south, 6);
    addTrip(sim, south, north, 6);
    let sawQueue = false;
    let maxHolders = 0;
    runFor(sim, 240, () => {
      assertNoOverlap(sim);
      if (sim.queues.snapshot.longestQueue >= 2) sawQueue = true;
      // At most 4 vehicles can hold zones of one junction (one per quadrant).
      const inBox = sim.vehicles.filter((v) => v.junction && v.junction.node === g.idx(14, 14));
      const zones = inBox.flatMap((v) => v.junction!.zones);
      expect(new Set(zones).size).toBe(zones.length);
      maxHolders = Math.max(maxHolders, inBox.length);
    });
    expect(sawQueue).toBe(true);
    expect(sim.stats.longestQueueEver).toBeGreaterThanOrEqual(2);
    expect(sim.stats.completed).toBe(24);
    expect(maxHolders).toBeGreaterThanOrEqual(1);
  });

  it('an alternative road takes load off a congested corridor', () => {
    const scenario = (withAlternative: boolean) => {
      const g = testGrid(28, 20);
      const b: Building[] = [];
      const homes = [
        addBuilding(g, b, 'konut', 2, 8, 1),
        addBuilding(g, b, 'konut', 2, 10, 1),
        addBuilding(g, b, 'konut', 2, 12, 1),
      ];
      const shop = addBuilding(g, b, 'ticari', 23, 10, 3);
      road(g, [3, 8], [3, 12]);
      road(g, [3, 10], [22, 10]);
      if (withAlternative) road(g, [3, 8], [3, 5], [22, 5], [22, 10]);
      const sim = makeSim(g, b);
      const usedEdges = new Set<string>();
      runFor(sim, 200, () => {
        if (sim.tick % 40 === 0 && sim.time < 150) for (const h of homes) addTrip(sim, h, shop, 1);
        for (const v of sim.vehicles) usedEdges.add(v.edge);
        assertNoOverlap(sim);
      });
      const altEdges = [...usedEdges].filter((id) => sim.graph.edge(id)?.cells.some((c) => g.cy(c) === 5));
      return { sim, altEdges, completed: sim.stats.completed, failed: sim.stats.failed };
    };
    const base = scenario(false);
    const alt = scenario(true);
    expect(base.sim.stats.longestQueueEver).toBeGreaterThanOrEqual(3);
    expect(alt.altEdges.length).toBeGreaterThan(0);
    expect(alt.completed).toBeGreaterThan(base.completed);
    expect(alt.failed).toBeLessThanOrEqual(base.failed);
  });

  it('vehicles re-route when a road on their path is deleted', () => {
    const g = testGrid(26, 20);
    const buildings: Building[] = [];
    const home = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const shop = addBuilding(g, buildings, 'ticari', 21, 10, 3);
    road(g, [3, 10], [20, 10]);
    road(g, [3, 10], [3, 5], [20, 5], [20, 10]);
    const sim = makeSim(g, buildings);
    addTrip(sim, home, shop, 4);
    runFor(sim, 4);
    const onMain = sim.vehicles.filter((v) => sim.graph.edge(v.edge)?.cells.every((c) => g.cy(c) === 10));
    expect(onMain.length).toBeGreaterThan(0);
    // Delete a cell well ahead of the vehicles on the main road.
    expect(eraseRoad(g, [g.idx(17, 10)]).ok).toBe(true);
    const result = sim.rebuildNetwork();
    expect(result.failedVehicles).toBe(0);
    runFor(sim, 150, () => assertNoOverlap(sim));
    expect(sim.stats.completed).toBe(4);
    expect(sim.stats.failed).toBe(0);
  });

  it('a full junction exit blocks entry and the queue spills back upstream', () => {
    const g = testGrid(30, 22);
    const buildings: Building[] = [];
    const west = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const north = addBuilding(g, buildings, 'konut', 6, 3, 2);
    const east = addBuilding(g, buildings, 'ticari', 26, 10, 3);
    const south = addBuilding(g, buildings, 'ticari', 10, 18, 0);
    road(g, [3, 10], [25, 10]);
    road(g, [6, 4], [6, 10]); // junction J at (6,10)
    road(g, [10, 10], [10, 17]); // junction K at (10,10)
    const sim = makeSim(g, buildings);
    const J = g.idx(6, 10);
    const jkId = `${J}>1`;
    const eastBoundOnJK = () =>
      sim.vehicles.filter((v) => v.destination === east.id && v.edge === jkId).length;
    addTrip(sim, north, east, 3);
    for (let t = 0; t < 60 && eastBoundOnJK() < 1; t += DT) sim.step();
    expect(eastBoundOnJK()).toBeGreaterThanOrEqual(1);
    // Cut the road just past K: the east-bound vehicle on J→K loses its route and stops at K,
    // so everything behind it on J→K queues up until the lane is full.
    eraseRoad(g, [g.idx(14, 10)]);
    sim.rebuildNetwork();
    addTrip(sim, west, south, 14);
    let spillback = false;
    runFor(sim, 35, () => {
      assertNoOverlap(sim);
      const jk = sim.graph.edge(jkId)!;
      const last = sim.lanes.last(laneKey(jk.index, 0));
      const free = (last ? last.s - last.length : jk.length) - sim.junctions.reservedOn(laneKey(jk.index, 0));
      const waiting = sim.vehicles.find((v) => {
        const e = sim.graph.edge(v.edge);
        return (
          !v.junction &&
          v.destination === south.id &&
          e !== undefined &&
          e.to === J &&
          v.route[v.routeIndex + 1] === jkId &&
          e.length - v.s < 2 &&
          v.v < STATS.queueSpeed
        );
      });
      if (waiting && free < waiting.length + IDM.minGap) spillback = true;
    });
    expect(spillback).toBe(true);
    runFor(sim, 300, () => assertNoOverlap(sim));
    expect(sim.stats.failedByReason.noRoute).toBeGreaterThan(0);
    expect(south.completed).toBe(14);
    expect(sim.vehicles).toHaveLength(0);
  });

  it('unreachable trips wait instead of failing and move to a reachable house of the same colour', () => {
    const g = testGrid();
    const buildings: Building[] = [];
    const lonely = addBuilding(g, buildings, 'konut', 2, 4, 1);
    const home = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const shop = addBuilding(g, buildings, 'ticari', 19, 10, 3);
    road(g, [3, 10], [18, 10]);
    const sim = makeSim(g, buildings);
    addTrip(sim, lonely, shop, 3);
    runFor(sim, 10);
    expect(lonely.unreachable).toBe(true);
    expect(sim.vehicles).toHaveLength(0);
    expect(sim.stats.failed).toBe(0);
    expect(lonely.pending).toHaveLength(3);

    // With demand switched on (but no new pins), the trips are reassigned to the connected house.
    shop.pinTimer = 1e9;
    sim.demandEnabled = true;
    runFor(sim, 60);
    expect(lonely.pending).toHaveLength(0);
    expect(sim.stats.completed).toBe(3);
    expect(home.completed + shop.completed).toBeGreaterThanOrEqual(3);
  });

  it('pins accumulate on a workplace, its overflow timer fills and drains', () => {
    const g = testGrid();
    const buildings: Building[] = [];
    const home = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const shop = addBuilding(g, buildings, 'ticari', 19, 10, 3);
    const sim = makeSim(g, buildings);
    sim.demandEnabled = true;
    runFor(sim, 120);
    expect(pinsAt(sim.buildings, shop)).toBeGreaterThanOrEqual(MODES.zor.overflowPins);
    expect(shop.overflow).toBeGreaterThan(0);
    expect(home.pending.length).toBe(pinsAt(sim.buildings, shop));
    // Connecting the house lets cars serve the pins, and the timer drains.
    road(g, [3, 10], [18, 10]);
    sim.rebuildNetwork();
    const peak = shop.overflow;
    runFor(sim, 120);
    expect(sim.stats.completed).toBeGreaterThan(5);
    expect(shop.overflow).toBeLessThan(peak);
  });

  it('game over when a workplace overflows; the summary reflects the real statistics', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 2 });
    let summary: GameSummary | null = null;
    s.events.on('gameOver', (x) => (summary = x));
    s.start();
    play(s, 20 * 60);
    expect(s.phase).toBe('over');
    expect(summary).not.toBeNull();
    const sm = s.summary!;
    expect(sm.reason).toMatch(/taştı/);
    expect(sm.completed).toBe(s.sim.stats.completed);
    expect(sm.duration).toBeCloseTo(s.sim.time);
    expect(sm.score).toBe(s.score.score);
    expect(sm.districtName).toBe('Şişli');
    const time = s.sim.time;
    for (let i = 0; i < 100; i++) s.step();
    expect(s.sim.time).toBe(time);
    s.dispose();
  });
});
