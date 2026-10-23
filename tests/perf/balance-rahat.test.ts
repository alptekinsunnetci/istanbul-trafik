import { expect, it } from 'vitest';
import { DISTRICTS } from '../../src/map/districts';
import { playBot } from './bot';

/** Several seeds per district, so one unlucky layout does not decide the balance. */
const SEEDS = [11, 23, 37];

it('balance: bot plays every district in rahat mode', () => {
  const rows = DISTRICTS.flatMap((d) =>
    SEEDS.map((seed) => ({ seed, ...playBot(d.id, 'rahat', seed, 1500) })),
  );
  console.warn(JSON.stringify(rows));
  for (const r of rows) expect(r.score).toBeGreaterThan(0);
});
