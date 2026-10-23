import type { Graphics } from 'pixi.js';
import { DEMAND, GEOM } from '../core/constants';
import type { Building } from '../core/world-state';
import { overflowUsed, pinsAt } from '../traffic/demand-generator';
import { type Theme, groupColor, shade } from './theme';

const C = GEOM.cellSize;
const DRIVEWAY = 6.4;
/** Shadow length: long, soft shadows towards the bottom right. */
const SHADOW = { konut: 7, ticari: 13 } as const;

/** White glyph of a colour group: circle, triangle, square, diamond, plus. */
export function drawGlyph(g: Graphics, group: number, x: number, y: number, r: number, color: number): void {
  switch (group % 5) {
    case 0:
      g.circle(x, y, r * 0.8).fill(color);
      break;
    case 1:
      g.poly([x, y - r, x + r * 0.95, y + r * 0.75, x - r * 0.95, y + r * 0.75]).fill(color);
      break;
    case 2:
      g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5).fill(color);
      break;
    case 3:
      g.poly([x, y - r, x + r, y, x, y + r, x - r, y]).fill(color);
      break;
    default: {
      const t = r * 0.36;
      g.rect(x - r, y - t, 2 * r, 2 * t)
        .fill(color)
        .rect(x - t, y - r, 2 * t, 2 * r)
        .fill(color);
    }
  }
}

/**
 * Shaded little blocks with a long soft shadow (light from the top left):
 * houses are small cubes, workplaces large blocks standing on a rounded pad
 * of their own colour. Both carry the colour and the glyph of their group.
 */
export function drawBuildings(g: Graphics, all: readonly Building[], gridWidth: number, theme: Theme): void {
  g.clear();
  // Gateways are drawn as the highway leaving the map, not as buildings.
  const buildings = all.filter(isCityBuilding);
  // Pads under workplaces: their whole 2×2 lot, tinted with the group colour.
  for (const b of buildings) {
    if (b.kind !== 'ticari') continue;
    const color = groupColor(theme, b.color);
    const inset = 1.5;
    g.roundRect(b.x * C + inset, b.y * C + inset, b.w * C - 2 * inset, b.h * C - 2 * inset, 7).fill({
      color: shade(color, 1.62),
    });
    g.roundRect(b.x * C + inset, b.y * C + inset, b.w * C - 2 * inset, b.h * C - 2 * inset, 7).stroke({
      width: 1.2,
      color: shade(color, 1.3),
    });
  }
  // Shadows next so that no shadow falls on a neighbouring building.
  for (const b of buildings) {
    const { x, y, s } = footprint(b);
    const d = b.kind === 'konut' ? SHADOW.konut : SHADOW.ticari;
    g.poly([
      x + s,
      y + 2,
      x + s + d,
      y + 2 + d,
      x + s + d,
      y + s + d,
      x + 2 + d,
      y + s + d,
      x + 2,
      y + s,
    ]).fill({
      color: theme.shadow,
      alpha: 0.12,
    });
  }
  for (const b of buildings) {
    const doorX = ((b.door % gridWidth) + 0.5) * C;
    const doorY = (Math.floor(b.door / gridWidth) + 0.5) * C;
    const dx = b.doorDir === 1 ? 1 : b.doorDir === 3 ? -1 : 0;
    const dy = b.doorDir === 2 ? 1 : b.doorDir === 0 ? -1 : 0;
    g.moveTo(doorX, doorY)
      .lineTo(doorX - dx * C * 0.9, doorY - dy * C * 0.9)
      .stroke({ width: DRIVEWAY, color: theme.road, cap: 'round' });
  }
  for (const b of buildings) {
    const { x, y, s } = footprint(b);
    const color = groupColor(theme, b.color);
    const side = Math.round(s * 0.28);
    const radius = b.kind === 'konut' ? 2 : 4;
    // Front face (darker) peeking out below the roof.
    g.roundRect(x, y + side, s, s - side, radius).fill(shade(color, 0.72));
    // Roof.
    g.roundRect(x, y, s, s - side * 0.6, radius).fill(color);
    g.roundRect(x + 1, y + 1, s - 2, (s - side * 0.6) * 0.45, radius).fill({
      color: shade(color, 1.18),
      alpha: 0.6,
    });
    const gy = y + (s - side * 0.6) / 2;
    drawGlyph(g, b.color, x + s / 2, gy, b.kind === 'konut' ? 2.6 : 4.8, theme.glyph);
  }
}

