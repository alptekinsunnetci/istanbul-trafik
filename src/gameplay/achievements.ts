import { DISTRICTS } from '../map/districts';
import type { Records } from '../persistence/save-schema';
import type { GameSession } from './game-session';

export interface AchievementContext {
  session: GameSession;
  records: Records;
}

export interface Achievement {
  id: string;
  title: string;
  text: string;
  check(c: AchievementContext): boolean;
}

const any = (a: Uint8Array): boolean => a.some((x) => x === 1);
const counter = (c: AchievementContext, name: string): number => c.records.counters[name] ?? 0;

/** Small goals that stay unlocked across games (stored with the records). */
export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: 'ilk-yolculuk',
    title: 'İlk yolculuk',
    text: 'Bir arabayı iş yerine ulaştır.',
    check: (c) => c.session.score.score >= 1,
  },
  {
    id: 'yuz-yolculuk',
    title: 'Yüz yolculuk',
    text: 'Bir oyunda 100 yolculuk tamamla.',
    check: (c) => c.session.score.score >= 100,
  },
  {
    id: 'bin-yolculuk',
    title: 'Bin yolculuk',
    text: 'Bir oyunda 1000 yolculuk tamamla.',
    check: (c) => c.session.score.score >= 1000,
  },
  {
    id: 'koprucu',
    title: 'Köprücü',
    text: 'Suyun üstüne bir köprü kur.',
    check: (c) => {
      const g = c.session.sim.grid;
      for (let i = 0; i < g.size; i++) if (g.isRoad(i) && g.isBridge(i) && !g.isHighway(i)) return true;
      return false;
    },
  },
  {
    id: 'ust-gecit',
    title: 'Üst geçit',
    text: 'Otoyolun üstünden bir yol geçir.',
    check: (c) => any(c.session.sim.grid.overpass),
  },
  {
    id: 'trafik-polisi',
    title: 'Trafik polisi',
    text: 'Bir kavşağa trafik ışığı koy.',
    check: (c) => any(c.session.sim.grid.signal),
  },
  {
    id: 'gobek',
    title: 'Göbek',
    text: 'Bir göbekli kavşak yap.',
    check: (c) => any(c.session.sim.grid.roundabout),
  },
  {
    id: 'hat',
    title: 'Hat açıldı',
    text: 'Bir vapur ya da metro hattı kur.',
    check: (c) => c.session.sim.buildings.some((b) => b.kind === 'durak'),
  },
  {
    id: 'yolcu',
    title: 'İskeleden çıkış',
    text: 'Vapur ya da metroyla gelen biri işine ulaşsın.',
    check: (c) => counter(c, 'transit') >= 1,
  },
  {
    id: 'yuz-yolcu',
    title: 'Toplu taşıma',
    text: 'Toplam 100 kişiyi vapur ya da metroyla taşı.',
    check: (c) => counter(c, 'transit') >= 100,
  },
  { id: 'marti', title: 'Simitçi martı', text: 'Bir martı yakala.', check: (c) => counter(c, 'gulls') >= 1 },
  {
    id: 'marti-avcisi',
    title: 'Martı avcısı',
    text: 'Toplam 10 martı yakala.',
    check: (c) => counter(c, 'gulls') >= 10,
  },
  {
    id: 'hafta-5',
    title: 'Beşinci hafta',
    text: 'Bir oyunda 5. haftaya ulaş.',
    check: (c) => c.session.week >= 5,
  },
  {
    id: 'hafta-10',
    title: 'On hafta',
    text: 'Bir oyunda 10. haftaya ulaş.',
    check: (c) => c.session.week >= 10,
  },
  {
    id: 'zor-10',
    title: 'Trafik ustası',
    text: 'Zor modda 10. haftaya ulaş.',
    check: (c) => c.session.mode === 'zor' && c.session.week >= 10,
  },
  {
    id: 'gunluk',
    title: 'Günün haritası',
    text: 'Günün haritasını bitir.',
    check: (c) => counter(c, 'daily') >= 1,
  },
  {
    id: 'istanbul-turu',
    title: 'İstanbul turu',
    text: '12 ilçenin hepsinde bir oyun bitir.',
    check: (c) => {
      const played = new Set(Object.keys(c.records.bestScores).map((k) => k.split(':')[0]));
      return DISTRICTS.every((d) => played.has(d.id));
    },
  },
];

/** Achievements that are reached now but were not unlocked before. */
export function newlyUnlocked(c: AchievementContext, unlocked: ReadonlySet<string>): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !unlocked.has(a.id) && a.check(c));
}
