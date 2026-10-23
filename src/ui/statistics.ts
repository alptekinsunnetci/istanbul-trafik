import { BUILDING_TYPES, COLOR_NAMES } from '../core/world-state';
import { overflowUsed, pinsAt } from '../traffic/demand-generator';
import type { GameSession } from '../gameplay/game-session';
import { VEHICLE_KIND_LABELS, VEHICLE_STATE_LABELS } from '../traffic/vehicle-model';
import { button, formatNumber, formatPercent, formatTime, h } from './dom';
import { L } from '../core/i18n';

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
        h('h2', { id: 'stats-title', text: L('Trafik istatistikleri', 'Traffic statistics') }),
        button(L('Paneli kapat', 'Close panel'), onClose, {
          icon: 'close',
          iconOnly: true,
          className: 'round round-small',
        }),
      ),
      this.dl,
      h('h3', { class: 'panel-h3', text: L('Yarıda kalan araçlar', 'Vehicles that gave up') }),
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
      [L('Toplam üretilen araç', 'Vehicles started'), formatNumber(s.spawned)],
      [L('Tamamlanan yolculuk', 'Finished trips'), formatNumber(s.completed)],
      [L('Şehirden geçen araç', 'Vehicles passing through'), formatNumber(sim.throughCompleted)],
      [L('Yarıda kalan araç', 'Vehicles that gave up'), formatNumber(s.failed)],
      [L('Aktif araç', 'Active vehicles'), formatNumber(sim.vehicles.length)],
      ['Bekleyen yolculuk', formatNumber(sim.totalPending())],
      [L('Ortalama seyahat süresi', 'Average travel time'), `${formatNumber(avgTravel, 1)} sn`],
      [L('Ortalama bekleme süresi', 'Average waiting time'), `${formatNumber(avgWait, 1)} sn`],
      [L('Zamanında varış', 'On time'), s.completed > 0 ? formatPercent(s.onTime / s.completed) : '—'],
      [
        L('Ağ verimliliği', 'Network efficiency'),
        s.totalTravelTime > 0 ? formatPercent(Math.min(1, s.totalFreeFlowTime / s.totalTravelTime)) : '—',
      ],
      [
        L('En uzun kuyruk (şimdi)', 'Longest queue (now)'),
        `${formatNumber(q.longestQueue)} ${L('araç', 'vehicles')}`,
      ],
      ['En uzun kuyruk (oyun boyu)', `${formatNumber(s.longestQueueEver)} ${L('araç', 'vehicles')}`],
      ['Ortalama kuyruk', `${formatNumber(avgQueue, 1)} ${L('araç', 'vehicles')}`],
      [L('Kuyruktaki araç', 'Vehicles queued'), formatNumber(q.queuedVehicles)],
      [
        L('Trafik yoğunluğu', 'Traffic density'),
        `${formatNumber(q.density, 1)} ${L('araç/km', 'vehicles/km')}`,
      ],
      [L('Yol kullanım oranı', 'Road use'), formatPercent(q.utilization)],
      [
        L('Yol ağı', 'Road network'),
        `${formatNumber(sim.graph.edges.size)} ${L('yön', 'links')} · ${formatNumber(sim.graph.nodes.size)} ${L('düğüm', 'nodes')}`,
      ],
      [
        L('Kilitlenme noktası', 'Gridlocks'),
        formatNumber(sim.gridlocks.reduce((n, g) => n + g.nodes.length, 0)),
      ],
    ]);
    rowsTo(this.reasons, [
      [L('Rota kalmadı', 'No route left'), formatNumber(s.failedByReason.noRoute)],
      [L('Yol silindi', 'Road erased'), formatNumber(s.failedByReason.roadRemoved)],
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
        button(L('Seçimi kaldır', 'Clear selection'), onClose, {
          icon: 'close',
          iconOnly: true,
          className: 'round round-small',
        }),
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
      [L('Durum', 'State'), VEHICLE_STATE_LABELS[v.state]],
      [L('Hız', 'Speed'), `${formatNumber(v.v * 3.6)} km/sa`],
      [L('Nereden', 'From'), sim.buildingById(v.origin)?.name ?? '—'],
      [L('Nereye', 'To'), sim.buildingById(v.destination)?.name ?? '—'],
      [L('Yolculuk süresi', 'Trip time'), formatTime(sim.time - v.departTime)],
      [L('Toplam bekleme', 'Total waiting'), `${formatNumber(v.waitTime, 1)} sn`],
      [
        L('Kalan mesafe', 'Distance left'),
        v.state === 'noRoute' ? L('Rota yok', 'No route') : `${formatNumber(Math.max(0, remaining))} m`,
      ],
      [
        L('Şerit', 'Lane'),
        v.laneChange ? `${v.laneChange.from + 1} → ${v.laneChange.to + 1}` : String(v.lane + 1),
      ],
    ]);
    return true;
  }

  showBuilding(session: GameSession, id: number): boolean {
    const b = session.sim.buildingById(id);
    if (!b) return false;
    this.root.hidden = false;
    this.title.textContent = b.name;
    if (b.transit) {
      const t = b.transit;
      const onBoard = t.riders.filter((r) => r.readyAt > session.sim.time).length;
      rowsTo(this.dl, [
        [
          L('Tür', 'Type'),
          t.mode === 'vapur' ? L('Vapur iskelesi', 'Ferry pier') : L('Metro istasyonu', 'Metro station'),
        ],
        [L('Hatta yolcu', 'Riding the line'), formatNumber(onBoard)],
        [
          L('Taksi/otobüs bekleyen', 'Waiting for taxi/bus'),
          formatNumber(t.riders.length - onBoard + b.pending.length),
        ],
        [L('Karşı durak', 'Other end'), session.sim.buildingById(t.partner)?.name ?? '—'],
      ]);
      return true;
    }
    if (b.kind === 'otopark') {
      rowsTo(this.dl, [
        [L('Tür', 'Type'), L('Otopark', 'Car park')],
        [L('İş yeri', 'Workplace'), session.sim.buildingById(b.parkingFor ?? -1)?.name ?? '—'],
      ]);
      return true;
    }
    if (b.kind === 'kapi') {
      rowsTo(this.dl, [
        [L('Tür', 'Type'), BUILDING_TYPES[b.kind].label],
        [L('Şehre girmeyi bekleyen', 'Waiting to enter'), formatNumber(b.pending.length)],
        [L('Buradan çıkan araç', 'Vehicles that left here'), formatNumber(b.completed)],
      ]);
      return true;
    }
    rowsTo(this.dl, [
      [L('Tür', 'Type'), BUILDING_TYPES[b.kind].label],
      [L('Bekleyen araç', 'Waiting vehicles'), formatNumber(b.pending.length)],
      [L('Gelen araç', 'Vehicles on the way'), formatNumber(b.incoming)],
      [L('Ulaşan yolculuk', 'Arrived trips'), formatNumber(b.completed)],
      [L('Başarısız', 'Failed'), formatNumber(b.failed)],
      [L('Renk', 'Colour'), COLOR_NAMES[b.color] ?? String(b.color + 1)],
      ...(b.kind === 'ticari'
        ? ([
            [L('Bekleyen (raptiye)', 'Waiting (pins)'), formatNumber(pinsAt(session.sim.buildings, b))],
            [L('Taşma', 'Overflow'), formatPercent(overflowUsed(b))],
          ] as Row[])
        : ([
            [
              L('Bağlantı', 'Connection'),
              b.unreachable ? L('İş yerine yol yok', 'No road to the workplace') : L('Bağlı', 'Connected'),
            ],
          ] as Row[])),
    ]);
    return true;
  }
}