function isCityBuilding(b: Building): boolean {
  return b.kind === 'konut' || b.kind === 'ticari';
}

const FERRY = 0x2f7fb8;
const METRO = 0xc8372f;

/**
 * Ferry piers and metro stations, and the line between each pair: a dashed
 * sea lane for a ferry, a dashed underground line for a metro.
 */
export function drawStations(
  g: Graphics,
  buildings: readonly Building[],
  gridWidth: number,
  theme: Theme,
): void {
  const byId = new Map<number, Building>();
  for (const b of buildings) byId.set(b.id, b);
  for (const b of buildings) {
    const t = b.transit;
    if (!t || b.id > t.partner) continue;
    const other = byId.get(t.partner);
    if (!other) continue;
    const ax = (b.x + 0.5) * C;
    const ay = (b.y + 0.5) * C;
    const bx = (other.x + 0.5) * C;
    const by = (other.y + 0.5) * C;
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.floor(len / 7));
    for (let k = 0; k < steps; k += 2) {
      const f0 = k / steps;
      const f1 = Math.min(1, (k + 1) / steps);
      g.moveTo(ax + (bx - ax) * f0, ay + (by - ay) * f0).lineTo(ax + (bx - ax) * f1, ay + (by - ay) * f1);
    }
    g.stroke({
      width: t.mode === 'vapur' ? 1.6 : 2.2,
      color: t.mode === 'vapur' ? 0xffffff : METRO,
      alpha: 0.75,
    });
  }
  // Car parks: a grey lot with a white "P", next to their workplace.
  for (const b of buildings) {
    if (b.kind !== 'otopark') continue;
    const x = b.x * C + 1.5;
    const y = b.y * C + 1.5;
    const s = C - 3;
    const doorX = ((b.door % gridWidth) + 0.5) * C;
    const doorY = (Math.floor(b.door / gridWidth) + 0.5) * C;
    g.moveTo(doorX, doorY)
      .lineTo((b.x + 0.5) * C, (b.y + 0.5) * C)
      .stroke({ width: DRIVEWAY, color: theme.road });
    g.roundRect(x, y, s, s, 2.5)
      .fill(0x5b6472)
      .stroke({ width: 1, color: groupColor(theme, b.color) });
    const cx = x + s / 2;
    const cy = y + s / 2;
    g.moveTo(cx - 2.2, cy + 3.6)
      .lineTo(cx - 2.2, cy - 3.6)
      .lineTo(cx + 0.8, cy - 3.6)
      .arc(cx + 0.8, cy - 1.6, 2, -Math.PI / 2, Math.PI / 2)
      .lineTo(cx - 2.2, cy + 0.4)
      .stroke({ width: 1.5, color: 0xffffff, join: 'round', cap: 'round' });
  }
  for (const b of buildings) {
    const t = b.transit;
    if (!t) continue;
    const x = b.x * C + 1.5;
    const y = b.y * C + 1.5;
    const s = C - 3;
    const doorX = ((b.door % gridWidth) + 0.5) * C;
    const doorY = (Math.floor(b.door / gridWidth) + 0.5) * C;
    g.moveTo(doorX, doorY)
      .lineTo((b.x + 0.5) * C, (b.y + 0.5) * C)
      .stroke({ width: DRIVEWAY, color: theme.road });
    g.roundRect(x + 2, y + 2, s, s, 3).fill({ color: theme.shadow, alpha: 0.15 });
    g.roundRect(x, y, s, s, 3)
      .fill(t.mode === 'vapur' ? FERRY : METRO)
      .stroke({ width: 1, color: 0xffffff });
    const cx = x + s / 2;
    const cy = y + s / 2;
    if (t.mode === 'vapur') {
      // A little ferry: hull and funnel.
      g.poly([cx - 4.5, cy + 0.5, cx + 4.5, cy + 0.5, cx + 3, cy + 3, cx - 3, cy + 3]).fill(0xffffff);
      g.rect(cx - 1, cy - 3.5, 2.2, 3.4).fill(0xffffff);
    } else {
      // An "M".
      g.moveTo(cx - 3.6, cy + 3.4)
        .lineTo(cx - 3.6, cy - 3.4)
        .lineTo(cx, cy + 0.6)
        .lineTo(cx + 3.6, cy - 3.4)
        .lineTo(cx + 3.6, cy + 3.4)
        .stroke({ width: 1.6, color: 0xffffff, join: 'round', cap: 'round' });
    }
  }
}

