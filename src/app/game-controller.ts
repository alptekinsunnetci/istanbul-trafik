import { GEOM, type GameMode, SIM } from '../core/constants';
import { BUILDING_TYPES, type Building, COLOR_NAMES } from '../core/world-state';
import { GameSession, type EditTool } from '../gameplay/game-session';
import { restoreSession, toSnapshot } from '../gameplay/snapshot';
import { districtById } from '../map/districts';
import { Terrain } from '../map/grid';
import { DEFAULT_SETTINGS, type Settings, bestScoreKey } from '../persistence/save-schema';
import { SaveManager, browserStorage, type WriteResult } from '../persistence/save-manager';
import { Renderer, UnsupportedRendererError } from '../rendering/renderer';
import { Announcer, type Modal, prefersReducedMotion } from '../ui/accessibility';
import { h } from '../ui/dom';
import { Hud, Toasts } from '../ui/hud';
import { MapInput } from '../ui/map-input';
import {
  MainMenu,
  confirmDialog,
  errorScreen,
  gameOverDialog,
  openHelp,
  pauseMenu,
  upgradeDialog,
} from '../ui/menus';
import { openSettings } from '../ui/settings';
import { Inspector, StatsPanel } from '../ui/statistics';
import { type Tool, Toolbar } from '../ui/toolbar';
import { CoachCard } from '../ui/tutorial';
import { AppStateMachine, STATE_LABELS } from './app-state';
import { GameLoop } from './game-loop';
import { SoundPlayer } from './sound';

const AUTOSAVE_INTERVAL = 20;

/** Fixed map for the guided tutorial so that its layout is always the same. */
const TUTORIAL = { district: 'kadikoy', seed: 2026 } as const;
const TOOL_LABELS: Record<Tool, string> = {
  road: 'Yol çizimi',
  boulevard: 'Bulvar seçildi: bir yolun üstünden sürükleyin',
  erase: 'Silgi seçildi',
  signal: 'Trafik ışığı seçildi: bir kavşağa dokunun',
};
const KEY_TOOLS: Record<string, Tool> = { '1': 'road', '2': 'boulevard', '3': 'erase', '4': 'signal' };

function randomSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] as number) % 1_000_000_000;
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

/**
 * Application shell: owns the state machine, the active session, the
 * renderer and all interface components, and routes input between them.
 */
export class GameController {
  private readonly state = new AppStateMachine();
  private readonly saves = new SaveManager(browserStorage());
  private settings: Settings = { ...DEFAULT_SETTINGS };
  private readonly sound = new SoundPlayer();
  private readonly announcer = new Announcer();
  private readonly toasts = new Toasts();
  private readonly stage = h('div', { class: 'stage' });
  private readonly ui = h('div', { class: 'ui' });
  private readonly tooltip = h('div', { class: 'tooltip', role: 'tooltip', hidden: true });
  private readonly banner = h('div', { class: 'banner', hidden: true });
  private renderer: Renderer | null = null;
  private input: MapInput | null = null;
  private session: GameSession | null = null;
  private sessionOff: (() => void)[] = [];
  private readonly loop: GameLoop;
  private readonly hud: Hud;
  private readonly toolbar: Toolbar;
  private readonly stats: StatsPanel;
  private readonly inspector: Inspector;
  private readonly menu: MainMenu;
  private readonly coach: CoachCard;
  /** Current step of the guided tutorial (0 = no tutorial running). */
  private tutorialStep = 0;
  private upgradeDeferred = false;
  /** Houses the tutorial asks for, fixed when it starts (the city keeps growing meanwhile). */
  private tutorialHouses: number[] = [];
  private modal: Modal | null = null;
  private tool: Tool = 'road';
  private speed = 1;
  private stroke: number[] | null = null;
  private keys = new Set<string>();
  private uiTimer = 0;
  private autosaveTimer = 0;
  private saveWarned = false;
  private resumeAfterMenu = false;
  private fatal = false;
  private readonly abort = new AbortController();

  constructor(private readonly root: HTMLElement) {
    this.loop = new GameLoop({
      running: () => this.state.simulationRunning && this.session !== null,
      speed: () => this.speed,
      step: () => this.session?.step(),
      frame: (alpha, dt, stepped) => this.frame(alpha, dt, stepped),
      error: (err) => this.fail(err),
    });
    this.hud = new Hud({
      toggleRun: () => this.toggleRun(),
      cycleSpeed: () => this.cycleSpeed(),
      openMenu: () => this.openPauseMenu(),
    });
    this.toolbar = new Toolbar({
      selectTool: (t) => this.selectTool(t),
      undo: () => this.undo(),
    });
    this.stats = new StatsPanel(() => this.toggleStats(false));
    this.inspector = new Inspector(() => this.clearSelection());
    this.coach = new CoachCard(() => this.endTutorial());
    this.menu = new MainMenu(
      {
        continueGame: () => this.continueGame(),
        newGame: (id, seed, mode) => this.newGame(id, seed ?? randomSeed(), mode),
        startTutorial: () => this.startTutorial(),
        setMode: (mode) => {
          this.settings = { ...this.settings, mode };
          this.saves.saveSettings(this.settings);
        },
        openSettings: () => this.openSettings(),
        openHelp: () => this.openHelp(),
      },
      () => this.saves.loadRecords().value,
      () => this.saves.hasSavedGame(),
      () => this.settings.mode,
    );
  }

