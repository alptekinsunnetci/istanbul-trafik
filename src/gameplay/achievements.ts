import { DISTRICTS } from '../map/districts';
import type { Records } from '../persistence/save-schema';
import type { GameSession } from './game-session';
import { L } from '../core/i18n';

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
    title: L('İlk yolculuk', 'First trip'),
    text: L('Bir arabayı iş yerine ulaştır.', 'Get a car to its workplace.'),
    check: (c) => c.session.score.score >= 1,
  },
  {
    id: 'yuz-yolculuk',
    title: L('Yüz yolculuk', 'A hundred trips'),
    text: L('Bir oyunda 100 yolculuk tamamla.', 'Finish 100 trips in one game.'),
    check: (c) => c.session.score.score >= 100,
  },
  {
    id: 'bin-yolculuk',
    title: L('Bin yolculuk', 'A thousand trips'),
    text: L('Bir oyunda 1000 yolculuk tamamla.', 'Finish 1000 trips in one game.'),
    check: (c) => c.session.score.score >= 1000,
  },
  {
    id: 'koprucu',
    title: L('Köprücü', 'Bridge builder'),
    text: L('Suyun üstüne bir köprü kur.', 'Build a bridge over water.'),
    check: (c) => {
      const g = c.session.sim.grid;
      for (let i = 0; i < g.size; i++) if (g.isRoad(i) && g.isBridge(i) && !g.isHighway(i)) return true;
      return false;
    },
  },
  {
    id: 'ust-gecit',
    title: L('Üst geçit', 'Overpass'),
    text: L('Otoyolun üstünden bir yol geçir.', 'Take a road over a highway.'),
    check: (c) => any(c.session.sim.grid.overpass),
  },
  {
    id: 'trafik-polisi',
    title: L('Trafik polisi', 'Traffic police'),
    text: L('Bir kavşağa trafik ışığı koy.', 'Put a traffic light on a junction.'),
    check: (c) => any(c.session.sim.grid.signal),
  },
  {
    id: 'gobek',
    title: L('Göbek', 'Roundabout'),
    text: L('Bir göbekli kavşak yap.', 'Build a roundabout.'),
    check: (c) => any(c.session.sim.grid.roundabout),
  },
  {
    id: 'hat',
    title: L('Hat açıldı', 'Line open'),
    text: L('Bir vapur ya da metro hattı kur.', 'Build a ferry or metro line.'),
    check: (c) => c.session.sim.buildings.some((b) => b.kind === 'durak'),
  },
  {
    id: 'yolcu',
    title: L('İskeleden çıkış', 'Off the ferry'),
    text: L(
      'Vapur ya da metroyla gelen biri işine ulaşsın.',
      'Get someone who came by ferry or metro to work.',
    ),
    check: (c) => counter(c, 'transit') >= 1,
  },
  {
    id: 'yuz-yolcu',
    title: L('Toplu taşıma', 'Public transport'),
    text: L('Toplam 100 kişiyi vapur ya da metroyla taşı.', 'Carry 100 people by ferry or metro in total.'),
    check: (c) => counter(c, 'transit') >= 100,
  },
  {
    id: 'marti',
    title: L('Simitçi martı', 'Simit-loving gull'),
    text: L('Bir martı yakala.', 'Catch a gull.'),
    check: (c) => counter(c, 'gulls') >= 1,
  },
  {
    id: 'marti-avcisi',
    title: L('Martı avcısı', 'Gull catcher'),
    text: L('Toplam 10 martı yakala.', 'Catch 10 gulls in total.'),
    check: (c) => counter(c, 'gulls') >= 10,
  },
  {
    id: 'hafta-5',
    title: L('Beşinci hafta', 'Fifth week'),
    text: L('Bir oyunda 5. haftaya ulaş.', 'Reach week 5 in a game.'),
    check: (c) => c.session.week >= 5,
  },
  {
    id: 'hafta-10',
    title: L('On hafta', 'Ten weeks'),
    text: L('Bir oyunda 10. haftaya ulaş.', 'Reach week 10 in a game.'),
    check: (c) => c.session.week >= 10,
  },
  {
    id: 'zor-10',
    title: L('Trafik ustası', 'Traffic master'),
    text: L('Zor modda 10. haftaya ulaş.', 'Reach week 10 on Hard.'),
    check: (c) => c.session.mode === 'zor' && c.session.week >= 10,
  },
  {
    id: 'gunluk',
    title: L('Günün haritası', 'Daily map'),
    text: L('Günün haritasını bitir.', 'Finish a daily map.'),
    check: (c) => counter(c, 'daily') >= 1,
  },
  {
    id: 'istanbul-turu',
    title: L('İstanbul turu', 'Istanbul tour'),
    text: L('12 ilçenin hepsinde bir oyun bitir.', 'Finish a game in all 12 districts.'),
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
