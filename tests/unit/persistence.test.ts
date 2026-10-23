import { describe, expect, it } from 'vitest';
import { DT } from '../../src/core/constants';
import { GameSession } from '../../src/gameplay/game-session';
import { restoreSession, toSnapshot } from '../../src/gameplay/snapshot';
import { DEFAULT_SETTINGS } from '../../src/persistence/save-schema';
import { MemoryStore, SaveManager, STORAGE_KEYS } from '../../src/persistence/save-manager';
import { createVehicle } from '../../src/traffic/vehicle-model';
import { connectAll } from '../helpers';

function playedSession(): GameSession {
  const s = new GameSession({ districtId: 'kadikoy', seed: 21 });
  connectAll(s);
  s.start();
  for (let i = 0; i < 70 / DT; i++) s.step();
  return s;
}

describe('persistence', () => {
  it('falls back to defaults for corrupt settings and reports it', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.settings, '{not json');
    const sm = new SaveManager(store);
    const r = sm.loadSettings();
    expect(r.value).toEqual(DEFAULT_SETTINGS);
    expect(r.warning).toBeDefined();
    expect(store.getItem(STORAGE_KEYS.settings)).toBeNull();
  });

  it('rejects out-of-range setting values', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.settings, JSON.stringify({ ...DEFAULT_SETTINGS, volume: 7 }));
    const r = new SaveManager(store).loadSettings();
    expect(r.value.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(r.warning).toBeDefined();
  });

  it('migrates unversioned settings', () => {
    const store = new MemoryStore();
    store.setItem(STORAGE_KEYS.settings, JSON.stringify({ volume: 0.2, muted: true }));
    const r = new SaveManager(store).loadSettings();
    expect(r.warning).toBeUndefined();
    expect(r.value.volume).toBe(0.2);
    expect(r.value.muted).toBe(true);
  });

  it('handles invalid and tampered game saves safely', () => {
    const store = new MemoryStore();
    const sm = new SaveManager(store);
    for (const bad of ['null', '[]', '{"version":99}', '{"version":1,"width":"x"}', 'garbage']) {
      store.setItem(STORAGE_KEYS.save, bad);
      const r = sm.loadGame();
      expect(r.value).toBeNull();
      expect(r.warning).toBeDefined();
      expect(sm.hasSavedGame()).toBe(false);
    }
    const s = playedSession();
    const snap = toSnapshot(s);
    s.dispose();
    const tampered = structuredClone(snap);
    tampered.buildings[0]!.x = 5000;
    store.setItem(STORAGE_KEYS.save, JSON.stringify(tampered));
    expect(sm.loadGame().value).toBeNull();

    // Structurally valid, but the vehicle is on a road that does not exist.
    const semantic = structuredClone(snap);
    const ghost = createVehicle(
      semantic.nextVehicleId - 1 + 1000,
      'car',
      { id: 1, origin: 0, destination: 1 },
      ['1>1'],
      0,
      1,
      0.5,
    );
    semantic.nextVehicleId += 2000;
    semantic.vehicles.push(ghost);
    expect(() => restoreSession(semantic)).toThrow(/yolda/);
  });

  it('round-trips an active game and continues identically', () => {
    const original = playedSession();
    const store = new MemoryStore();
    const sm = new SaveManager(store);
    expect(sm.saveGame(toSnapshot(original)).ok).toBe(true);
    const loaded = sm.loadGame();
    expect(loaded.warning).toBeUndefined();
    const restored = restoreSession(loaded.value!);
    expect(restored.sim.stateHash()).toBe(original.sim.stateHash());
    expect(restored.resources).toEqual(original.resources);
    for (let i = 0; i < 30 / DT; i++) {
      original.step();
      restored.step();
    }
    expect(restored.sim.stateHash()).toBe(original.sim.stateHash());
    original.dispose();
    restored.dispose();
  });

  it('keeps best scores per district and reports write failures', () => {
    const sm = new SaveManager(new MemoryStore());
    const summary = {
      districtId: 'kadikoy',
      districtName: 'Kadıköy',
      seed: 1,
      score: 120,
      duration: 300,
      week: 3,
      completed: 20,
      failed: 3,
      spawned: 25,
      averageTravelTime: 40,
      averageWaitTime: 5,
      onTimeRate: 0.8,
      efficiency: 0.7,
      longestQueue: 4,
      reason: 'test',
      mode: 'normal' as const,
      finishedAt: new Date(0).toISOString(),
    };
    expect(sm.addResult(summary).newBest).toBe(true);
    expect(sm.addResult({ ...summary, score: 80 }).newBest).toBe(false);
    expect(sm.loadRecords().value.bestScores['kadikoy:normal']).toBe(120);
    // Other modes keep their own records.
    expect(sm.addResult({ ...summary, score: 50, mode: 'rahat' }).newBest).toBe(true);
    expect(sm.loadRecords().value.history).toHaveLength(3);

    const failing = new SaveManager({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    });
    const w = failing.saveSettings(DEFAULT_SETTINGS);
    expect(w.ok).toBe(false);
    expect(w.error).toMatch(/dolu/);
    expect(new SaveManager(null).saveSettings(DEFAULT_SETTINGS).ok).toBe(false);
  });
});