  async init(): Promise<void> {
    this.root.replaceChildren(this.stage, this.ui);
    this.ui.append(
      this.hud.root,
      this.banner,
      this.stats.root,
      this.inspector.root,
      this.coach.root,
      this.toolbar.root,
      this.toasts.root,
      this.tooltip,
      this.announcer.el,
    );
    this.state.onChange((s, o) => {
      this.root.dataset.state = s;
      this.root.dataset.overlay = o;
      this.refreshChrome();
    });

    const loaded = this.saves.loadSettings();
    this.settings = loaded.value;
    if (loaded.warning) this.toasts.show(loaded.warning, 'warning');
    if (!this.saves.available)
      this.toasts.show(
        'Tarayıcı depolaması kullanılamıyor: ayarlar, skorlar ve oyun kaydedilmeyecek.',
        'warning',
        8000,
      );
    const recordsCheck = this.saves.loadRecords();
    if (recordsCheck.warning) this.toasts.show(recordsCheck.warning, 'warning');

    try {
      this.renderer = await Renderer.create(this.stage);
    } catch (err) {
      console.error(err);
      this.state.go('error');
      const unsupported = err instanceof UnsupportedRendererError;
      errorScreen(
        this.ui,
        unsupported ? 'Tarayıcınız desteklenmiyor' : 'Oyun başlatılamadı',
        unsupported
          ? 'İstanbul Trafik WebGL gerektirir. Donanım hızlandırmanın açık olduğundan emin olun veya güncel bir Chrome, Firefox, Edge ya da Safari sürümü kullanın.'
          : 'Grafik motoru başlatılırken beklenmeyen bir sorun oluştu.',
        [{ label: 'Tekrar dene', run: () => location.reload() }],
      );
      return;
    }
    this.applySettings(this.settings);
    this.input = new MapInput(this.renderer.canvas, {
      invertZoom: () => this.settings.invertZoom,
      cellAt: (x, y) => this.renderer?.cellAt(x, y) ?? -1,
      strokeStart: (c, erase) => this.strokeStart(c, erase),
      strokeMove: (c) => this.strokeMove(c),
      strokeEnd: (commit) => this.strokeEnd(commit),
      hover: (c, x, y) => this.hover(c, x, y),
      leave: () => this.hover(-1, 0, 0),
      tap: (x, y) => this.tap(x, y),
      pan: (dx, dy) => {
        this.renderer?.cancelCameraAnimation();
        this.renderer?.camera.pan(dx, dy);
      },
      zoomAt: (f, x, y) => {
        this.renderer?.cancelCameraAnimation();
        this.renderer?.camera.zoomAt(f, x, y);
      },
      interacted: () => this.sound.unlock(),
    });
    this.bindGlobalEvents();
    if (new URLSearchParams(location.search).has('e2e')) this.exposeTestHooks();
    this.loop.start();
    this.state.go('menu');
    this.menu.show(this.ui);
  }

  // ------------------------------------------------------------- lifecycle

