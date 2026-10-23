import type { Resources } from '../map/road-editor';
import { formatNumber, h, icon } from './dom';

/** The default action is drawing roads; a badge can arm the boulevard or the eraser. */
export type Tool = 'road' | 'boulevard' | 'erase' | 'signal';

export interface ToolbarActions {
  selectTool(tool: Tool): void;
  undo(): void;
}

interface Badge {
  root: HTMLElement;
  button: HTMLElement;
  count: HTMLElement | null;
}

/** Round badge with an icon, an optional count bubble and a small label underneath. */
function badge(
  tag: 'div' | 'button',
  iconName: string,
  label: string,
  title: string,
  countId: string | null,
  extraClass = '',
): Badge {
  const count = countId ? h('span', { class: 'badge-count', id: countId, text: '0' }) : null;
  const button = h(tag, { class: `badge ${extraClass}`, 'aria-label': label, title });
  if (button instanceof HTMLButtonElement) button.type = 'button';
  button.append(h('span', { class: 'badge-icon' }, icon(iconName, 22)));
  if (count) button.append(count);
  const root = h('div', { class: 'badge-wrap' }, button, h('span', { class: 'badge-label', text: label }));
  return { root, button, count };
}

/**
 * Bottom row: undo, the piece counters (road, bridge and — once owned —
 * boulevard) and the eraser. Every badge has a text label so its meaning is
 * clear without knowing the icons.
 */
export class Toolbar {
  readonly root: HTMLElement;
  private undoBadge = badge('button', 'undo', 'Geri al', 'Son çizimi geri al (Ctrl+Z)', null, 'badge-light');
  private roads = badge('div', 'road', 'Yol', 'Kalan yol parçası — sürükleyerek çiz', 'roads-value');
  private bridges = badge(
    'div',
    'bridge',
    'Köprü',
    'Kalan köprü parçası — su üstüne çizince kullanılır',
    'bridges-value',
  );
  private boulevards = badge(
    'button',
    'boulevard',
    'Bulvar',
    'Bulvar — seç, sonra bir yolun üstünden sürükle',
    'boulevards-value',
  );
  private lights = badge(
    'button',
    'light',
    'Işık',
    'Trafik ışığı — seç, sonra bir kavşağa dokun (tekrar dokununca kalkar)',
    'lights-value',
  );
  private erase = badge(
    'button',
    'erase',
    'Sil',
    'Silgi — seç ve yolun üstünden sürükle (ya da sağ tık)',
    null,
    'badge-light',
  );
  private legend: HTMLElement;

  constructor(actions: ToolbarActions) {
    this.undoBadge.button.id = 'btn-undo';
    this.undoBadge.button.addEventListener('click', () => actions.undo());
    this.boulevards.button.dataset.tool = 'boulevard';
    this.boulevards.button.setAttribute('aria-pressed', 'false');
    this.boulevards.button.addEventListener('click', () => actions.selectTool('boulevard'));
    this.lights.button.dataset.tool = 'signal';
    this.lights.button.setAttribute('aria-pressed', 'false');
    this.lights.button.addEventListener('click', () => actions.selectTool('signal'));
    this.erase.button.dataset.tool = 'erase';
    this.erase.button.setAttribute('aria-pressed', 'false');
    this.erase.button.addEventListener('click', () => actions.selectTool('erase'));

    this.legend = h(
      'div',
      { class: 'legend', hidden: true, 'aria-label': 'Trafik katmanı' },
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-good' }), 'Akıcı'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-warn' }), 'Yoğun'),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-critical' }), 'Tıkalı ✕'),
    );
    this.root = h(
      'nav',
      { class: 'dock-wrap', 'aria-label': 'Yapı parçaları' },
      this.legend,
      h(
        'div',
        { class: 'dock' },
        this.undoBadge.root,
        h('span', { class: 'dock-sep', 'aria-hidden': 'true' }),
        this.roads.root,
        this.bridges.root,
        this.boulevards.root,
        this.lights.root,
        h('span', { class: 'dock-sep', 'aria-hidden': 'true' }),
        this.erase.root,
      ),
    );
  }

  update(
    tool: Tool,
    overlay: boolean,
    editable: boolean,
    res: Resources,
    canUndo: boolean,
    water = true,
  ): void {
    const set = (b: Badge, v: number): void => {
      const text = formatNumber(v);
      if (b.count && b.count.textContent !== text) b.count.textContent = text;
      b.button.classList.toggle('badge-empty', v <= 0);
    };
    set(this.roads, res.roads);
    set(this.bridges, res.bridges);
    set(this.boulevards, res.boulevards);
    set(this.lights, res.lights);
    const lt = this.lights.button as HTMLButtonElement;
    lt.setAttribute('aria-pressed', String(tool === 'signal'));
    // Lights can always be selected: placed ones can be taken away even with none left.
    lt.disabled = !editable;
    const bv = this.boulevards.button as HTMLButtonElement;
    bv.setAttribute('aria-pressed', String(tool === 'boulevard'));
    bv.disabled = !editable || (res.boulevards <= 0 && tool !== 'boulevard');
    // A district without water has no use for bridges.
    this.bridges.root.hidden = !water;
    // Boulevards appear only once the player owns some.
    this.boulevards.root.hidden = res.boulevards <= 0 && tool !== 'boulevard';
    const er = this.erase.button as HTMLButtonElement;
    er.setAttribute('aria-pressed', String(tool === 'erase'));
    er.disabled = !editable;
    (this.undoBadge.button as HTMLButtonElement).disabled = !canUndo;
    this.legend.hidden = !overlay;
  }
}
