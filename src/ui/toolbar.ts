import type { Resources } from '../map/road-editor';
import { formatNumber, h, icon } from './dom';
import { L } from '../core/i18n';

/** The default action is drawing roads; a badge can arm the boulevard or the eraser. */
export type Tool = 'road' | 'boulevard' | 'erase' | 'signal' | 'roundabout' | 'transit' | 'parking';

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
  private undoBadge = badge(
    'button',
    'undo',
    L('Geri al', 'Undo'),
    L('Son çizimi geri al (Ctrl+Z)', 'Undo the last drawing (Ctrl+Z)'),
    null,
    'badge-light',
  );
  private roads = badge(
    'div',
    'road',
    L('Yol', 'Road'),
    L('Kalan yol parçası — sürükleyerek çiz', 'Road pieces left — drag to draw'),
    'roads-value',
  );
  private bridges = badge(
    'div',
    'bridge',
    L('Köprü', 'Bridge'),
    L(
      'Kalan köprü parçası — su üstüne çizince ya da otoyolun üstünden düz geçince (üst geçit) kullanılır',
      'Bridge pieces left — used over water, or for a road straight across a highway (overpass)',
    ),
    'bridges-value',
  );
  private boulevards = badge(
    'button',
    'boulevard',
    L('Bulvar', 'Boulevard'),
    L('Bulvar — seç, sonra bir yolun üstünden sürükle', 'Boulevard — select, then drag along a road'),
    'boulevards-value',
  );
  private lights = badge(
    'button',
    'light',
    L('Işık', 'Light'),
    L(
      'Trafik ışığı — seç, sonra bir kavşağa dokun (tekrar dokununca kalkar)',
      'Traffic light — select, then tap a junction (tap again to remove)',
    ),
    'lights-value',
  );
  private roundabouts = badge(
    'button',
    'roundabout',
    L('Göbek', 'Roundabout'),
    L(
      'Göbekli kavşak — seç, sonra bir kavşağa dokun (tekrar dokununca kalkar)',
      'Roundabout — select, then tap a junction (tap again to remove)',
    ),
    'roundabouts-value',
  );
  private lines = badge(
    'button',
    'ferry',
    L('Hat', 'Line'),
    L(
      'Vapur/metro hattı — seç, iki yer arasında sürükle; bir durağa dokununca hat kalkar',
      'Ferry/metro line — select, drag between two places; tap a station to remove the line',
    ),
    'lines-value',
  );
  private parkings = badge(
    'button',
    'parking',
    L('Otopark', 'Car park'),
    L(
      'Otopark — seç, sonra bir iş yerine dokun: iş yerine ikinci bir giriş açılır',
      'Car park — select, then tap a workplace: it gets a second entrance',
    ),
    'parkings-value',
  );
  private erase = badge(
    'button',
    'erase',
    L('Sil', 'Erase'),
    L(
      'Silgi — seç ve yolun üstünden sürükle (ya da sağ tık)',
      'Eraser — select and drag along a road (or right-click)',
    ),
    null,
    'badge-light',
  );
  private legend: HTMLElement;
  /**
   * Light, roundabout and line tools. On wide screens they sit in the dock;
   * on phones they fold into a drawer behind the "Diğer" (more) button.
   */
  private drawer = h('div', { class: 'dock-drawer', id: 'dock-drawer' });
  private more = badge(
    'button',
    'menu',
    L('Diğer', 'More'),
    L('Diğer araçlar: ışık, göbek, hat, otopark', 'More tools: light, roundabout, line, car park'),
    null,
    'badge-light',
  );

  constructor(actions: ToolbarActions) {
    this.drawer.append(this.lights.root, this.roundabouts.root, this.lines.root, this.parkings.root);
    this.parkings.button.dataset.tool = 'parking';
    this.parkings.button.setAttribute('aria-pressed', 'false');
    this.parkings.button.addEventListener('click', () => actions.selectTool('parking'));
    this.more.button.id = 'btn-more-tools';
    this.more.button.setAttribute('aria-expanded', 'false');
    this.more.button.setAttribute('aria-controls', 'dock-drawer');
    this.more.button.addEventListener('click', () => this.setDrawer(!this.drawer.classList.contains('open')));
    // Picking a tool from the drawer closes it again.
    for (const b of [this.lights, this.roundabouts, this.lines, this.parkings])
      b.button.addEventListener('click', () => this.setDrawer(false));
    this.undoBadge.button.id = 'btn-undo';
    this.undoBadge.button.addEventListener('click', () => actions.undo());
    this.boulevards.button.dataset.tool = 'boulevard';
    this.boulevards.button.setAttribute('aria-pressed', 'false');
    this.boulevards.button.addEventListener('click', () => actions.selectTool('boulevard'));
    this.lights.button.dataset.tool = 'signal';
    this.lights.button.setAttribute('aria-pressed', 'false');
    this.lights.button.addEventListener('click', () => actions.selectTool('signal'));
    this.roundabouts.button.dataset.tool = 'roundabout';
    this.roundabouts.button.setAttribute('aria-pressed', 'false');
    this.roundabouts.button.addEventListener('click', () => actions.selectTool('roundabout'));
    this.lines.button.dataset.tool = 'transit';
    this.lines.button.setAttribute('aria-pressed', 'false');
    this.lines.button.addEventListener('click', () => actions.selectTool('transit'));
    this.erase.button.dataset.tool = 'erase';
    this.erase.button.setAttribute('aria-pressed', 'false');
    this.erase.button.addEventListener('click', () => actions.selectTool('erase'));

    this.legend = h(
      'div',
      { class: 'legend', hidden: true, 'aria-label': L('Trafik katmanı', 'Traffic layer') },
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-good' }), L('Akıcı', 'Flowing')),
      h('span', { class: 'legend-item' }, h('span', { class: 'swatch swatch-warn' }), L('Yoğun', 'Busy')),
      h(
        'span',
        { class: 'legend-item' },
        h('span', { class: 'swatch swatch-critical' }),
        L('Tıkalı ✕', 'Jammed ✕'),
      ),
    );
    this.root = h(
      'nav',
      { class: 'dock-wrap', 'aria-label': L('Yapı parçaları', 'Building pieces') },
      this.legend,
      h(
        'div',
        { class: 'dock' },
        this.undoBadge.root,
        h('span', { class: 'dock-sep', 'aria-hidden': 'true' }),
        this.roads.root,
        this.bridges.root,
        this.boulevards.root,
        this.drawer,
        this.more.root,
        h('span', { class: 'dock-sep', 'aria-hidden': 'true' }),
        this.erase.root,
      ),
    );
  }

  private setDrawer(open: boolean): void {
    this.drawer.classList.toggle('open', open);
    this.more.button.setAttribute('aria-expanded', String(open));
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
    set(this.roundabouts, res.roundabouts);
    set(this.lines, res.lines);
    set(this.parkings, res.parkings);
    const pk = this.parkings.button as HTMLButtonElement;
    pk.setAttribute('aria-pressed', String(tool === 'parking'));
    pk.disabled = !editable;
    const ln = this.lines.button as HTMLButtonElement;
    ln.setAttribute('aria-pressed', String(tool === 'transit'));
    ln.disabled = !editable;
    const rb = this.roundabouts.button as HTMLButtonElement;
    rb.setAttribute('aria-pressed', String(tool === 'roundabout'));
    rb.disabled = !editable;
    // The "more" button shows when one of its tools is in use.
    this.more.button.setAttribute(
      'aria-pressed',
      String(tool === 'signal' || tool === 'roundabout' || tool === 'transit' || tool === 'parking'),
    );
    const lt = this.lights.button as HTMLButtonElement;
    lt.setAttribute('aria-pressed', String(tool === 'signal'));
    // Lights can always be selected: placed ones can be taken away even with none left.
    lt.disabled = !editable;
    const bv = this.boulevards.button as HTMLButtonElement;
    bv.setAttribute('aria-pressed', String(tool === 'boulevard'));
    bv.disabled = !editable || (res.boulevards <= 0 && tool !== 'boulevard');
    // A map without water or highways has no use for bridges.
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
