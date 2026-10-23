import { describe, expect, it } from 'vitest';
import { AMBIENCE } from '../../src/core/constants';
import { GameSession } from '../../src/gameplay/game-session';
import { districtById } from '../../src/map/districts';
import { createDistrictGrid } from '../../src/map/map-generator';
import { metrobusRoutes } from '../../src/rendering/map-renderer';
import { play } from '../helpers';

describe('gulls', () => {
  it('fly over the Boğaz now and then, call a few times and can be caught for road pieces', () => {
    const s = new GameSession({ districtId: 'besiktas', seed: 5, mode: 'rahat' });
    let calls = 0;
    let caught: { roads: number } | null = null;
    s.events.on('gullCall', () => calls++);
    s.events.on('gullCaught', (g) => (caught = g));
    s.start();
    let seen = false;
    play(s, AMBIENCE.gullFirst + AMBIENCE.gullIntervalMax + 5, () => {
      if (s.gull) seen = true;
    });
    expect(seen).toBe(true);
    expect(calls).toBeGreaterThan(0);
    // Wait for the next gull and catch it.
    play(s, 200, () => {
      if (s.gull && !caught) {
        const before = s.resources.roads;
        expect(s.catchGull()).toBe(true);
        expect(s.resources.roads).toBe(before + AMBIENCE.gullReward);
        expect(s.gull).toBeNull();
      }
    });
    expect(caught).not.toBeNull();
    // Nothing to catch when no gull is flying.
    s.gull = null;
    expect(s.catchGull()).toBe(false);
    s.dispose();
  });

  it('never appear where there is no open water', () => {
    const s = new GameSession({ districtId: 'bagcilar', seed: 5, mode: 'rahat' });
    s.start();
    let seen = false;
    play(s, 300, () => {
      if (s.gull) seen = true;
    });
    expect(seen).toBe(false);
    s.dispose();
  });
});

describe('horns', () => {
  it('honk a few times in a heavy jam, then stay quiet until traffic has calmed down', () => {
    const s = new GameSession({ districtId: 'sisli', seed: 5, mode: 'rahat' });
    let horns = 0;
    s.events.on('horn', () => horns++);
    s.start();
    // A gridlock that does not go away (the simulation's own detection is bypassed).
    let jammed = true;
    const jam = [{ nodes: [0], vehicles: [] }] as unknown as typeof s.sim.gridlocks;
    Object.defineProperty(s.sim, 'gridlocks', {
      get: () => (jammed ? jam : []),
      set: () => undefined,
    });
    play(s, 120);
    expect(horns).toBe(AMBIENCE.hornMaxPerJam);
    // Calm for a while, then a new jam honks again.
    jammed = false;
    play(s, AMBIENCE.hornCalm + 3);
    jammed = true;
    play(s, 2);
    expect(horns).toBe(AMBIENCE.hornMaxPerJam + 1);
    s.dispose();
  });
});

describe('metrobüs', () => {
  it('runs only on the D-100 / O-1, from beyond one map edge to beyond the other', () => {
    const kadikoy = districtById('kadikoy')!;
    const routes = metrobusRoutes(createDistrictGrid(kadikoy), kadikoy);
    expect(routes).toHaveLength(1);
    const r = routes[0]!;
    const g = createDistrictGrid(kadikoy);
    const W = g.width * 16;
    const H = g.height * 16;
    const outside = (p: [number, number]): boolean => p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H;
    expect(outside(r[0]!)).toBe(true);
    expect(outside(r[r.length - 1]!)).toBe(true);
    const bagcilar = districtById('bagcilar')!;
    expect(metrobusRoutes(createDistrictGrid(bagcilar), bagcilar)).toHaveLength(0);
  });
});