/** Visible block of a building inside its footprint. */
function footprint(b: Building): { x: number; y: number; s: number } {
  const w = b.w * C;
  const s = b.kind === 'konut' ? 11 : 21;
  return { x: b.x * C + (w - s) / 2, y: b.y * C + (b.h * C - s) / 2, s };
}

/** Pins on workplaces, the overflow ring, and a grow-in ring for new buildings. */
export function drawBuildingStatus(
  g: Graphics,
  buildings: readonly Building[],
  time: number,
  theme: Theme,
  pulse: number,
  gridWidth: number,
  connected: (b: Building) => boolean,
): void {
  g.clear();
  for (const b of buildings) {
    if (b.transit) {
      // Passengers waiting at a station for their bus or taxi.
      const waiting =
        b.transit.riders.filter((r) => r.readyAt <= time).length +
        b.pending.reduce((n, t) => n + (t.passengers ?? 1), 0);
      const shown = Math.min(waiting, 10);
      for (let k = 0; k < shown; k++)
        g.circle(b.x * C + C / 2 - ((shown - 1) * 4) / 2 + k * 4, b.y * C - 2.5, 1.6)
          .fill(theme.pin)
          .stroke({ width: 0.8, color: theme.pinRing });
      continue;
    }
    if (!isCityBuilding(b)) continue;
    const x = b.x * C;
    const y = b.y * C;
    const w = b.w * C;
    const h = b.h * C;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (time - b.createdAt < DEMAND.newBuildingGrace) {
      g.circle(cx, cy, Math.max(w, h) * 0.75 + pulse * 3).stroke({
        width: 1.4,
        color: groupColor(theme, b.color),
        alpha: 0.7,
      });
    }
    // Not yet connected: a ring around the entrance shows where a road has to reach.
    if (!connected(b)) {
      const dx = ((b.door % gridWidth) + 0.5) * C;
      const dy = (Math.floor(b.door / gridWidth) + 0.5) * C;
      g.circle(dx, dy, 6.5).stroke({ width: 2, color: groupColor(theme, b.color), alpha: 0.9 });
    }
    if (b.kind !== 'ticari') continue;

    // Pins: one marker per waiting trip, in a row next to the workplace.
    const pins = Math.min(pinsAt(buildings, b), 10);
    const spacing = 6;
    const py = b.doorDir === 0 ? y + h + 3 : y - 3; // keep clear of the driveway
    for (let k = 0; k < pins; k++) {
      g.circle(cx - ((pins - 1) * spacing) / 2 + k * spacing, py, 2.5)
        .fill(theme.pin)
        .stroke({ width: 1, color: theme.pinRing });
    }

    const used = overflowUsed(b);
    if (used > 0) {
      const r = Math.max(w, h) * 0.72 + 2;
      g.circle(cx, cy, r).stroke({ width: 3, color: theme.overflowTrack });
      const start = -Math.PI / 2;
      g.moveTo(cx + Math.cos(start) * r, cy + Math.sin(start) * r);
      g.arc(cx, cy, r, start, start + used * Math.PI * 2);
      g.stroke({ width: 3, color: theme.overflow, cap: 'round' });
    }
  }
}
