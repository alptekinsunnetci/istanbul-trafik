import { MAP } from '../core/constants';
import { hashString } from '../core/random';
import type { District, Highway } from './districts';
import { Terrain, type TerrainType } from './grid';
import { L } from '../core/i18n';

/**
 * A map made in the map editor: 64×64 authoring cells of land, water and
 * park, straight highway lines, a starting point and a name. It plays like
 * any district and travels as a short text code (e.g. in a link).
 */
export interface CustomMap {
  name: string;
  /** Terrain per authoring cell, row by row (64 × 64). */
  terrain: Uint8Array;
  highways: Highway[];
  center: [number, number];
}

export const MAP_SIZE = MAP.defaultWidth;
const CODE_VERSION = 'v1';

export function emptyMap(): CustomMap {
  return {
    name: L('Benim semtim', 'My neighbourhood'),
    terrain: new Uint8Array(MAP_SIZE * MAP_SIZE),
    highways: [],
    center: [32, 32],
  };
}

/** A map editor template from an existing district. */
export function mapFromDistrict(d: District): CustomMap {
  const terrain = new Uint8Array(MAP_SIZE * MAP_SIZE);
  for (let y = 0; y < MAP_SIZE; y++)
    for (let x = 0; x < MAP_SIZE; x++) terrain[y * MAP_SIZE + x] = d.terrain(x, y, MAP_SIZE, MAP_SIZE);
  return {
    name: `${d.name} ${L('(kopya)', '(copy)')}`,
    terrain,
    highways: d.highways.map((h) => ({ name: h.name, path: h.path.map(([x, y]) => [x, y] as const) })),
    center: [d.center[0], d.center[1]],
  };
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Packs a map into a short text: run-length coded terrain plus the rest as JSON. */
export function encodeMap(m: CustomMap): string {
  const runs: number[] = [];
  for (let i = 0; i < m.terrain.length;) {
    const v = m.terrain[i] as number;
    let n = 1;
    while (i + n < m.terrain.length && m.terrain[i + n] === v && n < 255) n++;
    runs.push(v, n);
    i += n;
  }
  const json = JSON.stringify({
    n: m.name,
    c: m.center,
    h: m.highways.map((h) => [h.name, h.path.flat()]),
    t: toBase64Url(new Uint8Array(runs)),
  });
  return `${CODE_VERSION}.${toBase64Url(new TextEncoder().encode(json))}`;
}

/** Reads a map code; throws on anything malformed. */
export function decodeMap(code: string): CustomMap {
  const [version, body] = code.trim().split('.');
  if (version !== CODE_VERSION || !body) throw new Error('Harita kodu tanınmadı');
  const data = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as {
    n?: unknown;
    c?: unknown;
    h?: unknown;
    t?: unknown;
  };
  const name = typeof data.n === 'string' ? data.n.slice(0, 40) : 'Harita';
  const c = Array.isArray(data.c) ? data.c : [];
  const cx = Number(c[0]);
  const cy = Number(c[1]);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) throw new Error('Harita kodu bozuk');
  const runs = typeof data.t === 'string' ? fromBase64Url(data.t) : new Uint8Array();
  const terrain = new Uint8Array(MAP_SIZE * MAP_SIZE);
  let at = 0;
  for (let k = 0; k + 1 < runs.length; k += 2) {
    const v = Math.min(2, runs[k] as number);
    for (let n = 0; n < (runs[k + 1] as number) && at < terrain.length; n++) terrain[at++] = v;
  }
  if (at !== terrain.length) throw new Error('Harita kodu eksik');
  const highways: Highway[] = [];
  for (const h of Array.isArray(data.h) ? data.h.slice(0, 8) : []) {
    if (!Array.isArray(h) || typeof h[0] !== 'string' || !Array.isArray(h[1])) continue;
    const flat = (h[1] as unknown[]).map(Number);
    const path: [number, number][] = [];
    for (let k = 0; k + 1 < flat.length && path.length < 8; k += 2) {
      const x = flat[k] as number;
      const y = flat[k + 1] as number;
      if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE)
        path.push([x, y]);
    }
    if (path.length >= 2) highways.push({ name: h[0].slice(0, 20), path });
  }
  return {
    name,
    terrain,
    highways,
    center: [Math.min(MAP_SIZE - 2, Math.max(1, cx)), Math.min(MAP_SIZE - 2, Math.max(1, cy))],
  };
}

/** What is wrong with a map before it can be played, or null when it is fine. */
export function mapProblem(m: CustomMap): string | null {
  const [cx, cy] = m.center;
  let land = 0;
  for (let y = cy - 6; y <= cy + 6; y++)
    for (let x = cx - 9; x <= cx + 9; x++)
      if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE && m.terrain[y * MAP_SIZE + x] === Terrain.Land)
        land++;
  if (land < 60)
    return L(
      'Başlangıç noktasının çevresinde yeterince kara yok',
      'There is not enough land around the start',
    );
  return null;
}

/** A playable district from a custom map. */
export function customDistrict(m: CustomMap): District {
  const code = encodeMap(m);
  return {
    id: `ozel-${(hashString(code) % 1_000_000).toString(36)}`,
    code,
    name: m.name,
    tagline: L('Harita düzenleyicide yapılmış bir semt.', 'A neighbourhood made in the map editor.'),
    difficulty: 'orta',
    demandMultiplier: 1,
    startRoads: 40,
    neighbourhoods: [
      'Merkez',
      'Çarşı',
      'Yokuş',
      'Sahil',
      'Bayır',
      'Bahçe',
      'Çınarlı',
      'Pınarbaşı',
      'Kuyulu',
      'Yenimahalle',
    ],
    center: [m.center[0], m.center[1]],
    palette: { land: 0xf3e9dc, water: 0x8fc4d6, park: 0xbfdcb4 },
    labels: [],
    highways: m.highways,
    terrain(x, y): TerrainType {
      const ix = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(x)));
      const iy = Math.min(MAP_SIZE - 1, Math.max(0, Math.floor(y)));
      return (m.terrain[iy * MAP_SIZE + ix] ?? Terrain.Land) as TerrainType;
    },
  };
}
