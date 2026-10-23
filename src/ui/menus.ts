import { ECONOMY, type GameMode, MODES } from '../core/constants';
import type { GameSummary } from '../gameplay/game-over';
import { DIFFICULTY_LABELS, DISTRICTS, type District } from '../map/districts';
import { Terrain } from '../map/grid';
import { createDistrictGrid } from '../map/map-generator';
import { type Records, bestScoreKey } from '../persistence/save-schema';
import { SEASONS, seasonOf } from '../rendering/theme';
import { ACHIEVEMENTS } from '../gameplay/achievements';
import { dailyMap } from '../gameplay/daily';
import { Modal } from './accessibility';
import { button, formatNumber, formatPercent, formatTime, h, icon } from './dom';
import { L, t } from '../core/i18n';

export interface MenuActions {
  continueGame(): void;
  newGame(districtId: string, seed: number | null, mode: GameMode): void;
  startTutorial(): void;
  setMode(mode: GameMode): void;
  openSettings(): void;
  openHelp(): void;
  startDaily(): void;
  openEditor(): void;
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
  private view: 'home' | 'records' | 'achievements' = 'home';

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

  private go(view: 'home' | 'records' | 'achievements'): void {
    this.view = view;
    this.render();
    this.root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }

  private render(): void {
    const panel = h(
      'div',
      { class: 'menu-panel' },
      h('h1', { id: 'menu-title', class: 'menu-title', text: 'İstanbul Trafik' }),
      h('p', {
        class: 'menu-tagline',
        text: L(
          'Mahalleleri yollarla bağla. Trafik aksın, şehir büyüsün.',
          'Link neighbourhoods with roads. Keep traffic flowing as the city grows.',
        ),
      }),
    );
    panel.append(
      this.view === 'home' ? this.home() : this.view === 'records' ? this.records() : this.achievements(),
    );
    this.root.replaceChildren(panel);
  }

