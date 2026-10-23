/**
 * Tiny DOM builder. Text is always assigned through `textContent`, never
 * through innerHTML, so names coming from data can never inject markup.
 */
type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Original line icons on a 24×24 grid. */
const ICONS: Record<string, string[]> = {
  play: ['M8 5.5v13l10.5-6.5z'],
  pause: ['M7.5 5.5h3v13h-3z', 'M13.5 5.5h3v13h-3z'],
  restart: ['M5 12a7 7 0 1 0 2.05-4.95', 'M5 4.5v3.5h3.5'],
  gear: [
    'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
    'M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7',
  ],
  help: [
    'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
    'M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.2-2.5 3.9',
    'M12 17h.01',
  ],
  menu: ['M4.5 7h15M4.5 12h15M4.5 17h15'],
  road: ['M8 3.5 5 20.5M16 3.5l3 17', 'M12 4.5v2.5M12 10.5v3M12 17v2.5'],
  boulevard: ['M6.5 3.5 4 20.5M17.5 3.5l2.5 17', 'M11 4v16.5M13 4v16.5'],
  oneway: ['M4 12h13', 'M13 7.5l4.5 4.5-4.5 4.5'],
  erase: ['M4.5 19.5h15', 'M7.5 15.5 15 8l3 3-7.5 7.5H8.5z', 'M13 10l3 3'],
  inspect: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
  pan: [
    'M12 3.5v17M3.5 12h17',
    'M9.5 6 12 3.5 14.5 6M9.5 18l2.5 2.5 2.5-2.5M6 9.5 3.5 12 6 14.5M18 9.5l2.5 2.5-2.5 2.5',
  ],
  layers: ['M12 4 3.5 8.5 12 13l8.5-4.5z', 'M3.5 12.5 12 17l8.5-4.5', 'M3.5 16.5 12 21l8.5-4.5'],
  chart: ['M4.5 19.5h15', 'M7.5 16v-4.5M12 16V7.5M16.5 16v-6'],
  close: ['M6 6l12 12M18 6 6 18'],
  zoomIn: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20', 'M10.5 8v5M8 10.5h5'],
  zoomOut: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20', 'M8 10.5h5'],
  fit: ['M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5'],
  warning: ['M12 4 2.8 19.5h18.4z', 'M12 10v4.5', 'M12 17h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  undo: ['M9 14.5 4.5 10 9 5.5', 'M4.5 10h10a5 5 0 0 1 0 10h-3'],
  back: ['M19.5 12h-14', 'M11 5.5 4.5 12l6.5 6.5'],
  car: ['M4.5 15.5V12l2.2-5h10.6l2.2 5v3.5z', 'M4.5 12h15', 'M7.5 18.5v-3M16.5 18.5v-3'],
  light: [
    'M9 2.5h6a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 16V4A1.5 1.5 0 0 1 9 2.5z',
    'M12 6.5h.01M12 10h.01M12 13.5h.01',
    'M12 17.5v4',
  ],
  bridge: ['M3 16.5h18', 'M3 10c3 0 6 3.5 9 3.5s6-3.5 9-3.5', 'M7 11.8v4.7M12 13.5v3M17 11.8v4.7'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5.5', 'M12 7.5h.01'],
};

export function icon(name: string, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function button(
  label: string,
  onClick: () => void,
  opts: { icon?: string; className?: string; title?: string; iconOnly?: boolean; id?: string } = {},
): HTMLButtonElement {
  const b = h('button', {
    type: 'button',
    class: opts.className ?? 'btn',
    title: opts.title ?? (opts.iconOnly ? label : undefined),
    'aria-label': opts.iconOnly ? label : undefined,
    id: opts.id,
  });
  if (opts.icon) b.append(icon(opts.icon));
  if (!opts.iconOnly) b.append(h('span', { text: label }));
  b.addEventListener('click', onClick);
  return b;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatPercent(ratio: number): string {
  return `%${Math.round(ratio * 100)}`;
}
