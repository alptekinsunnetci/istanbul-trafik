import { hashString } from '../core/random';
import { DISTRICTS } from '../map/districts';

export interface DailyMap {
  /** Local date, YYYY-MM-DD. */
  key: string;
  /** "23.10.2026" for people. */
  label: string;
  districtId: string;
  seed: number;
}

/**
 * The daily map: the same district and seed for everybody on the same day,
 * a different district every day (round the twelve), played on Normal.
 */
export function dailyMap(now: Date): DailyMap {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const d = now.getDate();
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dayNumber = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const district = DISTRICTS[dayNumber % DISTRICTS.length] ?? DISTRICTS[0];
  return {
    key,
    label: `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`,
    districtId: district?.id ?? 'kadikoy',
    seed: hashString(`daily:${key}`) % 1_000_000_000,
  };
}

/** Text to share a daily result. */
export function dailyShareText(map: DailyMap, districtName: string, score: number, url: string): string {
  return `İstanbul Trafik · Günün haritası ${map.label} · ${districtName} · ${score} yolculuk\n${url}`;
}
