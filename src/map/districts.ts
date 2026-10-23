import { Terrain, type TerrainType } from './grid';

export type Difficulty = 'kolay' | 'orta' | 'zor';

/** Ground, water and park tint of a district's map. */
export interface DistrictPalette {
  land: number;
  water: number;
  park: number;
}

/** A place name written on the map: on a water body or inside a park (64×64 authoring cells). */
export interface MapLabel {
  text: string;
  x: number;
  y: number;
  kind: 'water' | 'park';
  /** Written along a north–south shore. */
  vertical?: boolean;
}

/**
 * A pre-built highway, as an axis-aligned polyline in 64×64 authoring cells.
 * An end on the map edge becomes a gateway where through traffic enters and
 * leaves the city.
 */
export interface Highway {
  name: string;
  path: readonly (readonly [number, number])[];
}

export interface District {
  id: string;
  name: string;
  tagline: string;
  difficulty: Difficulty;
  demandMultiplier: number;
  /** Road pieces available at the start. */
  startRoads: number;
  /** Neighbourhood names used for buildings. */
  neighbourhoods: string[];
  /** Preferred centre of the initial settlement, in cells. */
  center: [number, number];
  /** Stylised terrain: an original, simplified interpretation of the district's geography. */
  terrain(x: number, y: number, w: number, h: number): TerrainType;
  /** Soft ground, water and park tint of the district's map. */
  palette: DistrictPalette;
  labels: readonly MapLabel[];
  highways: readonly Highway[];
}

function inRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number): boolean {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function inEllipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number): boolean {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return dx * dx + dy * dy <= 1;
}

