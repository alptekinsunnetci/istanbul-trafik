/**
 * Two interface languages: Turkish (the original) and English. The language
 * is chosen before the interface is built; changing it reloads the page.
 * Place names (districts, neighbourhoods, seas, highways) stay in Turkish.
 */
export type Lang = 'tr' | 'en';

let current: Lang = 'tr';

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** The browser's preferred language, as one of ours. */
export function detectLang(languages: readonly string[]): Lang {
  for (const l of languages) {
    const code = l.toLowerCase();
    if (code.startsWith('tr')) return 'tr';
    if (code.startsWith('en')) return 'en';
  }
  return 'tr';
}

/** A text in the current language: `L('Geri al', 'Undo')`. */
export function L(tr: string, en: string): string {
  return current === 'en' ? en : tr;
}

/** English for fixed Turkish labels defined as data (modes, rewards, colours …). */
const EN: Record<string, string> = {
  // modes
  Rahat: 'Relaxed',
  Normal: 'Normal',
  Zor: 'Hard',
  'Oyun bitmez, sakin tempo': 'Never ends, calm pace',
  'Dengeli tempo': 'Balanced pace',
  'Hızlı tempo': 'Fast pace',
  // difficulty of districts
  Kolay: 'Easy',
  Orta: 'Medium',
  // weekly rewards
  '+15 yol': '+15 roads',
  '+5 köprü': '+5 bridges',
  '+10 bulvar': '+10 boulevards',
  '+2 trafik ışığı': '+2 traffic lights',
  '+2 göbek': '+2 roundabouts',
  '+1 vapur/metro hattı': '+1 ferry/metro line',
  '+1 otopark': '+1 car park',
  'Daha fazla yol parçası': 'More road pieces',
  'Suyun ya da otoyolun üstünden geçmek için': 'To cross water or a highway',
  'İki şeritli, hızlı yollar': 'Two-lane, faster roads',
  'Kalabalık kavşakları sırayla akıt': 'Let busy junctions take turns',
  'Durmadan dönülen göbekli kavşak': 'A junction you drive round without stopping',
  'Yolcuları arabasız taşı': 'Carry people without cars',
  'İş yerine ikinci bir giriş': 'A second entrance for a workplace',
  // colours and buildings
  Mercan: 'Coral',
  Turkuaz: 'Turquoise',
  Sarı: 'Yellow',
  Mor: 'Purple',
  Yeşil: 'Green',
  Ev: 'House',
  'İş yeri': 'Workplace',
  'Şehir dışı bağlantısı': 'Highway exit',
  Durak: 'Station',
  Otopark: 'Car park',
  // vehicles
  Otomobil: 'Car',
  Taksi: 'Taxi',
  Dolmuş: 'Shared minibus',
  Otobüs: 'Bus',
  // seasons
  İlkbahar: 'Spring',
  Yaz: 'Summer',
  Sonbahar: 'Autumn',
  Kış: 'Winter',
  // parts of the day
  Gece: 'Night',
  Sabah: 'Morning',
  Öğle: 'Midday',
  Akşam: 'Evening',
};

/** Translates a fixed Turkish label when the interface is in English. */
export function t(tr: string): string {
  return current === 'en' ? (EN[tr] ?? tr) : tr;
}