  private home(): HTMLElement {
    const records = this.getRecords();
    const seedInput = h('input', {
      id: 'seed-input',
      type: 'text',
      inputmode: 'numeric',
      maxlength: 9,
      placeholder: L('Rastgele', 'Random'),
      'aria-describedby': 'seed-help',
    });
    const seedError = h('p', { class: 'field-error', id: 'seed-error', role: 'alert' });
    const advanced = h(
      'details',
      { class: 'advanced', id: 'advanced' },
      h('summary', { text: L('Harita tohumu', 'Map seed') }),
      h(
        'div',
        { class: 'seed-row' },
        h('label', { for: 'seed-input', class: 'sr-only', text: L('Harita tohumu', 'Map seed') }),
        seedInput,
        h('p', {
          class: 'field-help',
          id: 'seed-help',
          text: L(
            'Aynı tohum aynı haritayı ve trafiği üretir.',
            'The same seed gives the same map and traffic.',
          ),
        }),
      ),
    );
    const readSeed = (): number | null | undefined => {
      const raw = seedInput.value.trim();
      if (raw === '') return null;
      if (!/^\d{1,9}$/.test(raw)) {
        seedError.textContent = L(
          'Tohum 0 ile 999999999 arasında bir sayı olmalı.',
          'The seed must be a number from 0 to 999999999.',
        );
        seedInput.setAttribute('aria-invalid', 'true');
        advanced.open = true;
        return undefined;
      }
      seedError.textContent = '';
      seedInput.removeAttribute('aria-invalid');
      return Number(raw);
    };

    const grid = h('div', {
      class: 'district-grid',
      role: 'list',
      'aria-label': L('İlçe seçin', 'Choose a district'),
    });
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

    // The daily map: same district and seed for everyone today.
    const today = dailyMap(new Date());
    const todayDistrict = DISTRICTS.find((d) => d.id === today.districtId);
    const todayBest = records.daily[today.key];
    const daily = button(
      `${L('Günün haritası', 'Daily map')} · ${todayDistrict?.name ?? ''}${todayBest !== undefined ? ` · ${L('en iyi', 'best')} ${formatNumber(todayBest)}` : ''}`,
      () => this.actions.startDaily(),
      { className: 'pill daily-pill', id: 'btn-daily' },
    );
    const links = h('div', { class: 'menu-links' });
    links.append(daily);
    links.append(
      button(L('Oynayarak öğren', 'Learn by playing'), () => this.actions.startTutorial(), {
        className: 'pill',
        id: 'btn-tutorial',
      }),
    );
    if (this.hasSave()) {
      const cont = button(
        L('Kaldığın yerden devam et', 'Continue where you left off'),
        () => this.actions.continueGame(),
        {
          className: 'pill pill-primary',
          id: 'btn-continue',
        },
      );
      cont.dataset.autofocus = '';
      links.append(cont);
    }
    links.append(
      button(L('Skorlar', 'Scores'), () => this.go('records'), { className: 'link', id: 'btn-records' }),
      button(
        `${L('Başarımlar', 'Achievements')} ${records.achievements.length}/${ACHIEVEMENTS.length}`,
        () => this.go('achievements'),
        {
          className: 'link',
          id: 'btn-achievements',
        },
      ),
      button(L('Harita düzenleyici', 'Map editor'), () => this.actions.openEditor(), {
        className: 'link',
        id: 'btn-editor',
      }),
      button(L('Ayarlar', 'Settings'), () => this.actions.openSettings(), {
        className: 'link',
        id: 'btn-menu-settings',
      }),
      button(L('Nasıl oynanır?', 'How to play'), () => this.actions.openHelp(), {
        className: 'link',
        id: 'btn-menu-help',
      }),
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

  private achievements(): HTMLElement {
    const have = new Set(this.getRecords().achievements);
    const list = h('ul', { class: 'records achievements' });
    for (const a of ACHIEVEMENTS) {
      const done = have.has(a.id);
      list.append(
        h(
          'li',
          { class: done ? 'achieved' : 'muted' },
          h('span', { text: `${done ? '★' : '☆'} ${a.title}` }),
          h('span', { class: 'muted', text: a.text }),
        ),
      );
    }
    const back = button(L('Geri', 'Back'), () => this.go('home'), { className: 'pill' });
    back.dataset.autofocus = '';
    return h(
      'div',
      { class: 'menu-section' },
      h('h2', {
        class: 'menu-h2',
        text: `${L('Başarımlar', 'Achievements')} (${have.size}/${ACHIEVEMENTS.length})`,
      }),
      list,
      back,
    );
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
      history.append(
        h('li', { class: 'muted', text: L('Henüz tamamlanmış oyun yok.', 'No finished games yet.') }),
      );
    for (const s of r.history.slice(0, 8)) {
      history.append(
        h(
          'li',
          {},
          h('span', { text: s.districtName }),
          h('span', {
            class: 'muted',
            text: `${formatNumber(s.completed)} ${L('yolculuk', 'trips')} · ${formatTime(s.duration)}`,
          }),
          h('strong', { text: formatNumber(s.score) }),
        ),
      );
    }
    const back = button(L('Geri', 'Back'), () => this.go('home'), { className: 'pill' });
    back.dataset.autofocus = '';
    return h(
      'div',
      { class: 'menu-section' },
      h('h2', {
        class: 'menu-h2',
        text: L('En iyi skorlar (Rahat · Normal · Zor)', 'Best scores (Relaxed · Normal · Hard)'),
      }),
      best,
      h('h2', { class: 'menu-h2', text: L('Son oyunlar', 'Recent games') }),
      history,
      h('p', {
        class: 'field-help',
        text: L('Skorlar yalnızca bu tarayıcıda saklanır.', 'Scores are kept in this browser only.'),
      }),
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
    [
      L('Binadan sürükle', 'Drag from a building'),
      L(
        'Yol çiz: binadan başla, diğer binada bitir (su üstünde otomatik köprü)',
        'Draw a road: start at a building, end at another (bridges over water by themselves)',
      ),
    ],
    [
      L('Geri al (Ctrl+Z)', 'Undo (Ctrl+Z)'),
      L('Son çizimi geri al, parçalar geri gelir', 'Undo the last drawing, pieces come back'),
    ],
    [
      L('Sil ya da sağ tık + sürükle', 'Erase, or right-click + drag'),
      L('Yolu sil (parçalar geri gelir)', 'Remove the road (pieces come back)'),
    ],
    [
      L('Işık, sonra kavşağa dokun', 'Light, then tap a junction'),
      L('Trafik ışığı koy / kaldır (4)', 'Place / remove a traffic light (4)'),
    ],
    [
      L('Göbek, sonra kavşağa dokun', 'Roundabout, then tap a junction'),
      L('Göbekli kavşak koy / kaldır (5)', 'Place / remove a roundabout (5)'),
    ],
    [
      L('Hat, sonra iki yer arası sürükle', 'Line, then drag between two places'),
      L(
        'Vapur ya da metro hattı kur; durağa dokununca kalkar (6)',
        'Build a ferry or metro line; tap a station to remove it (6)',
      ),
    ],
    [L('Araca / binaya dokun', 'Tap a vehicle / building'), L('Ayrıntıları gör', 'See details')],
    [L('Tekerlek, + / −', 'Wheel, + / −'), L('Yakınlaştır / uzaklaştır', 'Zoom in / out')],
    [L('Orta tık + sürükle, W A S D', 'Middle-click + drag, W A S D'), L('Haritayı kaydır', 'Move the map')],
    [L('Boşluk', 'Space'), L('Duraklat / devam', 'Pause / resume')],
    [
      'T · I · F',
      L('Trafik katmanı · İstatistikler · Haritayı sığdır', 'Traffic layer · Statistics · Fit the map'),
    ],
    [
      L('Dokunmatik', 'Touch'),
      L(
        'Tek parmak çizer, iki parmak kaydırır; silmek için silgiyi seç',
        'One finger draws, two fingers move the map; pick the eraser to erase',
      ),
    ],
  ];
  const table = h(
    'table',
    { class: 'keys' },
    h('caption', { class: 'sr-only', text: L('Kontroller', 'Controls') }),
  );
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
        text: L(
          'Evleri aynı renkteki (ve aynı sembollü) iş yerine yolla bağla. Arabalar evden iş yerine gider.',
          'Connect houses to the workplace of the same colour (and symbol). Cars drive from home to work.',
        ),
      }),
      h('li', {
        text: L(
          'İş yerindeki beyaz noktalar bekleyen yolculuklardır. Çok birikirse çevresinde kırmızı bir halka dolar.',
          'Dots at a workplace are trips waiting. When too many pile up, a red ring around it fills.',
        ),
      }),
      h('li', {
        text: L(
          'Halka tamamen dolarsa oyun biter (Rahat modda bitmez). Skorun, tamamlanan yolculuk sayısıdır.',
          'When the ring is full the game ends (never in Relaxed mode). Your score is the number of finished trips.',
        ),
      }),
      h('li', {
        text: L(
          'Şehir her hafta biraz büyür; soluk alan henüz kullanılamaz.',
          'The city grows a little every week; the faded area cannot be used yet.',
        ),
      }),
      h('li', {
        text: L(
          `Yol parçaların sınırlı. Her hafta +${ECONOMY.weeklyRoads} yol gelir ve iki ödülden birini seçersin.`,
          `Road pieces are limited. Every week ${ECONOMY.weeklyRoads} more arrive and you choose one of two rewards.`,
        ),
      }),
      h('li', {
        text: L(
          'Tıkanan yerlerde ikinci bir yol aç ya da bulvar kullan: bulvarlar iki şeritli ve daha hızlıdır.',
          'Where it jams, open a second road or use a boulevard: boulevards have two lanes and are faster.',
        ),
      }),
      h('li', {
        text: L(
          'Işıksız kavşakta karşı yönden araç gelirse sürücüler yavaşlayıp yol verir. Kalabalık bir kavşağa trafik ışığı koy: yönler sırayla yeşil yanar.',
          'At a junction without lights, drivers slow down and give way to crossing traffic. Put a traffic light on a busy junction: directions take turns.',
        ),
      }),
      h('li', {
        text: L(
          'D-100, O-1 gibi hazır otoyollar hızlıdır ve silinemez; üstlerinden şehir dışına giden gri araçlar akar. Yolunu otoyola bağlayabilirsin ama oluşan kavşak geçen trafiği de yavaşlatır.',
          'Ready-made highways such as D-100 and O-1 are fast and cannot be erased; grey cars pass through on them. You can join your roads to a highway, but the junction slows passing traffic too.',
        ),
      }),
      h('li', {
        text: L(
          'Dere, Haliç ya da Boğaz’ın karşı kıyısında da binalar çıkar: oraya köprüyle ulaşırsın. Otoyolun üstünden düz geçen yol üst geçit olur.',
          'Buildings also appear across streams, the Golden Horn or the Bosphorus: reach them by bridge. A road straight across a highway becomes an overpass.',
        ),
      }),
      h('li', {
        text: L(
          'Göbek: kavşağa göbek koyarsan araçlar durmadan, yavaşlayarak döner. Hat: iki yer arasında sürükleyerek vapur (su üstünden) ya da metro hattı kur; evden yürüyen yolcular karşı durakta otobüse ya da taksiye biner.',
          'Roundabout: cars go round without stopping, just slowing down. Line: drag between two places to build a ferry (across water) or metro line; people walk from home and take a bus or taxi at the far end.',
        ),
      }),
      h('li', {
        text: L(
          'Sabah ve akşam iş saatlerinde trafik artar, gece azalır. 3. haftadan sonra maç günü, yağmur ve yol çalışması gibi olaylar olur.',
          'Traffic rises in the morning and evening rush hours and drops at night. From week 3 there are events such as match days, rain and road works.',
        ),
      }),
      h('li', {
        text: L(
          'Suyun üstünde ara sıra bir martı uçar: üstüne dokunursan +2 yol parçası kazanırsın.',
          'Now and then a gull flies over the water: tap it to win 2 road pieces.',
        ),
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
  roundabouts: 'roundabout',
  lines: 'ferry',
  parkings: 'parking',
};

/** Weekly reward: two cards, one must be chosen (the game waits until then). */
export function upgradeDialog(
  host: HTMLElement,
  week: number,
  options: readonly { kind: string; label: string; text: string }[],
  choose: (index: number) => void,
): Modal {
  const modal = new Modal(
    `${L(`${week}. hafta başladı`, `Week ${week} begins`)} · ${t(SEASONS[seasonOf(week)] ?? '')}`,
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
    h('p', {
      class: 'upgrade-sub',
      text: L(
        `+${ECONOMY.weeklyRoads} yol parçası geldi. Bir ödül daha seç:`,
        `+${ECONOMY.weeklyRoads} road pieces arrived. Choose one more reward:`,
      ),
    }),
    cards,
  );
  modal.open(host);
  return modal;
}

/** First-visit welcome: the rules in four lines, and a recommendation to learn by playing. */
export function introDialog(host: HTMLElement, a: { tutorial: () => void; later: () => void }): Modal {
  const modal = new Modal(
    L('İstanbul Trafik’e hoş geldin!', 'Welcome to İstanbul Trafik!'),
    true,
    () => later(),
    'dialog-narrow',
  );
  modal.panel.id = 'intro-dialog';
  const later = (): void => {
    modal.close();
    a.later();
  };
  const learn = button(
    L('Oynayarak öğren (önerilen)', 'Learn by playing (recommended)'),
    () => {
      modal.close();
      a.tutorial();
    },
    { className: 'pill pill-primary', id: 'btn-intro-tutorial' },
  );
  learn.dataset.autofocus = '';
  modal.panel.append(
    h(
      'ol',
      { class: 'help-rules' },
      h('li', {
        text: L(
          'Evleri aynı renkteki iş yerine yolla bağla: binadan binaya sürükle.',
          'Connect houses to the workplace of the same colour: drag from building to building.',
        ),
      }),
      h('li', {
        text: L(
          'İş yerindeki noktalar bekleyen yolculuklardır; çok birikirse halka dolar.',
          'Dots at a workplace are waiting trips; when too many pile up, its ring fills.',
        ),
      }),
      h('li', {
        text: L(
          'Her ulaşan yolcu 1 puan. Şehir her hafta büyür, yeni parçalar gelir.',
          'Every arrival is 1 point. The city grows every week and new pieces arrive.',
        ),
      }),
      h('li', {
        text: L(
          'Kalabalık kavşaklara ışık ya da göbek koy; suyu vapurla, uzağı metroyla geç.',
          'Put lights or roundabouts on busy junctions; cross water by ferry, distance by metro.',
        ),
      }),
    ),
    h('p', {
      class: 'intro-tip',
      text: L(
        'İlk kez oynuyorsan 2 dakikalık rehberli oyunla başlamanı öneririz.',
        'Playing for the first time? We recommend the 2-minute guided game.',
      ),
    }),
    h(
      'div',
      { class: 'dialog-actions' },
      button(L('Şimdilik geç', 'Skip for now'), later, {
        className: 'pill pill-quiet',
        id: 'btn-intro-later',
      }),
      learn,
    ),
  );
  modal.open(host);
  return modal;
}

export function openHelp(host: HTMLElement, onClose: () => void): Modal {
  const modal = new Modal(L('Nasıl oynanır?', 'How to play'), true, () => close(), 'dialog-wide');
  const close = (): void => {
    modal.close();
    onClose();
  };
  const ok = button(L('Anladım', 'Got it'), close, { className: 'pill pill-primary' });
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
  const no = button(L('Vazgeç', 'Cancel'), cancel, { className: 'pill' });
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
  const modal = new Modal(L('Duraklatıldı', 'Paused'), true, () => run(a.resume)(), 'dialog-narrow');
  modal.panel.id = 'pause-menu';
  const run = (fn: () => void) => (): void => {
    modal.close();
    fn();
  };
  const resume = button(L('Devam et', 'Resume'), run(a.resume), {
    className: 'pill pill-primary',
    id: 'btn-resume',
  });
  resume.dataset.autofocus = '';
  modal.panel.append(
    h(
      'div',
      { class: 'stack' },
      resume,
      button(L('İstatistikler', 'Statistics'), run(a.stats), { className: 'pill', id: 'btn-pause-stats' }),
      button(L('Yeniden başlat', 'Restart'), run(a.restart), { className: 'pill', id: 'btn-pause-restart' }),
      button(L('Ayarlar', 'Settings'), run(a.settings), { className: 'pill', id: 'btn-pause-settings' }),
      button(L('Nasıl oynanır?', 'How to play'), run(a.help), { className: 'pill', id: 'btn-pause-help' }),
      button(L('Ana menü', 'Main menu'), run(a.mainMenu), {
        className: 'pill pill-quiet',
        id: 'btn-to-menu',
      }),
    ),
  );
  modal.open(host);
  return modal;
}

export interface GameOverActions {
  again: () => void;
  otherDistrict: () => void;
  /** Shares the result (shown for the daily map). */
  share?: () => void;
}

export function gameOverDialog(
  host: HTMLElement,
  s: GameSummary,
  newBest: boolean,
  best: number,
  a: GameOverActions,
): Modal {
  const modal = new Modal(L('Oyun bitti', 'Game over'), false, () => undefined, 'dialog-narrow');
  modal.panel.id = 'gameover-dialog';
  const rows: [string, string][] = [
    [L('Süre', 'Time'), `${formatTime(s.duration)} · ${L(`${s.week}. hafta`, `week ${s.week}`)}`],
    [L('Tamamlanan yolculuk', 'Finished trips'), formatNumber(s.completed)],
    [L('Başarısız yolculuk', 'Failed trips'), formatNumber(s.failed)],
    [L('Ortalama yolculuk', 'Average trip'), `${formatNumber(s.averageTravelTime, 1)} ${L('sn', 's')}`],
    [L('Zamanında varış', 'On time'), formatPercent(s.onTimeRate)],
    [L('Ağ verimliliği', 'Network efficiency'), formatPercent(s.efficiency)],
    [L('En uzun kuyruk', 'Longest queue'), `${formatNumber(s.longestQueue)} ${L('araç', 'vehicles')}`],
  ];
  const dl = h('dl', { class: 'summary' });
  for (const [k, v] of rows) dl.append(h('dt', { text: k }), h('dd', { text: v }));
  const again = button(
    L('Tekrar oyna', 'Play again'),
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
      h('span', {
        text: newBest
          ? L('yolculuk · yeni rekor!', 'trips · new record!')
          : `${L('yolculuk · en iyi', 'trips · best')} ${formatNumber(best)}`,
      }),
    ),
    h('p', { class: 'gameover-reason', text: s.reason }),
    dl,
    h(
      'div',
      { class: 'dialog-actions' },
      ...(a.share
        ? [button(L('Paylaş', 'Share'), () => a.share?.(), { className: 'pill', id: 'btn-share' })]
        : []),
      button(
        L('Başka ilçe', 'Other district'),
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