export const DISTRICTS: readonly District[] = [
  {
    id: 'kadikoy',
    name: 'Kadıköy',
    tagline: 'Moda sahilinden Bağdat Caddesi’ne uzanan Anadolu yakası merkezi.',
    difficulty: 'kolay',
    demandMultiplier: 0.85,
    startRoads: 40,
    neighbourhoods: [
      'Moda',
      'Caferağa',
      'Osmanağa',
      'Rasimpaşa',
      'Fenerbahçe',
      'Göztepe',
      'Caddebostan',
      'Erenköy',
      'Koşuyolu',
      'Acıbadem',
      'Feneryolu',
      'Suadiye',
      'Bostancı',
      'Hasanpaşa',
      'Zühtüpaşa',
      'Eğitim',
      'Merdivenköy',
      'Dumlupınar',
      'Fikirtepe',
      'Sahrayıcedit',
    ],
    center: [14, 29],
    palette: { land: 0xf4e7d6, water: 0x93c8da, park: 0xc2dcae },
    labels: [
      { text: 'MARMARA DENİZİ', x: 3, y: 26, kind: 'water', vertical: true },
      { text: 'KALAMIŞ', x: 13, y: 47, kind: 'water' },
      { text: 'YOĞURTÇU', x: 25.5, y: 20.5, kind: 'park' },
      { text: 'GÖZTEPE', x: 45, y: 44, kind: 'park' },
    ],
    highways: [
      {
        name: 'D-100',
        path: [
          [12, 0],
          [12, 24],
          [63, 24],
        ],
      },
    ],
    terrain(x, y) {
      const coast = 7 + 3 * Math.sin(y / 9) + (y > 40 ? (y - 40) * 0.22 : 0);
      if (x < coast) return Terrain.Water;
      if (inEllipse(x, y, 12, 47, 6.5, 4)) return Terrain.Water; // Kalamış koyu, open to the sea
      // Kurbağalıdere: comes down from Koşuyolu and flows into Kalamış.
      const dere = 30 - 0.35 * y + 2 * Math.sin(y / 5);
      if (y < 46 && Math.abs(x - dere) < 1.5) return Terrain.Water;
      if (inRect(x, y, 24, 19, 27, 22)) return Terrain.Park; // Yoğurtçu, beside the stream
      if (inEllipse(x, y, 45, 44, 3, 3)) return Terrain.Park; // Göztepe
      return Terrain.Land;
    },
  },
  {
    id: 'besiktas',
    name: 'Beşiktaş',
    tagline: 'Boğaz kıyısı, Levent kuleleri ve dar yokuşlarıyla yoğun bir ilçe.',
    difficulty: 'orta',
    demandMultiplier: 1,
    startRoads: 36,
    neighbourhoods: [
      'Levent',
      'Etiler',
      'Bebek',
      'Ortaköy',
      'Arnavutköy',
      'Balmumcu',
      'Dikilitaş',
      'Sinanpaşa',
      'Abbasağa',
      'Gayrettepe',
      'Kuruçeşme',
      'Ulus',
      'Akat',
      'Levazım',
      'Konaklar',
      'Nisbetiye',
      'Muradiye',
      'Vişnezade',
      'Türkali',
      'Yıldız',
    ],
    center: [48, 32],
    palette: { land: 0xebedee, water: 0x8bbcd8, park: 0xbcd9b6 },
    labels: [
      { text: 'İSTANBUL BOĞAZI', x: 58, y: 34, kind: 'water', vertical: true },
      { text: 'YILDIZ PARKI', x: 41, y: 33.5, kind: 'park' },
    ],
    highways: [
      {
        name: 'O-1',
        path: [
          [0, 27],
          [63, 27],
        ],
      },
    ],
    terrain(x, y) {
      if (x > 60) return Terrain.Land; // Anadolu yakası: Beylerbeyi
      const coast = 55 - 3 * Math.sin(y / 8) - y * 0.06;
      if (x > coast) return Terrain.Water;
      if (inRect(x, y, 38, 30, 44, 37)) return Terrain.Park; // Yıldız Parkı
      if (inRect(x, y, 26, 44, 28, 46)) return Terrain.Park; // Abbasağa
      return Terrain.Land;
    },
  },
  {
    id: 'uskudar',
    name: 'Üsküdar',
    tagline: 'Kuzguncuk’tan Çengelköy’e, koruların arasında kıvrılan sahil yolu.',
    difficulty: 'orta',
    demandMultiplier: 1,
    startRoads: 36,
    neighbourhoods: [
      'Kuzguncuk',
      'Beylerbeyi',
      'Çengelköy',
      'Altunizade',
      'Bulgurlu',
      'Ünalan',
      'Kısıklı',
      'Salacak',
      'Selimiye',
      'Valide-i Atik',
      'Mimar Sinan',
      'Aziz Mahmut Hüdayi',
      'İcadiye',
      'Burhaniye',
      'Ferah',
      'Küçüksu',
      'Kandilli',
      'Bahçelievler',
      'Murat Reis',
      'Sultantepe',
    ],
    center: [11, 31],
    palette: { land: 0xeff0de, water: 0x95c7cc, park: 0xb7d6a6 },
    labels: [
      { text: 'İSTANBUL BOĞAZI', x: 2, y: 36, kind: 'water', vertical: true },
      { text: 'VALİDEBAĞ', x: 32, y: 40, kind: 'park' },
      { text: 'FETHİ PAŞA', x: 17.5, y: 10.5, kind: 'park', vertical: true },
    ],
    highways: [
      {
        name: 'O-1',
        path: [
          [0, 26],
          [63, 26],
        ],
      },
    ],
    terrain(x, y) {
      const coast = 8 + 4 * Math.sin(y / 7) + (y < 20 ? (20 - y) * 0.3 : 0);
      if (x < coast) return Terrain.Water;
      if (inRect(x, y, 29, 37, 35, 43)) return Terrain.Park; // Validebağ Korusu
      if (inRect(x, y, 16, 8, 19, 13)) return Terrain.Park; // Fethi Paşa Korusu
      return Terrain.Land;
    },
  },
  {
    id: 'fatih',
    name: 'Fatih',
    tagline: 'Haliç ile Marmara arasında, tarihi yarımadanın dar sokakları.',
    difficulty: 'zor',
    demandMultiplier: 1.15,
    startRoads: 38,
    neighbourhoods: [
      'Balat',
      'Fener',
      'Sultanahmet',
      'Aksaray',
      'Kumkapı',
      'Eminönü',
      'Vefa',
      'Laleli',
      'Cerrahpaşa',
      'Samatya',
      'Zeyrek',
      'Süleymaniye',
      'Beyazıt',
      'Cankurtaran',
      'Ayvansaray',
      'Karagümrük',
      'Çarşamba',
      'Kocamustafapaşa',
      'Cibali',
      'Mercan',
    ],
    center: [32, 14],
    palette: { land: 0xf3e3d0, water: 0x8ec0d8, park: 0xc4dcae },
    labels: [
      { text: 'HALİÇ', x: 28, y: 12.5, kind: 'water' },
      { text: 'MARMARA DENİZİ', x: 28, y: 60, kind: 'water' },
      { text: 'GÜLHANE', x: 53, y: 25, kind: 'park' },
    ],
    highways: [
      {
        name: 'ATATÜRK BLV.',
        path: [
          [26, 0],
          [26, 30],
          [0, 30],
        ],
      },
    ],
    terrain(x, y) {
      // Haliç: a channel with the Beyoğlu shore on the far side, opening into the Boğaz.
      const halic = 14 + 1.5 * Math.sin(x / 6);
      const open = x > 44 ? x - 44 : 0;
      if (y < halic + 2.2 + open * 0.3 && y > halic - 2.2 - open * 0.6) return Terrain.Water;
      const marmara = 55 - 2 * Math.sin(x / 7) - (x > 44 ? (x - 44) * 0.2 : 0);
      if (y > marmara) return Terrain.Water;
      if (x > 60) return Terrain.Water; // Boğaz girişi
      if (inRect(x, y, 51, 22, 55, 28)) return Terrain.Park; // Gülhane
      return Terrain.Land;
    },
  },
  {
    id: 'sisli',
    name: 'Şişli',
    tagline: 'Mecidiyeköy’ün plazaları, Nişantaşı’nın caddeleri: denizsiz, yoğun bir iş merkezi.',
    difficulty: 'zor',
    demandMultiplier: 1.2,
    startRoads: 34,
    neighbourhoods: [
      'Mecidiyeköy',
      'Nişantaşı',
      'Teşvikiye',
      'Kurtuluş',
      'Feriköy',
      'Esentepe',
      'Bomonti',
      'Fulya',
      'Harbiye',
      'Pangaltı',
      'Halaskargazi',
      'Ergenekon',
      'Gülbahar',
      'Cumhuriyet',
      'Duatepe',
      'Kuştepe',
      'Mahmut Şevket Paşa',
      'Merkez',
      'İnönü',
      'Meşrutiyet',
    ],
    center: [32, 30],
    palette: { land: 0xece8ef, water: 0x9cc6dc, park: 0xbad8b0 },
    labels: [{ text: 'MAÇKA', x: 47.5, y: 49.5, kind: 'park' }],
    highways: [
      {
        name: 'D-100',
        path: [
          [0, 28],
          [63, 28],
        ],
      },
      {
        name: 'BÜYÜKDERE CD.',
        path: [
          [36, 0],
          [36, 28],
        ],
      },
    ],
    terrain(x, y) {
      if (inRect(x, y, 44, 46, 51, 53)) return Terrain.Park;
      if (inRect(x, y, 14, 18, 17, 21)) return Terrain.Park;
      if (inRect(x, y, 30, 54, 36, 57)) return Terrain.Park;
      return Terrain.Land;
    },
  },
  {
    id: 'bakirkoy',
    name: 'Bakırköy',
    tagline: 'Ataköy’den Yeşilköy’e uzanan sahil şeridi ve geniş bulvarlar.',
    difficulty: 'kolay',
    demandMultiplier: 0.9,
    startRoads: 40,
    neighbourhoods: [
      'Ataköy 1. Kısım',
      'Ataköy 2-5-6. Kısım',
      'Ataköy 3-4-11. Kısım',
      'Ataköy 7-8-9-10. Kısım',
      'Yeşilköy',
      'Florya',
      'Kartaltepe',
      'Zuhuratbaba',
      'Osmaniye',
      'Cevizlik',
      'Yeşilyurt',
      'Sakızağacı',
      'Şenlikköy',
      'Basınköy',
      'Yenimahalle',
      'Zeytinlik',
      'İncirli',
    ],
    center: [32, 48],
    palette: { land: 0xf6edd2, water: 0x96cfe0, park: 0xc0dca8 },
    labels: [
      { text: 'MARMARA DENİZİ', x: 32, y: 59, kind: 'water' },
      { text: 'BOTANİK PARKI', x: 29, y: 40.5, kind: 'park' },
    ],
    highways: [
      {
        name: 'D-100',
        path: [
          [0, 44],
          [63, 44],
        ],
      },
    ],
    terrain(x, y) {
      const coast = 52 + 3 * Math.sin(x / 10);
      if (y > coast) return Terrain.Water;
      // Ayamama Deresi reaches the sea here.
      if (Math.abs(x - (36.5 + 1.5 * Math.sin(y / 4))) < 1.5) return Terrain.Water;
      if (inRect(x, y, 26, 38, 32, 43)) return Terrain.Park; // Botanik Parkı
      return Terrain.Land;
    },
  },
];

export function districtById(id: string): District | undefined {
  return DISTRICTS.find((d) => d.id === id);
}

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  kolay: 'Kolay',
  orta: 'Orta',
  zor: 'Zor',
};
