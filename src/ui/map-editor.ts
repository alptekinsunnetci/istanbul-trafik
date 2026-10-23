import {
  type CustomMap,
  MAP_SIZE,
  emptyMap,
  encodeMap,
  mapFromDistrict,
  mapProblem,
} from '../map/custom-map';
import { DISTRICTS } from '../map/districts';
import { Terrain } from '../map/grid';
import { button, h } from './dom';
import { L } from '../core/i18n';

type EditorTool = 'land' | 'water' | 'park' | 'highway' | 'start';

export interface MapEditorActions {
  play(map: CustomMap): void;
  back(): void;
  /** Copies (or shares) a text; returns whether it worked. */
  share(text: string): Promise<boolean>;
}

const COLORS = { land: '#f3e9dc', water: '#8fc4d6', park: '#bfdcb4', highway: '#434b59', grid: '#e4d6c3' };
const TOOL_LABELS: Record<EditorTool, string> = {
  land: L('Kara', 'Land'),
  water: L('Su', 'Water'),
  park: L('Park', 'Park'),
  highway: L('Otoyol', 'Highway'),
  start: L('Başlangıç', 'Start'),
};

/**
 * Map editor: paint land, water and parks, draw straight highways, set the
 * starting point and a name; then play the map or copy a link to share it.
 * The map is 64 × 64 cells, the same size as the districts.
 */
export class MapEditor {
  readonly root = h('section', {
    class: 'screen editor-screen',
    id: 'map-editor',
    'aria-label': L('Harita düzenleyici', 'Map editor'),
  });
  private map: CustomMap = emptyMap();
  private tool: EditorTool = 'water';
  private brush = 2;
  private canvas = h('canvas', { class: 'editor-canvas', id: 'editor-canvas', 'aria-label': 'Harita' });
  private message = h('p', { class: 'field-status', role: 'status' });
  private nameInput = h('input', { id: 'editor-name', type: 'text', maxlength: 40 });
  private toolButtons = new Map<EditorTool, HTMLElement>();
  private drag: { from: [number, number]; to: [number, number] } | null = null;
  private painting = false;

  constructor(private actions: MapEditorActions) {
    this.build();
  }

  show(host: HTMLElement, map?: CustomMap): void {
    this.map = map ?? emptyMap();
    this.nameInput.value = this.map.name;
    this.message.textContent = '';
    host.append(this.root);
    this.resize();
    this.draw();
  }

  hide(): void {
    this.root.remove();
  }