  private bindGlobalEvents(): void {
    const opts = { signal: this.abort.signal };
    window.addEventListener('resize', () => this.renderer?.resize(), opts);
    window.addEventListener('keydown', (e) => this.keyDown(e), opts);
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()), opts);
    window.addEventListener('blur', () => this.keys.clear(), opts);
    window.addEventListener('pointerdown', () => this.sound.unlock(), opts);
    document.addEventListener(
      'visibilitychange',
      () => {
        if (document.visibilityState === 'hidden') {
          this.autosave();
          this.loop.reset();
        }
      },
      opts,
    );
    window.addEventListener('pagehide', () => this.autosave(), opts);
    window.addEventListener('error', (e) => this.fail(e.error ?? e.message), opts);
    window.addEventListener('unhandledrejection', (e) => this.fail(e.reason), opts);
    window
      .matchMedia?.('(prefers-reduced-motion: reduce)')
      .addEventListener('change', () => this.applySettings(this.settings), opts);
  }

  private fail(err: unknown): void {
    if (this.fatal) return;
    this.fatal = true;
    console.error('İstanbul Trafik: beklenmeyen hata', err);
    this.loop.stop();
    this.input?.destroy();
    this.modal?.close();
    if (this.state.can('error')) this.state.go('error');
    errorScreen(
      this.ui,
      'Beklenmeyen bir hata oluştu',
      'Oyun güvenli şekilde durduruldu. Son otomatik kayıttan devam edebilir veya yeni bir oyun başlatabilirsiniz.',
      [
        { label: 'Yeniden yükle', run: () => location.reload() },
        {
          label: 'Kaydı silip yeniden başlat',
          run: () => {
            this.saves.clearGame();
            location.reload();
          },
        },
      ],
    );
  }

  private attachSession(session: GameSession): void {
    this.detachSession(false);
    this.session = session;
    const ev = session.events;
    this.sessionOff.push(
      ev.on('notice', (n) => {
        this.toasts.show(n.text, n.kind);
        if (n.kind === 'error') this.sound.play('fail');
      }),
      ev.on('week', () => this.sound.play('week')),
      ev.on('gullCall', () => this.sound.play('gull')),
      ev.on('horn', () => this.sound.play('horn')),
      ev.on('gullCaught', (g) => {
        this.sound.play('collect');
        this.renderer?.popText(g.x, g.y - 6, `+${g.roads} yol`);
        this.announcer.say(`Martıyı yakaladın: +${g.roads} yol`);
        this.refreshChrome();
      }),
      ev.on('upgrade', () => this.showUpgrade()),
      ev.on('newColor', (c) => {
        this.toasts.show(`Yeni renk geldi: ${COLOR_NAMES[c] ?? ''}`, 'success');
        this.renderer?.networkChanged();
      }),
      ev.on('networkChanged', () => this.renderer?.networkChanged()),
      ev.on('buildingAdded', () => this.renderer?.networkChanged()),
      ev.on('boundsChanged', () => this.renderer?.boundsChanged()),
      ev.on('gameOver', (summary) => this.gameOver(summary)),
      session.sim.events.on('tripCompleted', (e) => {
        this.sound.play('arrive');
        this.renderer?.popScore(e.vehicle.destination);
      }),
    );
    this.renderer?.setSession(session);
    this.clearSelection();
    this.loop.reset();
    this.autosaveTimer = 0;
  }

  private detachSession(save: boolean): void {
    if (save) this.autosave();
    for (const off of this.sessionOff) off();
    this.sessionOff = [];
    this.session?.dispose();
    this.session = null;
    this.stroke = null;
    this.renderer?.setSession(null);
  }

  private newGame(districtId: string, seed: number, mode: GameMode, tutorial = false): void {
    if (!districtById(districtId)) return;
    this.menu.hide();
    this.modal?.close();
    this.modal = null;
    this.saves.clearGame();
    this.endTutorial(false);
    // Portrait phones get a tall playable area, landscape screens a wide one.
    const orientation = window.innerHeight > window.innerWidth ? 'tall' : 'wide';
    this.attachSession(new GameSession({ districtId, seed, mode, orientation }));
    this.state.go('ready');
    this.toasts.clear();
    if (tutorial) {
      // The clock stays stopped until the first road connects a house to its workplace.
      this.tutorialStep = 1;
      this.tutorialHouses = (this.tutorialTargets()?.houses ?? []).map((b) => b.id);
      this.updateTutorial();
      return;
    }
    // The game starts right away; demand begins slowly.
    this.toggleRun();
    this.announcer.say(`${this.session?.district.name}. Evleri aynı renkteki iş yerine yolla bağlayın.`);
  }

  // ------------------------------------------------------------- tutorial

  private startTutorial(): void {
    this.newGame(TUTORIAL.district, TUTORIAL.seed, 'rahat', true);
  }

  /** Buildings used by the tutorial: the workplace and its houses, nearest first. */
  private tutorialTargets(): { work: Building; houses: Building[] } | null {
    const s = this.session;
    if (!s) return null;
    const work = s.sim.buildings.find((b) => b.kind === 'ticari');
    if (!work) return null;
    const houses = s.sim.buildings
      .filter(
        (b) =>
          b.kind === 'konut' &&
          b.color === work.color &&
          (this.tutorialHouses.length === 0 || this.tutorialHouses.includes(b.id)),
      )
      .sort((a, b) => Math.hypot(a.x - work.x, a.y - work.y) - Math.hypot(b.x - work.x, b.y - work.y));
    return { work, houses };
  }

  /** Advances the guided tutorial when its goal is met and keeps the card and hint current. */
  private updateTutorial(): void {
    const s = this.session;
    const r = this.renderer;
    const t = this.tutorialTargets();
    if (!this.tutorialStep || !s || !r || !t) return;
    const total = 7;
    const first = t.houses[0];
    if (this.tutorialStep === 1) {
      if (first && s.sim.reachable(first, t.work)) {
        this.tutorialStep = 2;
        this.sound.play('week');
        if (this.state.state === 'ready') this.toggleRun();
      } else {
        r.setHint(first?.door ?? null, t.work.door);
        this.coach.show(
          1,
          total,
          'Kesik çizgiyi takip et: evden aynı renkteki iş yerine parmağınla ya da fareyle sürükleyerek yol çiz.',
        );
        return;
      }
    }
    if (this.tutorialStep === 2) {
      r.setHint(null, null);
      if (s.sim.stats.completed > 0) this.tutorialStep = 3;
      else {
        this.coach.show(2, total, 'Harika! Araba yola çıktı. Her ulaşan araba sana 1 puan kazandırır.');
        return;
      }
    }
    if (this.tutorialStep === 3) {
      const open = t.houses.find((h) => !s.sim.reachable(h, t.work));
      if (open) {
        r.setHint(open.door, t.work.door);
        this.coach.show(
          3,
          total,
          'İş yerinin yanındaki noktalar bekleyen arabalardır. Diğer evleri de bağla ki hepsi zamanında gelsin.',
        );
        return;
      }
      r.setHint(null, null);
      this.tutorialStep = 4;
    }
    const next = (): void => {
      this.tutorialStep++;
      this.updateTutorial();
    };
    const show = (step: number, text: string, last = false): void => {
      if (this.coach.root.dataset.step === String(step)) return;
      this.coach.show(
        step,
        total,
        text,
        last ? { label: 'Oynamaya devam', run: () => this.endTutorial() } : { label: 'Sonraki', run: next },
      );
    };
    if (this.tutorialStep === 4) {
      show(4, 'Yanlış mı çizdin? "Geri al"a bas ya da "Sil" ile yolu kaldır; parçalar geri gelir.');
      return;
    }
    if (this.tutorialStep === 5) {
      if (s.sim.junctions.signalCount > 0) {
        this.tutorialStep = 6;
        this.sound.play('build');
      } else {
        show(
          5,
          'Işıksız kavşakta karşıdan araç gelince sürücüler yavaşlar. "Işık"ı seç ve kalabalık bir kavşağa dokun: yönler sırayla yeşil yanar.',
        );
        return;
      }
    }
    if (this.tutorialStep === 6) {
      show(
        6,
        'Gri araçlar D-100 otoyolundan şehri geçer. Yolunu otoyola bağlayabilir ya da otoyolun üstünden düz geçerek üst geçit yapabilirsin (1 köprü parçası).',
      );
      return;
    }
    if (this.tutorialStep === 7) {
      show(
        7,
        'Kurbağalıdere ve deniz kıyısının karşısında da binalar çıkar. Suyun üstüne çizince yol kendiliğinden köprü olur. Şehir her hafta büyür; hazırsın!',
        true,
      );
    }
  }

  private endTutorial(startGame = true): void {
    if (!this.tutorialStep) return;
    this.tutorialStep = 0;
    this.tutorialHouses = [];
    this.coach.hide();
    this.renderer?.setHint(null, null);
    if (startGame && this.state.state === 'ready') this.toggleRun();
  }

  private undo(): void {
    const s = this.session;
    if (!s?.undo()) return;
    this.sound.play('erase');
    this.renderer?.refreshOverlay();
  }

  private showUpgrade(): void {
    const s = this.session;
    const options = s?.pendingUpgrades;
    if (!s || !options) return;
    // Never interrupt a drag: show the reward once the current stroke is finished.
    if (this.stroke) {
      this.upgradeDeferred = true;
      return;
    }
    this.modal?.close();
    this.sound.play('week');
    this.modal = upgradeDialog(this.ui, s.week, options, (i) => {
      this.modal = null;
      const choice = s.chooseUpgrade(i);
      if (choice) this.toasts.show(`${choice.label} eklendi`, 'success', 2000);
      this.loop.reset();
    });
  }

  private continueGame(): void {
    const loaded = this.saves.loadGame();
    if (!loaded.value) {
      this.toasts.show(loaded.warning ?? 'Kayıtlı oyun bulunamadı.', 'warning');
      this.menu.show(this.ui);
      return;
    }
    let session: GameSession;
    try {
      session = restoreSession(loaded.value);
    } catch (err) {
      console.warn('Kayıt geri yüklenemedi', err);
      this.saves.clearGame();
      this.toasts.show('Kayıtlı oyun bozuk veya uyumsuzdu ve silindi.', 'warning');
      this.menu.hide();
      this.menu.show(this.ui);
      return;
    }
    this.menu.hide();
    this.attachSession(session);
    if (session.phase === 'ready') session.start();
    this.state.go('paused');
    this.toasts.show('Kayıtlı oyun yüklendi. Devam etmek için Boşluk.', 'success');
    if (session.pendingUpgrades) this.showUpgrade();
  }

  private toMainMenu(): void {
    this.endTutorial(false);
    this.detachSession(true);
    this.inspector.hide();
    this.stats.open = false;
    this.state.go('menu');
    this.menu.show(this.ui);
  }

  private gameOver(summary: NonNullable<GameSession['summary']>): void {
    this.state.go('gameover');
    this.saves.clearGame();
    this.sound.play('gameover');
    const r = this.saves.addResult(summary);
    if (!r.write.ok) this.toasts.show(`Skor kaydedilemedi: ${r.write.error ?? ''}`, 'error');
    const best = r.records.bestScores[bestScoreKey(summary.districtId, summary.mode)] ?? summary.score;
    this.announcer.say(`Oyun bitti. Skor ${summary.score}.`);
    this.modal = gameOverDialog(this.ui, summary, r.newBest, best, {
      again: () => {
        this.modal = null;
        this.newGame(summary.districtId, randomSeed(), summary.mode);
      },
      otherDistrict: () => {
        this.modal = null;
        this.toMainMenu();
      },
    });
  }

  private autosave(): void {
    const s = this.session;
    if (!s || s.phase === 'over' || this.fatal) return;
    let result: WriteResult;
    try {
      result = this.saves.saveGame(toSnapshot(s));
    } catch (err) {
      console.warn('Otomatik kayıt başarısız', err);
      result = { ok: false, error: 'Oyun durumu kaydedilemedi.' };
    }
    if (!result.ok && !this.saveWarned) {
      this.saveWarned = true;
      this.toasts.show(`Otomatik kayıt yapılamadı: ${result.error ?? ''}`, 'error', 7000);
    } else if (result.ok) {
      this.saveWarned = false;
    }
  }

  // ---------------------------------------------------------------- frame

  private frame(alpha: number, dt: number, stepped: boolean): void {
    const r = this.renderer;
    if (!r) return;
    if (stepped) r.captureVehicles();
    this.panWithKeys(dt);
    r.render(this.state.simulationRunning ? alpha : 1, dt);

    const s = this.session;
    if (!s) return;
    this.uiTimer -= dt;
    if (this.uiTimer <= 0) {
      this.uiTimer = 0.1;
      this.hud.update(s, this.state.state, this.speed);
      this.toolbar.update(
        this.tool,
        this.renderer?.trafficOverlay ?? false,
        s.editable,
        s.resources,
        s.canUndo,
        s.usesBridges,
      );
      this.updateTutorial();
      this.updateBanner(s);
      this.stats.update(s);
      this.updateInspector();
    }
    if (this.state.state !== 'gameover') {
      this.autosaveTimer += dt;
      if (this.autosaveTimer >= AUTOSAVE_INTERVAL) {
        this.autosaveTimer = 0;
        this.autosave();
      }
    }
  }

  private refreshChrome(): void {
    const s = this.session;
    if (s && this.renderer) {
      this.hud.update(s, this.state.state, this.speed);
      this.updateBanner(s);
    }
    this.toolbar.update(
      this.tool,
      this.renderer?.trafficOverlay ?? false,
      s?.editable ?? false,
      s?.resources ?? { roads: 0, bridges: 0, boulevards: 0, lights: 0 },
      s?.canUndo ?? false,
      s?.usesBridges ?? true,
    );
  }

  /** A single onboarding hint until the first trip is completed. */
  private updateBanner(s: GameSession): void {
    const show = s.sim.stats.completed === 0 && this.state.state !== 'gameover' && this.tutorialStep === 0;
    this.banner.hidden = !show;
    if (show) this.banner.textContent = 'Evden aynı renkteki iş yerine sürükleyerek yol çiz';
  }

  // ------------------------------------------------------------- controls

  private toggleRun(): void {
    const s = this.session;
    if (!s || this.state.overlay !== 'none') return;
    const st = this.state.state;
    if (st === 'ready') {
      s.start();
      this.state.go('playing');
      this.loop.reset();
      this.announcer.say('Simülasyon başladı.');
    } else if (st === 'playing') {
      this.state.go('paused');
      this.autosave();
      this.announcer.say('Duraklatıldı.');
    } else if (st === 'paused') {
      this.state.go('playing');
      this.loop.reset();
      this.announcer.say('Devam ediliyor.');
    }
    this.sound.play('click');
  }

  private cycleSpeed(): void {
    const options = SIM.speedOptions;
    const i = options.findIndex((x) => x === this.speed);
    this.speed = options[(i + 1) % options.length] ?? 1;
    this.announcer.say(`Hız ${this.speed}×`);
    this.refreshChrome();
  }

  private askRestart(): void {
    const s = this.session;
    if (!s || this.modal) return;
    const wasPlaying = this.pauseForModal();
    this.modal = confirmDialog(
      this.ui,
      'Yeniden başlat',
      `${s.district.name} haritası baştan başlatılsın mı? Bu oyundaki ilerleme silinir.`,
      'Yeniden başlat',
      () => {
        this.modal = null;
        this.newGame(s.district.id, s.seed, s.mode);
      },
      () => {
        this.modal = null;
        if (wasPlaying) this.state.go('playing');
      },
    );
  }

  /** Pauses a running game for a dialog and reports whether it was running. */
  private pauseForModal(): boolean {
    if (this.state.state === 'playing') {
      this.state.go('paused');
      return true;
    }
    return false;
  }

  private openPauseMenu(): void {
    if (!this.session || this.modal || this.state.state === 'gameover') return;
    this.resumeAfterMenu = this.pauseForModal();
    this.modal = pauseMenu(this.ui, {
      resume: () => {
        this.modal = null;
        if (this.resumeAfterMenu && this.state.state === 'paused') {
          this.state.go('playing');
          this.loop.reset();
        }
      },
      restart: () => {
        this.modal = null;
        this.askRestart();
      },
      stats: () => {
        this.modal = null;
        this.toggleStats(true);
        if (this.resumeAfterMenu && this.state.state === 'paused') {
          this.state.go('playing');
          this.loop.reset();
        }
      },
      mainMenu: () => {
        this.modal = null;
        this.toMainMenu();
      },
      settings: () => {
        this.modal = null;
        this.openSettings();
      },
      help: () => {
        this.modal = null;
        this.openHelp();
      },
    });
  }

  private openSettings(): void {
    if (this.modal) return;
    this.state.setOverlay('settings');
    this.modal = openSettings(
      this.ui,
      this.settings,
      (next) => {
        this.applySettings(next);
        return this.saves.saveSettings(next);
      },
      () => {
        this.modal = null;
        this.state.setOverlay('none');
        this.loop.reset();
      },
      this.sound.supported,
    );
  }

  private openHelp(): void {
    if (this.modal) return;
    this.state.setOverlay('help');
    this.modal = openHelp(this.ui, () => {
      this.modal = null;
      this.state.setOverlay('none');
      this.loop.reset();
    });
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    this.sound.volume = s.volume;
    this.sound.muted = s.muted;
    const reduce = prefersReducedMotion(s.reduceMotion);
    this.root.classList.toggle('reduce-motion', reduce);
    this.root.classList.toggle('high-contrast', s.highContrast);
    this.renderer?.setOptions({ highContrast: s.highContrast, showGrid: s.showGrid, reduceMotion: reduce });
  }

  /** Boulevard and eraser are toggles: choosing them again returns to drawing roads. */
  private selectTool(t: Tool): void {
    if (this.stroke) this.strokeEnd(false);
    this.tool = t !== 'road' && this.tool === t ? 'road' : t;
    this.clearSelection();
    this.refreshChrome();
    this.announcer.say(TOOL_LABELS[this.tool]);
  }

  private toggleOverlay(): void {
    const r = this.renderer;
    if (!r) return;
    r.trafficOverlay = !r.trafficOverlay;
    r.refreshOverlay();
    this.refreshChrome();
  }

  private toggleStats(force?: boolean): void {
    this.stats.open = force ?? !this.stats.open;
    if (this.session) this.stats.update(this.session);
    this.refreshChrome();
  }

  private zoomStep(direction: 1 | -1): void {
    const r = this.renderer;
    if (!r) return;
    const rect = r.canvas.getBoundingClientRect();
    r.camera.zoomAt(direction > 0 ? 1.25 : 0.8, rect.width / 2, rect.height / 2);
  }

  private panWithKeys(dt: number): void {
    const r = this.renderer;
    if (!r || this.keys.size === 0) return;
    const v = 600 * this.settings.panSpeed * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx += v;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx -= v;
    if (this.keys.has('w') || this.keys.has('arrowup')) dy += v;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy -= v;
    if (dx !== 0 || dy !== 0) r.camera.pan(dx, dy);
  }

  private keyDown(e: KeyboardEvent): void {
    if (!this.modal && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) {
      e.preventDefault();
      this.undo();
      return;
    }
    if (this.modal || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const st = this.state.state;
    if (st !== 'ready' && st !== 'playing' && st !== 'paused' && st !== 'gameover') return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
      // Arrow keys on focused buttons keep their native behaviour.
      if (k.startsWith('arrow') && e.target instanceof HTMLButtonElement) return;
      this.keys.add(k);
      e.preventDefault();
      return;
    }
    const tool = KEY_TOOLS[k];
    if (tool) {
      this.selectTool(tool);
      return;
    }
    if (k === ' ' || k === 'spacebar') {
      if (e.target instanceof HTMLButtonElement) return;
      e.preventDefault();
      this.toggleRun();
    } else if (k === 't') this.toggleOverlay();
    else if (k === 'i') this.toggleStats();
    else if (k === 'f') this.renderer?.fitCamera();
    else if (k === '+' || k === '=') this.zoomStep(1);
    else if (k === '-' || k === '_') this.zoomStep(-1);
    else if (k === 'escape') {
      e.preventDefault();
      if (this.stroke) this.strokeEnd(false);
      else this.openPauseMenu();
    }
  }

  // ---------------------------------------------------------------- editing

  /** Tool used by the current stroke (the right mouse button always erases). */
  private strokeTool: EditTool = 'road';

  private editTool(): EditTool {
    return this.strokeTool;
  }

  private strokeStart(cell: number, erase: boolean): void {
    if (!this.session?.editable || cell < 0) return;
    this.strokeTool = erase ? 'erase' : this.tool;
    if (this.renderer) this.renderer.holdCamera = true;
    this.stroke = [cell];
    this.updatePreview();
  }

  private strokeMove(cell: number): void {
    if (!this.stroke || cell < 0 || this.stroke[this.stroke.length - 1] === cell) return;
    this.stroke.push(cell);
    this.updatePreview();
  }

  private updatePreview(): void {
    const tool = this.editTool();
    if (!this.session || !this.stroke || !tool) return;
    const p = this.session.preview(tool, this.stroke);
    this.renderer?.setPreview(p.cells, tool === 'erase');
    if (p.message) this.tooltipText(p.message);
  }

  private strokeEnd(commit: boolean): void {
    const tool = this.editTool();
    const s = this.session;
    const stroke = this.stroke;
    this.stroke = null;
    this.renderer?.setPreview(null, false);
    if (this.renderer) this.renderer.holdCamera = false;
    if (this.upgradeDeferred) {
      this.upgradeDeferred = false;
      window.setTimeout(() => this.showUpgrade(), 0);
    }
    if (!commit || !tool || !s || !stroke) return;
    const r = s.edit(tool, stroke);
    if (r.changed > 0) this.sound.play(tool === 'erase' ? 'erase' : 'build');
    // Erasing empty ground is harmless and stays silent.
    if (!r.ok && r.message && (tool !== 'erase' || r.changed > 0 || r.message.includes('silinemez'))) {
      this.toasts.show(r.message, 'warning', 2400);
      this.sound.play('invalid');
    }
    this.renderer?.refreshOverlay();
  }

  // ------------------------------------------------------------- hover/inspect

  private tooltipText(text: string): void {
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
  }

  private hover(cell: number, clientX: number, clientY: number): void {
    const s = this.session;
    const r = this.renderer;
    if (!s || !r) return;
    r.setHover(this.stroke ? -1 : cell);
    if (cell < 0) {
      this.tooltip.hidden = true;
      return;
    }
    const g = s.sim.grid;
    const bid = g.building[cell] as number;
    let text = '';
    if (bid >= 0) {
      const b = s.sim.buildingById(bid);
      if (b) {
        text =
          b.kind === 'kapi'
            ? `${b.name} · şehir dışına giden otoyol`
            : `${b.name} · ${COLOR_NAMES[b.color] ?? ''} ${BUILDING_TYPES[b.kind].label.toLocaleLowerCase('tr')}`;
        if (b.kind === 'konut' && b.pending.length > 0) text += ` · ${b.pending.length} araç bekliyor`;
        if (b.kind === 'konut' && b.unreachable && b.pending.length > 0) text += ' · iş yerine yol yok';
      }
    } else if (g.isRoad(cell)) {
      const node = s.sim.graph.node(cell);
      const lanes = g.lanes[cell] === 2 ? 'Bulvar' : 'Yol';
      text = g.isHighway(cell)
        ? `Otoyol${node && node.degree >= 3 ? ` · kavşak (${node.degree} kol)` : ''} · geçen trafik akar`
        : g.locked[cell] === 1
          ? 'Bina girişi'
          : node && node.degree >= 3
            ? `Kavşak (${node.degree} kol)`
            : lanes;
      if (g.isBridge(cell)) text += ' · Köprü';
    }
    if (!this.stroke) {
      if (text) {
        this.tooltipText(text);
      } else this.tooltip.hidden = true;
    }
    const rect = this.root.getBoundingClientRect();
    this.tooltip.style.transform = `translate(${Math.round(clientX - rect.left + 14)}px, ${Math.round(clientY - rect.top + 16)}px)`;
  }

  /**
   * A tap (no drag) on a vehicle or building inspects it instead of
   * editing. The erase tool always erases.
   */
  private tap(clientX: number, clientY: number): boolean {
    const s = this.session;
    const r = this.renderer;
    if (!s || !r) return false;
    // A gull can be caught with any tool.
    if (r.pickGull(clientX, clientY) && s.catchGull()) return true;
    // With the eraser or the light tool a tap edits instead of inspecting.
    if (this.tool === 'erase' || this.tool === 'signal') return false;
    const vid = r.pickVehicle(clientX, clientY);
    const cell = r.cellAt(clientX, clientY);
    const bid = vid === null && cell >= 0 ? (s.sim.grid.building[cell] as number) : -1;
    if (vid === null && bid < 0) {
      this.clearSelection();
      return false;
    }
    r.selectedVehicle = vid;
    r.selectedBuilding = bid >= 0 ? bid : null;
    this.updateInspector();
    return true;
  }

  private updateInspector(): void {
    const s = this.session;
    const r = this.renderer;
    if (!s || !r) return;
    if (r.selectedVehicle !== null) {
      if (!this.inspector.showVehicle(s, r.selectedVehicle)) {
        r.selectedVehicle = null;
        this.inspector.hide();
      }
    } else if (r.selectedBuilding !== null) {
      if (!this.inspector.showBuilding(s, r.selectedBuilding)) r.selectedBuilding = null;
    } else this.inspector.hide();
  }

  private clearSelection(): void {
    if (this.renderer) {
      this.renderer.selectedVehicle = null;
      this.renderer.selectedBuilding = null;
    }
    this.inspector.hide();
  }

  // ------------------------------------------------------------- test hooks

  /** Read-only hooks for browser tests, enabled only with the `?e2e` query parameter. */
  private exposeTestHooks(): void {
    const api = {
      state: () => ({
        app: this.state.state,
        label: STATE_LABELS[this.state.state],
        overlay: this.state.overlay,
        time: this.session?.sim.time ?? 0,
        vehicles: this.session?.sim.vehicles.length ?? 0,
        spawned: this.session?.sim.stats.spawned ?? 0,
        completed: this.session?.sim.stats.completed ?? 0,
        roads: this.session ? this.session.sim.grid.road.reduce((a, b) => a + b, 0) : 0,
        edges: this.session?.sim.graph.edges.size ?? 0,
        roadPieces: this.session?.resources.roads ?? 0,
        lights: this.session?.resources.lights ?? 0,
        signals: this.session?.sim.junctions.signalCount ?? 0,
        through: this.session?.sim.throughCompleted ?? 0,
        mode: this.session?.mode ?? null,
        canUndo: this.session?.canUndo ?? false,
        tutorialStep: this.tutorialStep,
        cameraMoving: this.renderer?.cameraMoving ?? false,
        upgradeOpen: this.session?.pendingUpgrades !== null && this.session !== null,
        tool: this.tool,
        speed: this.speed,
        visibleVehicles: this.renderer?.visibleVehicles ?? 0,
      }),
      /** Client coordinates of a 4-connected cell path between two building doors. */
      doorPath: (fromIndex: number, toIndex: number): { x: number; y: number }[] => {
        const s = this.session;
        const r = this.renderer;
        if (!s || !r) return [];
        const a = s.sim.buildings[fromIndex];
        const b = s.sim.buildings[toIndex];
        if (!a || !b) return [];
        return bfsPath(s, a.door, b.door).map((c) => r.cellToClient(c));
      },
      /** Building indices used by the tutorial: [houses nearest first..., workplace]. */
      tutorialPair: (): number[] => {
        const t = this.tutorialTargets();
        const list = this.session?.sim.buildings ?? [];
        return t ? [...t.houses.map((h) => list.indexOf(h)), list.indexOf(t.work)] : [];
      },
      /** Screen centre, entrance side and cell size of a building. */
      buildingInfo: (
        i: number,
      ): { x: number; y: number; doorDir: number; door: number; cellPx: number } | null => {
        const s = this.session;
        const r = this.renderer;
        const b = s?.sim.buildings[i];
        if (!s || !r || !b) return null;
        const tl = r.cellToClient(s.sim.grid.idx(b.x, b.y));
        const cellPx = r.camera.scale * GEOM.cellSize;
        return {
          x: tl.x + ((b.w - 1) * cellPx) / 2,
          y: tl.y + ((b.h - 1) * cellPx) / 2,
          doorDir: b.doorDir,
          door: b.door,
          cellPx,
        };
      },
      /** Client coordinates of junctions (three or more arms) built by the player. */
      junctions: (): { x: number; y: number }[] => {
        const s = this.session;
        const r = this.renderer;
        if (!s || !r) return [];
        const out: { x: number; y: number }[] = [];
        for (const [cell, node] of s.sim.graph.nodes)
          if (node.degree >= 3 && !s.sim.grid.isHighway(cell)) out.push(r.cellToClient(cell));
        return out;
      },
      cellSizePx: () => (this.renderer ? this.renderer.camera.scale * GEOM.cellSize : 0),
    };
    (window as unknown as { __istanbulTrafik: typeof api }).__istanbulTrafik = api;
  }
}

/**
 * Shortest walkable path for test hooks: avoids buildings, parks and other
 * entrances; may cross a highway. Land is preferred; water (a bridge) is
 * used only when there is no dry path.
 */
function bfsPath(s: GameSession, from: number, to: number): number[] {
  return walk(s, from, to, false) ?? walk(s, from, to, true) ?? [];
}

function walk(s: GameSession, from: number, to: number, water: boolean): number[] | null {
  const g = s.sim.grid;
  const prev = new Int32Array(g.size).fill(-2);
  prev[from] = -1;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i] as number;
    if (c === to) break;
    for (const d of [0, 1, 2, 3] as const) {
      const n = g.neighbor(c, d);
      if (n < 0 || prev[n] !== -2) continue;
      if (n !== to) {
        if (g.building[n] !== -1 || g.terrain[n] === Terrain.Park) continue;
        if (g.terrain[n] === Terrain.Water && !water) continue;
        if (g.locked[n] === 1 && !g.isHighway(n)) continue;
      }
      prev[n] = c;
      q.push(n);
    }
  }
  if (prev[to] === -2) return null;
  const out: number[] = [];
  for (let c = to; c !== -1; c = prev[c] as number) out.push(c);
  return out.reverse();
}
