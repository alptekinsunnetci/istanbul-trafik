import { describe, expect, it } from 'vitest';
import { EVENTS } from '../../src/core/constants';
import { DAY_LENGTH, clockText, darkness, demandFactor, hourAt } from '../../src/gameplay/daytime';
import { type CityEvent, GameSession } from '../../src/gameplay/game-session';
import { connectAll, play } from '../helpers';
import { restoreSession, toSnapshot } from '../../src/gameplay/snapshot';
import { parseSavedGame } from '../../src/persistence/save-schema';
import { migrateSave } from '../../src/persistence/migrations';

describe('time of day', () => {
  it('every day starts at 06:00 and runs through 24 hours', () => {
    expect(hourAt(0)).toBeCloseTo(6);
    expect(hourAt(DAY_LENGTH / 2)).toBeCloseTo(18);
    expect(hourAt(DAY_LENGTH)).toBeCloseTo(6);
    expect(clockText(8.6)).toBe('08:30');
  });

  it('rush hours are busier than noon, and nights are quiet and dark', () => {
    expect(demandFactor(8.5)).toBeGreaterThan(demandFactor(12.5));
    expect(demandFactor(17.5)).toBeGreaterThan(demandFactor(12.5));
    expect(demandFactor(2)).toBeLessThan(demandFactor(12.5));
    expect(darkness(12)).toBe(0);
    expect(darkness(1)).toBe(1);
  });
});

describe('city events', () => {
  it('come one at a time from week 3 and always end again', () => {
    const s = new GameSession({ districtId: 'besiktas', seed: 9, mode: 'rahat' });
    connectAll(s);
    s.start();
    const seen: CityEvent[] = [];
    s.events.on('cityEvent', (e) => {
      if (e) seen.push(e);
    });
    let rain = false;
    let closed = false;
    play(s, 1500, () => {
      if (s.sim.time < (EVENTS.firstWeek - 1) * 90) expect(s.event).toBeNull();
      if (s.event?.kind === 'yagmur') {
        expect(s.sim.speedScale).toBe(EVENTS.rainSpeed);
        rain = true;
      }
      if (s.event?.kind === 'yol') {
        expect(s.sim.grid.closed[s.event.target]).toBe(1);
        closed = true;
      }
      if (!s.event) {
        expect(s.sim.speedScale).toBe(1);
        expect(s.sim.grid.closed.some((c) => c === 1)).toBe(false);
        expect(s.sim.demand.boosts.size).toBe(0);
      }
    });
    expect(seen.length).toBeGreaterThanOrEqual(5);
    expect(new Set(seen.map((e) => e.kind)).size).toBe(3);
    expect(rain && closed).toBe(true);
    s.dispose();
  });

  it('an event going on (and a flying gull) survives saving and loading', () => {
    const s = new GameSession({ districtId: 'besiktas', seed: 9, mode: 'rahat' });
    connectAll(s);
    s.start();
    // Play on until road works are going on.
    let guard = 0;
    while (s.event?.kind !== 'yol' && guard++ < 40_000) {
      if (s.pendingUpgrades) s.chooseUpgrade(0);
      s.step();
    }
    expect(s.event?.kind).toBe('yol');
    const save = parseSavedGame(migrateSave(JSON.parse(JSON.stringify(toSnapshot(s)))));
    const back = restoreSession(save);
    expect(back.event).toEqual(s.event);
    expect(back.sim.grid.closed[s.event!.target]).toBe(1);
    expect(back.nextEventAt).toBe(s.nextEventAt);
    expect(back.nextGullAt).toBe(s.nextGullAt);
    back.dispose();
    s.dispose();
  });
});
