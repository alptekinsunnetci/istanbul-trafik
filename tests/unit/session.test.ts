import { describe, expect, it } from 'vitest';
import { DT } from '../../src/core/constants';
import { FixedStepper } from '../../src/core/fixed-step';
import { Random } from '../../src/core/random';
import { Simulation } from '../../src/core/simulation';
import { GameSession } from '../../src/gameplay/game-session';
import { DISTRICTS } from '../../src/map/districts';
import { Grid, Terrain } from '../../src/map/grid';
import { BUILDING_TYPES, type Building, buildingCells } from '../../src/core/world-state';
import { addBuilding, addTrip, connectAll, makeSim, play, road, runFor, testGrid } from '../helpers';

describe('vehicles and trips', () => {
  it('removes a vehicle that reached its destination and updates counters', () => {
    const g = testGrid();
    const buildings: Building[] = [];
    const home = addBuilding(g, buildings, 'konut', 2, 10, 1);
    const shop = addBuilding(g, buildings, 'ticari', 18, 10, 3);
    road(g, [3, 10], [17, 10]);
    const sim = makeSim(g, buildings);
    addTrip(sim, home, shop);
    runFor(sim, 1);
    expect(sim.vehicles).toHaveLength(1);
    expect(shop.incoming).toBe(1);
    runFor(sim, 40);
    expect(sim.vehicles).toHaveLength(0);
    expect(sim.stats.completed).toBe(1);
    expect(shop.incoming).toBe(0);
    expect(shop.completed).toBe(1);
    expect(sim.junctions.busyNodeCount()).toBe(0);
    expect(sim.trailing.size).toBe(0);
  });
});

describe('game session lifecycle', () => {
  it('does not advance time while not running (ready / paused at app level)', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 5 });
    for (let i = 0; i < 100; i++) s.step();
    expect(s.sim.time).toBe(0);
    s.start();
    s.step();
    expect(s.sim.time).toBeCloseTo(DT);
    s.dispose();
  });

  it('a paused stepper produces no simulation steps and clamps long gaps', () => {
    const st = new FixedStepper(0.05, 12, 0.25);
    expect(st.advance(1, 1, true).steps).toBe(0);
    expect(st.advance(0.1, 1, false).steps).toBe(2);
    // A 10-second background gap counts as at most 0.25 s.
    expect(st.advance(10, 1, false).steps).toBe(5);
    expect(st.advance(0.25, 4, false).steps).toBe(12);
  });

  it('restarting creates a clean session and releases old listeners', () => {
    const a = new GameSession({ districtId: 'besiktas', seed: 11 });
    connectAll(a);
    a.start();
    for (let i = 0; i < 60 / DT; i++) a.step();
    expect(a.sim.stats.spawned).toBeGreaterThan(0);
    a.dispose();
    expect(a.sim.events.listenerCount()).toBe(0);
    expect(a.events.listenerCount()).toBe(0);
    const b = new GameSession({ districtId: 'besiktas', seed: 11 });
    expect(b.sim.time).toBe(0);
    expect(b.sim.vehicles).toHaveLength(0);
    expect(b.sim.stats.completed).toBe(0);
    expect(b.score.score).toBe(0);
    expect(b.sim.buildings.every((x) => x.pending.length === 0)).toBe(true);
    expect(b.resources.roads).toBe(b.district.startRoads);
    expect(b.pendingUpgrades).toBeNull();
    b.dispose();
  });

  it('the same seed and inputs produce the same simulation', () => {
    const run = (seed: number): string => {
      const s = new GameSession({ districtId: 'uskudar', seed });
      connectAll(s);
      s.start();
      for (let i = 0; i < 90 / DT; i++) s.step();
      const h = s.sim.stateHash();
      s.dispose();
      return h;
    };
    expect(run(42)).toBe(run(42));
    expect(run(42)).not.toBe(run(43));
  });

  it('random generator is reproducible', () => {
    const a = new Random(7);
    const b = new Random(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
});

describe('maps', () => {
  it('every Istanbul district generates valid starting buildings', () => {
    for (const d of DISTRICTS) {
      const s = new GameSession({ districtId: d.id, seed: 1 });
      const g = s.sim.grid;
      expect(s.sim.buildings.length, d.name).toBeGreaterThanOrEqual(4);
      expect(s.sim.buildings.filter((b) => b.kind === 'ticari')).toHaveLength(1);
      expect(s.sim.buildings.every((b) => b.color === 0)).toBe(true);
      expect(s.sim.buildings.some((b) => b.kind === 'konut')).toBe(true);
      expect(s.sim.buildings.some((b) => b.kind !== 'konut')).toBe(true);
      for (const b of s.sim.buildings) {
        for (const c of buildingCells(b, g.width)) expect(g.terrain[c]).toBe(Terrain.Land);
        expect(g.locked[b.door]).toBe(1);
        expect(s.sim.graph.node(b.door)).toBeDefined();
        expect(b.w).toBe(BUILDING_TYPES[b.kind].w);
      }
      s.dispose();
    }
  });

  it('empty and disconnected maps never crash; an unconnected workplace overflows', () => {
    const empty = new Simulation(new Grid(16, 16), [], { seed: 1 });
    runFor(empty, 30);
    expect(empty.vehicles).toHaveLength(0);

    const s = new GameSession({ districtId: 'fatih', seed: 3 });
    s.start();
    play(s, 400);
    expect(s.sim.stats.spawned).toBe(0);
    expect(s.sim.buildings.some((b) => b.unreachable)).toBe(true);
    expect(s.phase).toBe('over');
    expect(s.summary?.reason).toMatch(/taştı/);
    s.dispose();
  });

  it('grows the city, offers weekly rewards and introduces a new colour', () => {
    const s = new GameSession({ districtId: 'bakirkoy', seed: 9 });
    const before = s.sim.buildings.length;
    connectAll(s);
    s.start();
    const roadsBefore = s.resources.roads;
    let rewards = 0;
    s.events.on('upgrade', () => rewards++);
    // Run until the first week ends and the reward is offered.
    while (!s.pendingUpgrades && s.phase === 'running') s.step();
    const time = s.sim.time;
    s.step();
    expect(s.sim.time).toBe(time); // waits for the choice
    const options = s.pendingUpgrades!;
    expect(options).toHaveLength(2);
    expect(options[0]!.kind).not.toBe(options[1]!.kind);
    const choice = s.chooseUpgrade(1)!;
    expect(s.resources[choice.kind]).toBeGreaterThanOrEqual(choice.amount);
    expect(s.resources.roads).toBe(roadsBefore + 20 + (choice.kind === 'roads' ? choice.amount : 0));
    expect(s.week).toBe(2);
    expect(s.colors).toBe(2);
    expect(s.sim.buildings.some((b) => b.color === 1 && b.kind === 'ticari')).toBe(true);
    expect(rewards).toBe(1);
    play(s, 60);
    expect(s.sim.buildings.length).toBeGreaterThan(before + 3);
    s.dispose();
  });
});
