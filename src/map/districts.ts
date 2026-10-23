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
  /** A narrow river: a small name that follows the water. */
  river?: boolean;
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
      { text: 'KURBAĞALIDERE', x: 19, y: 27, kind: 'water', river: true },
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
    id: 'sariyer',
    name: 'Sarıyer',
    tagline: 'Boğaz’ın Karadeniz’e açıldığı yerde yalılar, korular ve Belgrad Ormanı.',
    difficulty: 'orta',
    demandMultiplier: 0.95,
    startRoads: 38,
    neighbourhoods: [
      'Rumelihisarı',
      'Emirgan',
      'İstinye',
      'Yeniköy',
      'Tarabya',
      'Kireçburnu',
      'Büyükdere',
      'Sarıyer Merkez',
      'Rumelifeneri',
      'Rumelikavağı',
      'Maslak',
      'Ayazağa',
      'Bahçeköy',
      'Zekeriyaköy',
      'Kilyos',
      'Baltalimanı',
      'Ferahevler',
      'Pınar',
      'Çayırbaşı',
      'Reşitpaşa',
    ],
    center: [40, 40],
    palette: { land: 0xeef1e6, water: 0x86bcd4, park: 0xaed3a0 },
    labels: [
      { text: 'İSTANBUL BOĞAZI', x: 50, y: 30, kind: 'water', vertical: true },
      { text: 'KARADENİZ', x: 32, y: 1.5, kind: 'water' },
      { text: 'BELGRAD ORMANI', x: 14, y: 24, kind: 'park' },
      { text: 'EMİRGAN', x: 41, y: 48.5, kind: 'park' },
    ],
    highways: [
      {
        name: 'O-2',
        path: [
          [0, 54],
          [63, 54],
        ],
      },
    ],
    terrain(x, y) {
      if (y < 4 + 1.5 * Math.sin(x / 6)) return Terrain.Water; // Karadeniz
      if (x > 57 + 2 * Math.sin(y / 7)) return Terrain.Land; // Anadolu yakası: Beykoz
      if (x > 46 + 3 * Math.sin(y / 8)) return Terrain.Water; // Boğaz
      if (inEllipse(x, y, 14, 24, 9, 10)) return Terrain.Park; // Belgrad Ormanı
      if (inRect(x, y, 39, 46, 43, 51)) return Terrain.Park; // Emirgan Korusu
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
    demandMultiplier: 0.85,
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
      { text: 'AYAMAMA DERESİ', x: 38, y: 46, kind: 'water', river: true },
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
      if (Math.abs(x - (39.5 + 1.5 * Math.sin(y / 4))) < 1.5) return Terrain.Water;
      if (inRect(x, y, 26, 38, 32, 43)) return Terrain.Park; // Botanik Parkı
      return Terrain.Land;
    },
  },
  {
    id: 'beykoz',
    name: 'Beykoz',
    tagline: 'Anadolu yakasında Boğaz kıyısı, Göksu Deresi ve ormanlarla çevrili köyler.',
    difficulty: 'kolay',
    demandMultiplier: 0.85,
    startRoads: 40,
    neighbourhoods: [
      'Anadoluhisarı',
      'Kanlıca',
      'Çubuklu',
      'Paşabahçe',
      'Beykoz Merkez',
      'Anadolukavağı',
      'Kavacık',
      'Göksu',
      'Acarlar',
      'Riva',
      'Polonezköy',
      'Çengeldere',
      'Rüzgarlıbahçe',
      'Yalıköy',
      'Ortaçeşme',
      'Soğuksu',
      'İncirköy',
      'Tokatköy',
      'Yavuz Selim',
      'Görele',
    ],
    center: [22, 40],
    palette: { land: 0xeaf0e2, water: 0x8cc3cf, park: 0xa6cf96 },
    labels: [
      { text: 'İSTANBUL BOĞAZI', x: 11, y: 30, kind: 'water', vertical: true },
      { text: 'KARADENİZ', x: 40, y: 1.5, kind: 'water' },
      { text: 'GÖKSU DERESİ', x: 30, y: 44.5, kind: 'water', river: true },
      { text: 'BEYKOZ KORUSU', x: 29.5, y: 24, kind: 'park' },
      { text: 'POLONEZKÖY', x: 50, y: 16, kind: 'park' },
    ],
    highways: [
      {
        name: 'O-2',
        path: [
          [0, 56],
          [63, 56],
        ],
      },
    ],
    terrain(x, y) {
      if (y < 5 + 1.5 * Math.sin(x / 5)) return Terrain.Water; // Karadeniz
      const coast = 17 + 3 * Math.sin(y / 8);
      if (x < coast - 9) return Terrain.Land; // Avrupa yakası: Sarıyer
      if (x < coast) return Terrain.Water; // Boğaz
      // Göksu Deresi flows into the Boğaz at Anadoluhisarı.
      if (x < 42 && Math.abs(y - (44 + 2 * Math.sin(x / 5))) < 1.3) return Terrain.Water;
      if (inRect(x, y, 26, 20, 33, 28)) return Terrain.Park; // Beykoz Korusu
      if (inEllipse(x, y, 50, 16, 7, 6)) return Terrain.Park; // Polonezköy
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
    center: [20, 31],
    palette: { land: 0xeff0de, water: 0x95c7cc, park: 0xb7d6a6 },
    labels: [
      { text: 'İSTANBUL BOĞAZI', x: 8, y: 36, kind: 'water', vertical: true },
      { text: 'VALİDEBAĞ', x: 32, y: 40, kind: 'park' },
      { text: 'FETHİ PAŞA', x: 26.5, y: 11.5, kind: 'park', vertical: true },
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
      const coast = 16 + 4 * Math.sin(y / 7) + (y < 20 ? (20 - y) * 0.3 : 0);
      // Across the Boğaz: the European shore (Ortaköy, Kuruçeşme).
      if (x < coast - 9) return Terrain.Land;
      if (x < coast) return Terrain.Water;
      if (inRect(x, y, 29, 37, 35, 43)) return Terrain.Park; // Validebağ Korusu
      if (inRect(x, y, 25, 9, 28, 14)) return Terrain.Park; // Fethi Paşa Korusu
      return Terrain.Land;
    },
  },
  {
    id: 'beyoglu',
    name: 'Beyoğlu',
    tagline: 'Galata’dan Taksim’e: Haliç ile Boğaz arasında yokuşlu, kalabalık sokaklar.',
    difficulty: 'zor',
    demandMultiplier: 1.15,
    startRoads: 36,
    neighbourhoods: [
      'Galata',
      'Karaköy',
      'Cihangir',
      'Taksim',
      'Tophane',
      'Kasımpaşa',
      'Hasköy',
      'Sütlüce',
      'Tarlabaşı',
      'Şişhane',
      'Tepebaşı',
      'Asmalımescit',
      'Kuledibi',
      'Örnektepe',
      'Halıcıoğlu',
      'Piyalepaşa',
      'Kemankeş',
      'Fındıklı',
      'Ömer Avni',
      'Kalyoncukulluk',
    ],
    center: [34, 36],
    palette: { land: 0xf1e6e0, water: 0x8fbfd6, park: 0xbcd8ae },
    labels: [
      { text: 'HALİÇ', x: 20, y: 38.7, kind: 'water', river: true },
      { text: 'İSTANBUL BOĞAZI', x: 57, y: 20, kind: 'water', vertical: true },
      { text: 'GEZİ', x: 37.5, y: 21.5, kind: 'park' },
    ],
    highways: [
      {
        name: 'TARLABAŞI BLV.',
        path: [
          [0, 31],
          [30, 31],
          [30, 0],
        ],
      },
    ],
    terrain(x, y) {
      if (x > 61) return Terrain.Land; // Anadolu yakası: Üsküdar
      if (x > 52 + 2 * Math.sin(y / 7)) return Terrain.Water; // Boğaz
      // Haliç, with the historic peninsula on its far side, opening into the Boğaz.
      const halic = 30 + 0.45 * x + 1.5 * Math.sin(x / 6);
      if (Math.abs(y - halic) < 2.4) return Terrain.Water;
      if (x > 44 && y > halic - 2.4) return Terrain.Water;
      if (inRect(x, y, 36, 20, 39, 23)) return Terrain.Park; // Gezi Parkı
      return Terrain.Land;
    },
  },
  {
    id: 'basaksehir',
    name: 'Başakşehir',
    tagline: 'Yeni mahalleler, geniş bulvarlar, Sazlıdere Barajı ve Millet Bahçesi.',
    difficulty: 'orta',
    demandMultiplier: 1.0,
    startRoads: 38,
    neighbourhoods: [
      'Başakşehir',
      'Kayabaşı',
      'Bahçeşehir',
      'Altınşehir',
      'Güvercintepe',
      'Şahintepe',
      'Ziya Gökalp',
      'İkitelli',
      'Şamlar',
      'Onurkent',
      'Kayaşehir',
      'Başak',
      'Boğazköy',
      'Hoşdere',
    ],
    center: [32, 30],
    palette: { land: 0xf2eee0, water: 0x9ccbd6, park: 0xb5d6a0 },
    labels: [
      { text: 'SAZLIDERE BARAJI', x: 18, y: 6, kind: 'water' },
      { text: 'SAZLIDERE', x: 27, y: 40, kind: 'water', river: true },
      { text: 'MİLLET BAHÇESİ', x: 42, y: 39, kind: 'park' },
    ],
    highways: [
      {
        name: 'TEM',
        path: [
          [0, 25],
          [63, 25],
        ],
      },
      {
        name: 'BASIN EKSPRES',
        path: [
          [48, 25],
          [48, 63],
        ],
      },
    ],
    terrain(x, y) {
      if (inEllipse(x, y, 20, 6, 10, 7)) return Terrain.Water; // Sazlıdere Barajı
      // Sazlıdere runs south from the dam.
      if (y > 6 && Math.abs(x - (27 + 2 * Math.sin(y / 6))) < 1.3) return Terrain.Water;
      if (inRect(x, y, 38, 36, 46, 42)) return Terrain.Park; // Millet Bahçesi
      return Terrain.Land;
    },
  },
  {
    id: 'maltepe',
    name: 'Maltepe',
    tagline: 'Marmara kıyısında sahil parkı, D-100 ve tepelere tırmanan mahalleler.',
    difficulty: 'kolay',
    demandMultiplier: 0.85,
    startRoads: 40,
    neighbourhoods: [
      'Altayçeşme',
      'Altıntepe',
      'Bağlarbaşı',
      'Başıbüyük',
      'Büyükbakkalköy',
      'Cevizli',
      'Çınar',
      'Esenkent',
      'Feyzullah',
      'Fındıklı',
      'Girne',
      'Gülensu',
      'Gülsuyu',
      'İdealtepe',
      'Küçükyalı',
      'Yalı',
      'Zümrütevler',
      'Aydınevler',
    ],
    center: [32, 40],
    palette: { land: 0xf5ead8, water: 0x92c9dc, park: 0xbcdcaa },
    labels: [
      { text: 'MARMARA DENİZİ', x: 32, y: 58, kind: 'water' },
      { text: 'ORHANGAZİ PARKI', x: 31, y: 46.5, kind: 'park' },
    ],
    highways: [
      {
        name: 'D-100',
        path: [
          [0, 35],
          [63, 35],
        ],
      },
      {
        name: 'O-4',
        path: [
          [0, 8],
          [63, 8],
        ],
      },
    ],
    terrain(x, y) {
      if (y > 50 + 2 * Math.sin(x / 8)) return Terrain.Water; // Marmara
      if (inRect(x, y, 22, 45, 40, 48)) return Terrain.Park; // Orhangazi Şehir Parkı
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
    id: 'bagcilar',
    name: 'Bağcılar',
    tagline: 'TEM ile Basın Ekspres arasında denizsiz, çok yoğun bir yerleşim.',
    difficulty: 'zor',
    demandMultiplier: 1.25,
    startRoads: 34,
    neighbourhoods: [
      'Bağlar',
      'Barbaros',
      'Çınar',
      'Demirkapı',
      'Evren',
      'Fevzi Çakmak',
      'Göztepe',
      'Güneşli',
      'Hürriyet',
      'İnönü',
      'Kâzım Karabekir',
      'Kemalpaşa',
      'Kirazlı',
      'Mahmutbey',
      'Merkez',
      'Sancaktepe',
      'Yavuzselim',
      'Yenigün',
      'Yenimahalle',
      'Yıldıztepe',
    ],
    center: [34, 32],
    palette: { land: 0xeeeae4, water: 0x9cc6dc, park: 0xb8d6ac },
    labels: [],
    highways: [
      {
        name: 'TEM',
        path: [
          [0, 28],
          [63, 28],
        ],
      },
      {
        name: 'BASIN EKSPRES',
        path: [
          [14, 28],
          [14, 63],
        ],
      },
    ],
    terrain(x, y) {
      if (inRect(x, y, 20, 14, 25, 18)) return Terrain.Park;
      if (inRect(x, y, 40, 44, 45, 48)) return Terrain.Park;
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
