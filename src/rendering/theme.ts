import type { DistrictPalette } from '../map/districts';

/**
 * Visual identity of İstanbul Trafik: a warm paper-like map, soft organic
 * water and parks, dark rounded roads and small shaded buildings. Each
 * colour group also has its own glyph so that matching never depends on
 * colour alone.
 */
export interface Theme {
  background: number;
  land: number;
  water: number;
  waterBank: number;
  /** Darker band in open water, away from the shore. */
  waterDeep: number;
  /** Sparse dots that give open water a light texture. */
  waterDot: number;
  /** Place names written on water and in parks. */
  waterLabel: number;
  parkLabel: number;
  park: number;
  parkEdge: number;
  grid: number;
  road: number;
  /** Pre-built highways: a wider road with white edges and a dashed centre line (same asphalt as streets, so junctions merge cleanly). */
  highway: number;
  highwayEdge: number;
  /** Cars of through traffic (they belong to no colour group). */
  through: number;
  /** Road signs with highway names: otoyol (green), devlet yolu (blue), street. */
  signOtoyol: number;
  signDevlet: number;
  signStreet: number;
  bridgeEdge: number;
  marking: number;
  glyph: number;
  shadow: number;
  /** Waiting-trip markers next to workplaces. */
  pin: number;
  pinRing: number;
  overflowTrack: number;
  overflow: number;
  /** Traffic status (validated status palette: good / warning / critical). */
  flowGood: number;
  flowWarn: number;
  flowCritical: number;
  previewValid: number;
  previewInvalid: number;
  hover: number;
  route: number;
  selection: number;
  /** Colour groups in the order they are introduced. */
  groups: readonly number[];
}

export const DEFAULT_THEME: Theme = {
  background: 0xf3e9dc,
  land: 0xf3e9dc,
  water: 0x9ccbdc,
  waterBank: 0xfbf6ee,
  waterDeep: 0x8cc0d3,
  waterDot: 0xb9dde9,
  waterLabel: 0x5f97ab,
  parkLabel: 0x6f9a62,
  park: 0xbfdcb4,
  parkEdge: 0xb2d3a7,
  grid: 0xe6d9c6,
  road: 0x434b59,
  highway: 0x434b59,
  highwayEdge: 0xffffff,
  through: 0xa7adb6,
  signOtoyol: 0x2e8a57,
  signDevlet: 0x2f6fb0,
  signStreet: 0x434b59,
  bridgeEdge: 0x2f3540,
  marking: 0xffffff,
  glyph: 0xffffff,
  shadow: 0x7a5a45,
  pin: 0x434b59,
  pinRing: 0xffffff,
  overflowTrack: 0xe6d9c6,
  overflow: 0xd03b3b,
  flowGood: 0x0ca30c,
  flowWarn: 0xfab219,
  flowCritical: 0xd03b3b,
  previewValid: 0x434b59,
  previewInvalid: 0xd03b3b,
  hover: 0x434b59,
  route: 0x2f6fd0,
  selection: 0x2f6fd0,
  groups: [0xe8836a, 0x3aa7a0, 0xe7b24a, 0x8f86c9, 0x6aa85a],
};

/** Higher contrast variant: darker roads and stronger colours. */
export const HIGH_CONTRAST_THEME: Theme = {
  ...DEFAULT_THEME,
  background: 0xffffff,
  land: 0xffffff,
  water: 0x5d97c4,
  park: 0xa9cf94,
  parkEdge: 0x93bf7c,
  road: 0x1f1f1f,
  highway: 0x1f1f1f,
  through: 0x7a7a7a,
  waterDeep: 0x4f88b5,
  waterDot: 0x7fb1d6,
  waterLabel: 0x1f4f78,
  parkLabel: 0x2f5a22,
  groups: [0xc0442a, 0x0f6e64, 0xb07a00, 0x4f3a8c, 0x2f6e22],
};

/** Seasons change every in-game week, in this order. */
export const SEASONS = ['İlkbahar', 'Yaz', 'Sonbahar', 'Kış'] as const;

export function seasonOf(week: number): number {
  return (((week - 1) % SEASONS.length) + SEASONS.length) % SEASONS.length;
}

/** Linear blend of two colours (t = 0 → a, t = 1 → b). */
export function mix(a: number, b: number, t: number): number {
  const ch = (shift: number): number => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t);
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** How each season tints ground, parks and water: [target colour, amount]. */
const SEASON_TINTS: readonly { land: [number, number]; park: [number, number]; water: [number, number] }[] = [
  // İlkbahar: fresh green parks.
  { land: [0xeef3df, 0.06], park: [0xa9d98e, 0.35], water: [0x9bd3e3, 0.1] },
  // Yaz: warm sunny ground, deep green parks.
  { land: [0xf8e3b8, 0.12], park: [0x98c97c, 0.25], water: [0x7cc4dc, 0.15] },
  // Sonbahar: orange and brown leaves.
  { land: [0xefd9c0, 0.1], park: [0xe0ad6a, 0.5], water: [0x8fb4c8, 0.15] },
  // Kış: snow on the ground and in the parks, grey-blue water.
  { land: [0xf9fafb, 0.55], park: [0xe8f0ec, 0.6], water: [0xa6c0cf, 0.3] },
];

/**
 * Each district gets its own soft ground and water tint, derived into the
 * full set of terrain colours, and shifted by the season. The high contrast
 * theme is left untouched.
 */
export function districtTheme(base: Theme, palette: DistrictPalette | undefined, season = 0): Theme {
  if (!palette || base === HIGH_CONTRAST_THEME) return base;
  const tint = SEASON_TINTS[season % SEASON_TINTS.length] as (typeof SEASON_TINTS)[number];
  palette = {
    land: mix(palette.land, tint.land[0], tint.land[1]),
    park: mix(palette.park, tint.park[0], tint.park[1]),
    water: mix(palette.water, tint.water[0], tint.water[1]),
  };
  return {
    ...base,
    background: palette.land,
    land: palette.land,
    grid: shade(palette.land, 0.93),
    overflowTrack: shade(palette.land, 0.9),
    water: palette.water,
    waterBank: shade(palette.water, 1.55),
    waterDeep: shade(palette.water, 0.9),
    waterDot: shade(palette.water, 1.28),
    waterLabel: shade(palette.water, 0.62),
    park: palette.park,
    parkEdge: shade(palette.park, 0.93),
    parkLabel: shade(palette.park, 0.58),
  };
}

export function groupColor(theme: Theme, group: number): number {
  return theme.groups[group % theme.groups.length] as number;
}

/** Same hue, shifted darker (factor < 1) or lighter (factor > 1). */
export function shade(color: number, factor: number): number {
  const ch = (shift: number): number => {
    const c = (color >> shift) & 0xff;
    const v = factor < 1 ? c * factor : c + (255 - c) * (factor - 1);
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}
