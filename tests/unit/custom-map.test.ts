import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/gameplay/game-session';
import { restoreSession, toSnapshot } from '../../src/gameplay/snapshot';
import {
  customDistrict,
  decodeMap,
  emptyMap,
  encodeMap,
  mapFromDistrict,
  mapProblem,
} from '../../src/map/custom-map';
import { districtById, registerDistrict } from '../../src/map/districts';
import { Terrain } from '../../src/map/grid';
import { migrateSave } from '../../src/persistence/migrations';
import { parseSavedGame } from '../../src/persistence/save-schema';
import { connectAll, play } from '../helpers';

function myMap() {
  const m = emptyMap();
  m.name = 'Deneme Koyu';
  // A sea on the left and a river through the middle.
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      if (x < 8 || (x > 30 && x < 33)) m.terrain[y * 64 + x] = Terrain.Water;
      if (x > 44 && x < 50 && y > 40 && y < 46) m.terrain[y * 64 + x] = Terrain.Park;
    }
  m.highways = [
    {
      name: 'OTOYOL 1',
      path: [
        [8, 20],
        [63, 20],
      ],
    },
  ];
  m.center = [20, 30];
  return m;
}

describe('map editor maps', () => {
  it('travel as a short code and come back the same', () => {
    const m = myMap();
    const code = encodeMap(m);
    // Short enough for a link.
    expect(code.length).toBeLessThan(2000);
    const back = decodeMap(code);
    expect(back.name).toBe('Deneme Koyu');
    expect(back.center).toEqual([20, 30]);
    expect(back.highways).toEqual(m.highways);
    expect([...back.terrain]).toEqual([...m.terrain]);
    expect(() => decodeMap('v1.bozuk!!')).toThrow();
    expect(() => decodeMap('v9.abc')).toThrow();
  });

  it('play like a district: highways, gateways, growth and saving', () => {
    const d = customDistrict(myMap());
    registerDistrict(d);
    expect(districtById(d.id)).toBe(d);
    const s = new GameSession({ districtId: d.id, seed: 5, mode: 'rahat' });
    expect(s.sim.buildings.filter((b) => b.kind === 'kapi')).toHaveLength(1);
    connectAll(s);
    s.start();
    play(s, 120);
    expect(s.score.score).toBeGreaterThan(0);
    const save = JSON.parse(JSON.stringify(toSnapshot(s))) as { customMap?: string };
    expect(save.customMap).toBe(d.code);
    const back = restoreSession(parseSavedGame(migrateSave(save)));
    expect(back.district.name).toBe('Deneme Koyu');
    expect(back.sim.grid.terrain).toEqual(s.sim.grid.terrain);
    back.dispose();
    s.dispose();
  });

  it('templates copy a district, and a start in the sea is refused', () => {
    const kadikoy = mapFromDistrict(districtById('kadikoy')!);
    expect(kadikoy.highways.length).toBeGreaterThan(0);
    expect(mapProblem(kadikoy)).toBeNull();
    const wet = emptyMap();
    wet.terrain.fill(Terrain.Water);
    expect(mapProblem(wet)).not.toBeNull();
  });
});
