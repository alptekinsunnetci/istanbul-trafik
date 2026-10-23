import { ECONOMY, type GameMode, MODES } from '../core/constants';
import type { GameSummary } from '../gameplay/game-over';
import { DIFFICULTY_LABELS, DISTRICTS, type District } from '../map/districts';
import { Terrain } from '../map/grid';
import { createDistrictGrid } from '../map/map-generator';
import { type Records, bestScoreKey } from '../persistence/save-schema';
import { SEASONS, seasonOf } from '../rendering/theme';
import { Modal } from './accessibility';
import { button, formatNumber, formatPercent, formatTime, h, icon } from './dom';

export interface MenuActions {
  continueGame(): void;
  newGame(districtId: string, seed: number | null, mode: GameMode): void;
  startTutorial(): void;
  setMode(mode: GameMode): void;
  openSettings(): void;
  openHelp(): void;
}

const DOTS: Record<District['difficulty'], string> = { kolay: '●○○', orta: '●●○', zor: '●●●' };

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** Small flat terrain thumbnail of a district in its own map colours (drawn once, cached). */
const previews = new Map<string, string>();
function districtPreview(d: District): HTMLImageElement {
  let url = previews.get(d.id);
  if (!url) {
    const grid = createDistrictGrid(d);
    const canvas = document.createElement('canvas');
    canvas.width = grid.width;
    canvas.height = grid.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const colors: Record<number, string> = {
        [Terrain.Land]: hex(d.palette.land),
        [Terrain.Water]: hex(d.palette.water),
        [Terrain.Park]: hex(d.palette.park),
      };
      for (let i = 0; i < grid.size; i++) {
        // Highways show as dark lines over land and water.
        ctx.fillStyle = grid.isHighway(i)
          ? '#58616f'
          : (colors[grid.terrain[i] as number] ?? hex(d.palette.land));
        ctx.fillRect(grid.cx(i), grid.cy(i), 1, 1);
      }
    }
    url = canvas.toDataURL();
    previews.set(d.id, url);
  }
  return h('img', { class: 'district-preview', src: url, alt: '', width: 64, height: 64 });
}

/** Start screen: districts first, everything else as quiet links. */
export class MainMenu {
  readonly root = h('section', { class: 'screen menu-screen', 'aria-labelledby': 'menu-title' });
  private view: 'home' | 'records' = 'home';

  constructor(
    private actions: MenuActions,
    private getRecords: () => Records,
    private hasSave: () => boolean,
    private getMode: () => GameMode,
  ) {}

