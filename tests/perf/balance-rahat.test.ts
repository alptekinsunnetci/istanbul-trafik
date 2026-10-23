import { expect, it } from 'vitest';
import { DISTRICTS } from '../../src/map/districts';
import { playBot } from './bot';

it('balance: bot plays every district in rahat mode', () => {
  const rows = DISTRICTS.map((d) => playBot(d.id, 'rahat', 11, 1500));
  console.warn(JSON.stringify(rows));
  for (const r of rows) expect(r.score).toBeGreaterThan(0);
});
