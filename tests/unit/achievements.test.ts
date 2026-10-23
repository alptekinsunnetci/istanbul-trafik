import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, newlyUnlocked } from '../../src/gameplay/achievements';
import { dailyMap, dailyShareText } from '../../src/gameplay/daily';
import { GameSession } from '../../src/gameplay/game-session';
import { DISTRICTS } from '../../src/map/districts';
import { emptyRecords, parseRecords } from '../../src/persistence/save-schema';
import { connectAll, play } from '../helpers';

describe('achievements', () => {
  it('unlock from what happens in the game and from running totals, once each', () => {
    const s = new GameSession({ districtId: 'kadikoy', seed: 4, mode: 'rahat' });
    const records = emptyRecords();
    expect(newlyUnlocked({ session: s, records }, new Set())).toHaveLength(0);
    connectAll(s);
    s.start();
    play(s, 200);
    const got = newlyUnlocked({ session: s, records }, new Set()).map((a) => a.id);
    expect(got).toContain('ilk-yolculuk');
    expect(got).not.toContain('marti');
    records.counters.gulls = 10;
    const more = newlyUnlocked({ session: s, records }, new Set(got)).map((a) => a.id);
    expect(more).toEqual(expect.arrayContaining(['marti', 'marti-avcisi']));
    expect(more).not.toContain('ilk-yolculuk');
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
    s.dispose();
  });

  it('older records without achievements still load', () => {
    const r = parseRecords({ version: 1, bestScores: { 'kadikoy:normal': 12 }, history: [] });
    expect(r.achievements).toEqual([]);
    expect(r.counters).toEqual({});
    expect(r.daily).toEqual({});
  });
});

describe('daily map', () => {
  it('is the same for everyone on a day and changes district day by day', () => {
    const a = dailyMap(new Date(2026, 9, 23, 9, 0));
    const b = dailyMap(new Date(2026, 9, 23, 22, 30));
    const c = dailyMap(new Date(2026, 9, 24, 9, 0));
    expect(a).toEqual(b);
    expect(a.key).toBe('2026-10-23');
    expect(a.label).toBe('23.10.2026');
    expect(c.districtId).not.toBe(a.districtId);
    expect(DISTRICTS.some((d) => d.id === a.districtId)).toBe(true);
    expect(dailyShareText(a, 'Kadıköy', 312, 'https://x/')).toContain('312 yolculuk');
  });
});
