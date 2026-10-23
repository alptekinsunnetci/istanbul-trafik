import { BUILDING_TYPES, COLOR_NAMES } from '../core/world-state';
import { overflowUsed, pinsAt } from '../traffic/demand-generator';
import type { GameSession } from '../gameplay/game-session';
import { VEHICLE_KIND_LABELS, VEHICLE_STATE_LABELS } from '../traffic/vehicle-model';
import { button, formatNumber, formatPercent, formatTime, h } from './dom';

type Row = [label: string, value: string];

function rowsTo(dl: HTMLElement, rows: Row[]): void {
  const nodes: HTMLElement[] = [];
  for (const [k, v] of rows) nodes.push(h('dt', { text: k }), h('dd', { text: v }));
  dl.replaceChildren(...nodes);
}

/**
 * Side panel with statistics derived from the simulation, and the inspector
 * for a selected vehicle or building.
 */
export class StatsPanel {
  readonly root: HTMLElement;
  private dl = h('dl', { class: 'stats' });
  private reasons = h('dl', { class: 'stats stats-sub' });

  constructor(onClose: () => void) {
    this.root = h(
      'aside',
      { class: 'panel stats-panel', id: 'stats-panel', 'aria-labelledby': 'stats-title', hidden: true },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', { id: 'stats-title', text: 'Trafik istatistikleri' }),
        button('Paneli kapat', onClose, { icon: 'close', iconOnly: true, className: 'round round-small' }),
      ),
      this.dl,
      h('h3', { class: 'panel-h3', text: 'Yarıda kalan araçlar' }),
      this.reasons,
    );
  }

  set open(v: boolean) {
    this.root.hidden = !v;
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  update(session: GameSession): void {
    if (this.root.hidden) return;
    const sim = session.sim;
    const s = sim.stats;
    const q = sim.queues.snapshot;
    const avgTravel = s.completed > 0 ? s.totalTravelTime / s.completed : 0;
    const avgWait = s.completed > 0 ? s.totalWaitTime / s.completed : 0;
    const avgQueue = s.queueSamples > 0 ? s.queueSampleSum / s.queueSamples : 0;
    rowsTo(this.dl, [
      ['Toplam üretilen araç', formatNumber(s.spawned)],
      ['Tamamlanan yolculuk', formatNumber(s.completed)],
      ['Şehirden geçen araç', formatNumber(sim.throughCompleted)],
      ['Yarıda kalan araç', formatNumber(s.failed)],
      ['Aktif araç', formatNumber(sim.vehicles.length)],
      ['Bekleyen yolculuk', formatNumber(sim.totalPending())],
      ['Ortalama seyahat süresi', `${formatNumber(avgTravel, 1)} sn`],
      ['Ortalama bekleme süresi', `${formatNumber(avgWait, 1)} sn`],
      ['Zamanında varış', s.completed > 0 ? formatPercent(s.onTime / s.completed) : '—'],
      [
        'Ağ verimliliği',
        s.totalTravelTime > 0 ? formatPercent(Math.min(1, s.totalFreeFlowTime / s.totalTravelTime)) : '—',
      ],
      ['En uzun kuyruk (şimdi)', `${formatNumber(q.longestQueue)} araç`],
      ['En uzun kuyruk (oyun boyu)', `${formatNumber(s.longestQueueEver)} araç`],
      ['Ortalama kuyruk', `${formatNumber(avgQueue, 1)} araç`],
      ['Kuyruktaki araç', formatNumber(q.queuedVehicles)],
      ['Trafik yoğunluğu', `${formatNumber(q.density, 1)} araç/km`],
      ['Yol kullanım oranı', formatPercent(q.utilization)],
      ['Yol ağı', `${formatNumber(sim.graph.edges.size)} yön · ${formatNumber(sim.graph.nodes.size)} düğüm`],
      ['Kilitlenme noktası', formatNumber(sim.gridlocks.reduce((n, g) => n + g.nodes.length, 0))],
    ]);
    rowsTo(this.reasons, [
      ['Rota kalmadı', formatNumber(s.failedByReason.noRoute)],
      ['Yol silindi', formatNumber(s.failedByReason.roadRemoved)],
    ]);
  }
}

export class Inspector {
  readonly root: HTMLElement;
  private title = h('h2', { id: 'inspector-title' });
  private dl = h('dl', { class: 'stats' });

  constructor(onClose: () => void) {
    this.root = h(
      'aside',
      { class: 'panel inspector', id: 'inspector', 'aria-labelledby': 'inspector-title', hidden: true },
      h(
        'div',
        { class: 'panel-head' },
        this.title,
        button('Seçimi kaldır', onClose, { icon: 'close', iconOnly: true, className: 'round round-small' }),
      ),
      this.dl,
    );
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Returns false when the selected object no longer exists. */
  showVehicle(session: GameSession, id: number): boolean {
    const sim = session.sim;
    const v = sim.vehicleById(id);
    if (!v) return false;
    this.root.hidden = false;
    this.title.textContent = `${VEHICLE_KIND_LABELS[v.kind]} #${v.id}`;
    let remaining = 0;
    const start = v.junction ? v.routeIndex + 1 : v.routeIndex;
    for (let k = start; k < v.route.length; k++)
      remaining += sim.graph.edge(v.route[k] as string)?.centerLength ?? 0;
    if (!v.junction) remaining -= v.s;
    rowsTo(this.dl, [
      ['Durum', VEHICLE_STATE_LABELS[v.state]],
      ['Hız', `${formatNumber(v.v * 3.6)} km/sa`],
      ['Nereden', sim.buildingById(v.origin)?.name ?? '—'],
      ['Nereye', sim.buildingById(v.destination)?.name ?? '—'],
      ['Yolculuk süresi', formatTime(sim.time - v.departTime)],
      ['Toplam bekleme', `${formatNumber(v.waitTime, 1)} sn`],
      ['Kalan mesafe', v.state === 'noRoute' ? 'Rota yok' : `${formatNumber(Math.max(0, remaining))} m`],
      ['Şerit', v.laneChange ? `${v.laneChange.from + 1} → ${v.laneChange.to + 1}` : String(v.lane + 1)],
    ]);
    return true;
  }

  showBuilding(session: GameSession, id: number): boolean {
    const b = session.sim.buildingById(id);
    if (!b) return false;
    this.root.hidden = false;
    this.title.textContent = b.name;
    if (b.kind === 'kapi') {
      rowsTo(this.dl, [
        ['Tür', BUILDING_TYPES[b.kind].label],
        ['Şehre girmeyi bekleyen', formatNumber(b.pending.length)],
        ['Buradan çıkan araç', formatNumber(b.completed)],
      ]);
      return true;
    }
    rowsTo(this.dl, [
      ['Tür', BUILDING_TYPES[b.kind].label],
      ['Bekleyen araç', formatNumber(b.pending.length)],
      ['Gelen araç', formatNumber(b.incoming)],
      ['Ulaşan yolculuk', formatNumber(b.completed)],
      ['Başarısız', formatNumber(b.failed)],
      ['Renk', COLOR_NAMES[b.color] ?? String(b.color + 1)],
      ...(b.kind === 'ticari'
        ? ([
            ['Bekleyen (raptiye)', formatNumber(pinsAt(session.sim.buildings, b))],
            ['Taşma', formatPercent(overflowUsed(b))],
          ] as Row[])
        : ([['Bağlantı', b.unreachable ? 'İş yerine yol yok' : 'Bağlı']] as Row[])),
    ]);
    return true;
  }
}