  show(host: HTMLElement): void {
    this.view = 'home';
    this.render();
    host.append(this.root);
    this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  hide(): void {
    this.root.remove();
  }

  private go(view: 'home' | 'records'): void {
    this.view = view;
    this.render();
    this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  private render(): void {
    const panel = h(
      'div',
      { class: 'menu-panel' },
      h('h1', { id: 'menu-title', class: 'menu-title', text: 'İstanbul Trafik' }),
      h('p', { class: 'menu-tagline', text: 'Mahalleleri yollarla bağla. Trafik aksın, şehir büyüsün.' }),
    );
    panel.append(this.view === 'home' ? this.home() : this.records());
    this.root.replaceChildren(panel);
  }

  private home(): HTMLElement {
    const records = this.getRecords();
    const seedInput = h('input', {
      id: 'seed-input',
      type: 'text',
      inputmode: 'numeric',
      maxlength: 9,
      placeholder: 'Rastgele',
      'aria-describedby': 'seed-help',
    });
    const seedError = h('p', { class: 'field-error', id: 'seed-error', role: 'alert' });
    const advanced = h(
      'details',
      { class: 'advanced', id: 'advanced' },
      h('summary', { text: 'Harita tohumu' }),
      h(
        'div',
        { class: 'seed-row' },
        h('label', { for: 'seed-input', class: 'sr-only', text: 'Harita tohumu' }),
        seedInput,
        h('p', { class: 'field-help', id: 'seed-help', text: 'Aynı tohum aynı haritayı ve trafiği üretir.' }),
      ),
    );
    const readSeed = (): number | null | undefined => {
      const raw = seedInput.value.trim();
      if (raw === '') return null;
      if (!/^\d{1,9}$/.test(raw)) {
        seedError.textContent = 'Tohum 0 ile 999999999 arasında bir sayı olmalı.';
        seedInput.setAttribute('aria-invalid', 'true');
        advanced.open = true;
        return undefined;
      }
      seedError.textContent = '';
      seedInput.removeAttribute('aria-invalid');
      return Number(raw);
    };

    const grid = h('div', { class: 'district-grid', role: 'list', 'aria-label': 'İlçe seçin' });
    DISTRICTS.forEach((d, i) => {
      const best = records.bestScores[bestScoreKey(d.id, this.getMode())];
      const card = h(
        'button',
        {
          type: 'button',
          class: 'district-card',
          role: 'listitem',
          'data-district': d.id,
          'aria-label': `${d.name}, ${DIFFICULTY_LABELS[d.difficulty]}${best !== undefined ? `, en iyi ${best}` : ''}`,
          title: d.tagline,
        },
        districtPreview(d),
        h('span', { class: 'district-name', text: d.name }),
        h(
          'span',
          { class: 'district-meta' },
          h('span', { class: 'dots', 'aria-hidden': 'true', text: DOTS[d.difficulty] }),
          best !== undefined ? `En iyi ${formatNumber(best)}` : DIFFICULTY_LABELS[d.difficulty],
        ),
      );
      if (i === 0 && !this.hasSave()) card.dataset.autofocus = '';
      card.addEventListener('click', () => {
        const seed = readSeed();
        if (seed !== undefined) this.actions.newGame(d.id, seed, this.getMode());
      });
      grid.append(card);
    });

    const links = h('div', { class: 'menu-links' });
    links.append(
      button('Oynayarak öğren', () => this.actions.startTutorial(), {
        className: 'pill',
        id: 'btn-tutorial',
      }),
    );
    if (this.hasSave()) {
      const cont = button('Kaldığın yerden devam et', () => this.actions.continueGame(), {
        className: 'pill pill-primary',
        id: 'btn-continue',
      });
      cont.dataset.autofocus = '';
      links.append(cont);
    }
    links.append(
      button('Skorlar', () => this.go('records'), { className: 'link', id: 'btn-records' }),
      button('Ayarlar', () => this.actions.openSettings(), { className: 'link', id: 'btn-menu-settings' }),
      button('Nasıl oynanır?', () => this.actions.openHelp(), { className: 'link', id: 'btn-menu-help' }),
    );
    return h('div', { class: 'menu-section' }, this.modePicker(), grid, seedError, links, advanced);
  }

  /** Three big buttons: Rahat / Normal / Zor, with a one-line description. */
  private modePicker(): HTMLElement {
    const current = this.getMode();
    const group = h('div', { class: 'mode-picker', role: 'radiogroup', 'aria-label': 'Zorluk' });
    for (const m of ['rahat', 'normal', 'zor'] as const) {
      const rules = MODES[m];
      const b = h(
        'button',
        {
          type: 'button',
          class: 'mode-option',
          role: 'radio',
          'aria-checked': String(m === current),
          'data-mode': m,
        },
        h('strong', { text: rules.label }),
        h('span', { text: rules.text }),
      );
      b.addEventListener('click', () => {
        this.actions.setMode(m);
        this.render();
        this.root.querySelector<HTMLElement>(`[data-mode="${m}"]`)?.focus();
      });
      group.append(b);
    }
    return group;
  }

  private records(): HTMLElement {
    const r = this.getRecords();
    const best = h('ul', { class: 'records' });
    for (const d of DISTRICTS) {
      best.append(
        h(
          'li',
          {},
          h('span', { text: d.name }),
          h('strong', {
            text: bestText(r, d.id),
          }),
        ),
      );
    }
    const history = h('ul', { class: 'records' });
    if (r.history.length === 0)
      history.append(h('li', { class: 'muted', text: 'Henüz tamamlanmış oyun yok.' }));
    for (const s of r.history.slice(0, 8)) {
      history.append(
        h(
          'li',
          {},
          h('span', { text: s.districtName }),
          h('span', {
            class: 'muted',
            text: `${formatNumber(s.completed)} yolculuk · ${formatTime(s.duration)}`,
          }),
          h('strong', { text: formatNumber(s.score) }),
        ),
      );
    }
    const back = button('Geri', () => this.go('home'), { className: 'pill' });
    back.dataset.autofocus = '';
    return h(
      'div',
      { class: 'menu-section' },
      h('h2', { class: 'menu-h2', text: 'En iyi skorlar (Rahat · Normal · Zor)' }),
      best,
      h('h2', { class: 'menu-h2', text: 'Son oyunlar' }),
      history,
      h('p', { class: 'field-help', text: 'Skorlar yalnızca bu tarayıcıda saklanır.' }),
      back,
    );
  }
}

/** Best scores of a district per mode, e.g. "120 · 85 · —" (Rahat · Normal · Zor). */
function bestText(r: Records, districtId: string): string {
  return (['rahat', 'normal', 'zor'] as const)
    .map((m) => {
      const v = r.bestScores[bestScoreKey(districtId, m)];
      return v === undefined ? '—' : formatNumber(v);
    })
    .join(' · ');
}

export function helpContent(): HTMLElement {
  const keys: [string, string][] = [
    ['Binadan sürükle', 'Yol çiz: binadan başla, diğer binada bitir (su üstünde otomatik köprü)'],
    ['Geri al (Ctrl+Z)', 'Son çizimi geri al, parçalar geri gelir'],
    ['Sil ya da sağ tık + sürükle', 'Yolu sil (parçalar geri gelir)'],
    ['Işık, sonra kavşağa dokun', 'Trafik ışığı koy / kaldır (4)'],
    ['Araca / binaya dokun', 'Ayrıntıları gör'],
    ['Tekerlek, + / −', 'Yakınlaştır / uzaklaştır'],
    ['Orta tık + sürükle, W A S D', 'Haritayı kaydır'],
    ['Boşluk', 'Duraklat / devam'],
    ['T · I · F', 'Trafik katmanı · İstatistikler · Haritayı sığdır'],
    ['Dokunmatik', 'Tek parmak çizer, iki parmak kaydırır; silmek için silgiyi seç'],
  ];
  const table = h('table', { class: 'keys' }, h('caption', { class: 'sr-only', text: 'Kontroller' }));
  const tbody = h('tbody');
  for (const [k, v] of keys)
    tbody.append(h('tr', {}, h('th', { scope: 'row', text: k }), h('td', { text: v })));
  table.append(tbody);
  return h(
    'div',
    { class: 'help' },
    h(
      'ol',
      { class: 'help-rules' },
      h('li', {
        text: 'Evleri aynı renkteki (ve aynı sembollü) iş yerine yolla bağla. Arabalar evden iş yerine gider.',
      }),
      h('li', {
        text: 'İş yerindeki beyaz noktalar bekleyen yolculuklardır. Çok birikirse çevresinde kırmızı bir halka dolar.',
      }),
      h('li', {
        text: 'Halka tamamen dolarsa oyun biter (Rahat modda bitmez). Skorun, tamamlanan yolculuk sayısıdır.',
      }),
      h('li', { text: 'Şehir her hafta biraz büyür; soluk alan henüz kullanılamaz.' }),
      h('li', {
        text: `Yol parçaların sınırlı. Her hafta +${ECONOMY.weeklyRoads} yol gelir ve iki ödülden birini seçersin.`,
      }),
      h('li', {
        text: 'Tıkanan yerlerde ikinci bir yol aç ya da bulvar kullan: bulvarlar iki şeritli ve daha hızlıdır.',
      }),
      h('li', {
        text: 'Işıksız kavşakta karşı yönden araç gelirse sürücüler yavaşlayıp yol verir. Kalabalık bir kavşağa trafik ışığı koy: yönler sırayla yeşil yanar.',
      }),
      h('li', {
        text: 'D-100, O-1 gibi hazır otoyollar hızlıdır ve silinemez; üstlerinden şehir dışına giden gri araçlar akar. Yolunu otoyola bağlayabilirsin ama oluşan kavşak geçen trafiği de yavaşlatır.',
      }),
      h('li', {
        text: 'Dere, Haliç ya da Boğaz’ın karşı kıyısında da binalar çıkar: oraya köprüyle ulaşırsın. Otoyolun üstünden düz geçen yol üst geçit olur.',
      }),
      h('li', {
        text: 'Suyun üstünde ara sıra bir martı uçar: üstüne dokunursan +2 yol parçası kazanırsın.',
      }),
    ),
    table,
  );
}

const UPGRADE_ICONS: Record<string, string> = {
  roads: 'road',
  bridges: 'bridge',
  boulevards: 'boulevard',
  lights: 'light',
};

/** Weekly reward: two cards, one must be chosen (the game waits until then). */
export function upgradeDialog(
  host: HTMLElement,
  week: number,
  options: readonly { kind: string; label: string; text: string }[],
  choose: (index: number) => void,
): Modal {
  const modal = new Modal(
    `${week}. hafta başladı · ${SEASONS[seasonOf(week)] ?? ''}`,
    false,
    () => undefined,
    'dialog-upgrade',
  );
  modal.panel.id = 'upgrade-dialog';
  const cards = h('div', { class: 'upgrade-cards' });
  options.forEach((o, i) => {
    const card = h(
      'button',
      { type: 'button', class: 'upgrade-card', 'data-upgrade': String(i) },
      icon(UPGRADE_ICONS[o.kind] ?? 'road', 34),
      h('strong', { text: o.label }),
      h('span', { text: o.text }),
    );
    if (i === 0) card.dataset.autofocus = '';
    card.addEventListener('click', () => {
      modal.close();
      choose(i);
    });
    cards.append(card);
  });
  modal.panel.append(
    h('p', { class: 'upgrade-sub', text: `+${ECONOMY.weeklyRoads} yol parçası geldi. Bir ödül daha seç:` }),
    cards,
  );
  modal.open(host);
  return modal;
}

export function openHelp(host: HTMLElement, onClose: () => void): Modal {
  const modal = new Modal('Nasıl oynanır?', true, () => close(), 'dialog-wide');
  const close = (): void => {
    modal.close();
    onClose();
  };
  const ok = button('Anladım', close, { className: 'pill pill-primary' });
  ok.dataset.autofocus = '';
  modal.panel.append(helpContent(), h('div', { class: 'dialog-actions' }, ok));
  modal.panel.id = 'help-dialog';
  modal.open(host);
  return modal;
}

export function confirmDialog(
  host: HTMLElement,
  title: string,
  text: string,
  confirmLabel: string,
  onConfirm: () => void,
  onCancel: () => void,
): Modal {
  const modal = new Modal(title, true, () => cancel(), 'dialog-narrow');
  const cancel = (): void => {
    modal.close();
    onCancel();
  };
  const ok = button(
    confirmLabel,
    () => {
      modal.close();
      onConfirm();
    },
    { className: 'pill pill-primary', id: 'btn-confirm' },
  );
  const no = button('Vazgeç', cancel, { className: 'pill' });
  no.dataset.autofocus = '';
  modal.panel.append(h('p', { text }), h('div', { class: 'dialog-actions' }, no, ok));
  modal.open(host);
  return modal;
}

export interface PauseActions {
  resume: () => void;
  restart: () => void;
  mainMenu: () => void;
  stats: () => void;
  settings: () => void;
  help: () => void;
}

export function pauseMenu(host: HTMLElement, a: PauseActions): Modal {
  const modal = new Modal('Duraklatıldı', true, () => run(a.resume)(), 'dialog-narrow');
  modal.panel.id = 'pause-menu';
  const run = (fn: () => void) => (): void => {
    modal.close();
    fn();
  };
  const resume = button('Devam et', run(a.resume), { className: 'pill pill-primary', id: 'btn-resume' });
  resume.dataset.autofocus = '';
  modal.panel.append(
    h(
      'div',
      { class: 'stack' },
      resume,
      button('İstatistikler', run(a.stats), { className: 'pill', id: 'btn-pause-stats' }),
      button('Yeniden başlat', run(a.restart), { className: 'pill', id: 'btn-pause-restart' }),
      button('Ayarlar', run(a.settings), { className: 'pill', id: 'btn-pause-settings' }),
      button('Nasıl oynanır?', run(a.help), { className: 'pill', id: 'btn-pause-help' }),
      button('Ana menü', run(a.mainMenu), { className: 'pill pill-quiet', id: 'btn-to-menu' }),
    ),
  );
  modal.open(host);
  return modal;
}

export interface GameOverActions {
  again: () => void;
  otherDistrict: () => void;
}

export function gameOverDialog(
  host: HTMLElement,
  s: GameSummary,
  newBest: boolean,
  best: number,
  a: GameOverActions,
): Modal {
  const modal = new Modal('Oyun bitti', false, () => undefined, 'dialog-narrow');
  modal.panel.id = 'gameover-dialog';
  const rows: [string, string][] = [
    ['Süre', `${formatTime(s.duration)} · ${s.week}. hafta`],
    ['Tamamlanan yolculuk', formatNumber(s.completed)],
    ['Başarısız yolculuk', formatNumber(s.failed)],
    ['Ortalama yolculuk', `${formatNumber(s.averageTravelTime, 1)} sn`],
    ['Zamanında varış', formatPercent(s.onTimeRate)],
    ['Ağ verimliliği', formatPercent(s.efficiency)],
    ['En uzun kuyruk', `${formatNumber(s.longestQueue)} araç`],
  ];
  const dl = h('dl', { class: 'summary' });
  for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { text: v }));
  const again = button(
    'Tekrar oyna',
    () => {
      modal.close();
      a.again();
    },
    { className: 'pill pill-primary', id: 'btn-again' },
  );
  again.dataset.autofocus = '';
  modal.panel.append(
    h(
      'div',
      { class: 'final-score' },
      h('strong', { id: 'final-score', text: formatNumber(s.score) }),
      h('span', { text: newBest ? 'yolculuk · yeni rekor!' : `yolculuk · en iyi ${formatNumber(best)}` }),
    ),
    h('p', { class: 'gameover-reason', text: s.reason }),
    dl,
    h(
      'div',
      { class: 'dialog-actions' },
      button(
        'Başka ilçe',
        () => {
          modal.close();
          a.otherDistrict();
        },
        { className: 'pill' },
      ),
      again,
    ),
  );
  modal.open(host);
  return modal;
}

export function errorScreen(
  host: HTMLElement,
  title: string,
  message: string,
  actions: { label: string; run: () => void }[],
): HTMLElement {
  const el = h(
    'section',
    { class: 'screen error-screen', role: 'alert', 'aria-labelledby': 'error-title' },
    h(
      'div',
      { class: 'menu-panel' },
      h('h1', { id: 'error-title', class: 'menu-title', text: title }),
      h('p', { text: message }),
      h(
        'div',
        { class: 'stack' },
        ...actions.map((x, i) =>
          button(x.label, x.run, { className: `pill ${i === 0 ? 'pill-primary' : ''}` }),
        ),
      ),
    ),
  );
  host.append(el);
  el.querySelector<HTMLElement>('button')?.focus();
  return el;
}