  private build(): void {
    const tools = h('div', { class: 'editor-tools', role: 'radiogroup', 'aria-label': L('Fırça', 'Brush') });
    for (const t of Object.keys(TOOL_LABELS) as EditorTool[]) {
      const b = button(TOOL_LABELS[t], () => this.setTool(t), { className: 'pill', id: `editor-tool-${t}` });
      b.setAttribute('role', 'radio');
      this.toolButtons.set(t, b);
      tools.append(b);
    }
    const brush = h('select', { id: 'editor-brush', 'aria-label': L('Fırça boyu', 'Brush size') });
    for (const [v, label] of [
      ['1', L('İnce fırça', 'Thin brush')],
      ['2', L('Orta fırça', 'Medium brush')],
      ['4', L('Kalın fırça', 'Thick brush')],
    ] as const) {
      const o = h('option', { value: v, text: label });
      if (Number(v) === this.brush) o.selected = true;
      brush.append(o);
    }
    brush.addEventListener('change', () => (this.brush = Number(brush.value)));
    const template = h('select', { id: 'editor-template', 'aria-label': L('Şablon', 'Template') });
    template.append(h('option', { value: '', text: L('Şablondan başla…', 'Start from a template…') }));
    for (const d of DISTRICTS) template.append(h('option', { value: d.id, text: d.name }));
    template.addEventListener('change', () => {
      const d = DISTRICTS.find((x) => x.id === template.value);
      if (d) this.load(mapFromDistrict(d));
      template.value = '';
    });
    this.nameInput.addEventListener(
      'input',
      () => (this.map.name = this.nameInput.value.trim() || L('Benim semtim', 'My neighbourhood')),
    );

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      const cell = this.cellAt(e);
      if (this.tool === 'highway') this.drag = { from: cell, to: cell };
      else if (this.tool === 'start') this.map.center = cell;
      else {
        this.painting = true;
        this.paint(cell);
      }
      this.draw();
    });
    c.addEventListener('pointermove', (e) => {
      const cell = this.cellAt(e);
      if (this.drag) this.drag.to = cell;
      else if (this.painting) this.paint(cell);
      else return;
      this.draw();
    });
    const end = (): void => {
      if (this.drag) this.addHighway(this.drag.from, this.drag.to);
      this.drag = null;
      this.painting = false;
      this.draw();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    window.addEventListener('resize', () => {
      if (this.root.isConnected) {
        this.resize();
        this.draw();
      }
    });

    this.setTool('water');
    this.root.append(
      h(
        'div',
        { class: 'editor-panel' },
        h('h1', { class: 'menu-title editor-title', text: L('Harita düzenleyici', 'Map editor') }),
        h(
          'div',
          { class: 'editor-row' },
          h('label', { for: 'editor-name', text: L('Semtin adı', 'Name') }),
          this.nameInput,
          template,
        ),
        h('div', { class: 'editor-row' }, tools, brush),
        h('p', {
          class: 'field-help',
          text: L(
            'Fırçayla kara, su ve park boya. Otoyol: iki nokta arasında sürükle (harita kenarına kadar çizersen şehir dışından araç gelir). Başlangıç: oyunun başlayacağı yere dokun.',
            'Paint land, water and parks with the brush. Highway: drag between two points (draw it to the map edge and cars come in from outside). Start: tap where the game should begin.',
          ),
        }),
        this.canvas,
        this.message,
        h(
          'div',
          { class: 'dialog-actions' },
          button(L('Geri', 'Back'), () => this.actions.back(), {
            className: 'pill pill-quiet',
            id: 'btn-editor-back',
          }),
          button(
            L('Otoyolları temizle', 'Clear highways'),
            () => {
              this.map.highways = [];
              this.draw();
            },
            { className: 'pill pill-quiet' },
          ),
          button(L('Bağlantıyı kopyala', 'Copy link'), () => void this.share(), {
            className: 'pill',
            id: 'btn-editor-share',
          }),
          button(L('Oyna', 'Play'), () => this.play(), {
            className: 'pill pill-primary',
            id: 'btn-editor-play',
          }),
        ),
      ),
    );
  }

  private load(map: CustomMap): void {
    this.map = map;
    this.nameInput.value = map.name;
    this.draw();
  }

  private setTool(t: EditorTool): void {
    this.tool = t;
    for (const [k, b] of this.toolButtons) {
      b.setAttribute('aria-checked', String(k === t));
      b.classList.toggle('pill-primary', k === t);
    }
  }

  private cellAt(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * MAP_SIZE);
    const y = Math.floor(((e.clientY - r.top) / r.height) * MAP_SIZE);
    return [Math.min(MAP_SIZE - 1, Math.max(0, x)), Math.min(MAP_SIZE - 1, Math.max(0, y))];
  }

  private paint([cx, cy]: [number, number]): void {
    const value = this.tool === 'water' ? Terrain.Water : this.tool === 'park' ? Terrain.Park : Terrain.Land;
    const r = this.brush - 1;
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) this.map.terrain[y * MAP_SIZE + x] = value;
  }

  private addHighway(from: [number, number], to: [number, number]): void {
    if (from[0] === to[0] && from[1] === to[1]) return;
    if (this.map.highways.length >= 6) {
      this.message.textContent = L('En fazla 6 otoyol çizilebilir.', 'At most 6 highways can be drawn.');
      return;
    }
    // Straight, or one corner: first along x, then along y.
    const path: [number, number][] =
      from[0] === to[0] || from[1] === to[1] ? [from, to] : [from, [to[0], from[1]], to];
    this.map.highways.push({ name: `OTOYOL ${this.map.highways.length + 1}`, path });
  }

  private resize(): void {
    const size = Math.max(256, Math.min(window.innerWidth - 48, window.innerHeight - 320, 640));
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const s = this.canvas.width / MAP_SIZE;
    for (let y = 0; y < MAP_SIZE; y++)
      for (let x = 0; x < MAP_SIZE; x++) {
        const t = this.map.terrain[y * MAP_SIZE + x];
        ctx.fillStyle = t === Terrain.Water ? COLORS.water : t === Terrain.Park ? COLORS.park : COLORS.land;
        ctx.fillRect(x * s, y * s, s + 0.5, s + 0.5);
      }
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 0.5;
    for (let k = 0; k <= MAP_SIZE; k += 8) {
      ctx.beginPath();
      ctx.moveTo(k * s, 0);
      ctx.lineTo(k * s, this.canvas.height);
      ctx.moveTo(0, k * s);
      ctx.lineTo(this.canvas.width, k * s);
      ctx.stroke();
    }
    const lines = [...this.map.highways.map((hw) => hw.path)];
    if (this.drag) {
      const { from, to } = this.drag;
      lines.push(from[0] === to[0] || from[1] === to[1] ? [from, to] : [from, [to[0], from[1]], to]);
    }
    ctx.strokeStyle = COLORS.highway;
    ctx.lineWidth = s * 0.9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const path of lines) {
      ctx.beginPath();
      path.forEach(([x, y], k) =>
        k === 0 ? ctx.moveTo((x + 0.5) * s, (y + 0.5) * s) : ctx.lineTo((x + 0.5) * s, (y + 0.5) * s),
      );
      ctx.stroke();
    }
    // Start: the first playable area is drawn around it.
    const [cx, cy] = this.map.center;
    ctx.strokeStyle = '#d03b3b';
    ctx.lineWidth = Math.max(2, s * 0.3);
    ctx.strokeRect((cx - 9) * s, (cy - 6) * s, 18 * s, 12 * s);
    ctx.beginPath();
    ctx.arc((cx + 0.5) * s, (cy + 0.5) * s, s * 0.9, 0, Math.PI * 2);
    ctx.stroke();
  }

  private play(): void {
    this.map.name = this.nameInput.value.trim() || L('Benim semtim', 'My neighbourhood');
    const problem = mapProblem(this.map);
    if (problem) {
      this.message.textContent = `${problem}: ${L('başlangıcı karaya taşı ya da daha çok kara boya.', 'move the start onto land or paint more land.')}`;
      this.message.dataset.kind = 'error';
      return;
    }
    this.actions.play(this.map);
  }

  private async share(): Promise<void> {
    this.map.name = this.nameInput.value.trim() || L('Benim semtim', 'My neighbourhood');
    const url = `${location.origin}${location.pathname}#harita=${encodeMap(this.map)}`;
    const ok = await this.actions.share(url);
    this.message.textContent = ok
      ? L('Bağlantı kopyalandı: açan kişi bu haritayı görür.', 'Link copied: whoever opens it sees this map.')
      : L('Bağlantı kopyalanamadı.', 'The link could not be copied.');
    this.message.dataset.kind = ok ? 'ok' : 'error';
  }
}
