/**
 * Central tuning configuration. Every balance coefficient lives here so that
 * gameplay can be tuned without touching simulation code.
 * Units: metres, seconds, metres/second.
 */

export const SIM = {
  /** Fixed simulation steps per second. */
  tickRate: 20,
  /** Upper bound of simulation steps executed for a single rendered frame. */
  maxStepsPerFrame: 12,
  /** Frame gaps longer than this (seconds) are treated as a pause (background tab). */
  maxFrameGap: 0.25,
  speedOptions: [1, 2, 4] as const,
} as const;

export const DT = 1 / SIM.tickRate;

export const GEOM = {
  /** Size of one grid cell in metres. */
  cellSize: 16,
  laneWidth: 3.2,
  /** Half-size of the junction box at every graph node. */
  junctionRadius: 3,
} as const;

export const MAP = {
  defaultWidth: 64,
  defaultHeight: 64,
} as const;

export const ROAD = {
  /** 50 km/h */
  streetSpeed: 13.9,
  /** 70 km/h */
  boulevardSpeed: 19.4,
  /** 90 km/h on the pre-built highways (E-5, O-1, …). */
  highwaySpeed: 25,
  /** Turning speed inside a junction. */
  turnSpeed: 7,
  /** Nominal saturation flow per lane, vehicles per hour. */
  laneCapacityPerHour: 1800,
} as const;

/** Intelligent Driver Model parameters. */
export const IDM = {
  maxAccel: 1.6,
  comfortDecel: 2.4,
  /** Physical upper bound on braking, used to clamp numerical overshoot. */
  maxDecel: 9,
  minGap: 2,
  timeHeadway: 1.2,
  delta: 4,
} as const;

export const LANE_CHANGE = {
  duration: 1.8,
  /** No lane change within this distance of the start/end of an edge. */
  edgeMargin: 12,
  /** Max deceleration imposed on the new follower (MOBIL safety criterion). */
  safeDecel: 3,
  politeness: 0.3,
  /** Required acceleration gain for a discretionary lane change. */
  threshold: 0.35,
  /** Distance before the stop line where vehicles start preparing for a turn. */
  mandatoryLookahead: 140,
  cooldown: 3,
} as const;

export const JUNCTION = {
  /** Extra margin added to the braking distance when requesting a reservation. */
  requestMargin: 4,
  minRequestDistance: 6,
  /** After this wait the request blocks its zones for lower-priority requests. */
  starvationTime: 6,
  /** Vehicles standing still this long at a junction are considered stuck. */
  stuckTime: 12,
  /**
   * Give way at junctions without lights: when traffic approaches on the
   * crossing road (within `yieldWatch` metres), a car may only enter after
   * slowing to `yieldSpeed` within `yieldDistance` of the stop line.
   */
  yieldWatch: 30,
  yieldDistance: 5,
  yieldSpeed: 3,
} as const;

/**
 * Traffic lights (demand-actuated: north–south and east–west, each followed
 * by a protected left-turn phase when cars wait to turn left).
 * A green phase lasts at least `minGreen`; it ends early when its direction
 * has nobody waiting but the other one does, and at the latest after
 * `maxGreen`. Between phases the junction is all-red until the box is clear.
 */
export const SIGNAL = {
  minGreen: 4,
  maxGreen: 14,
  clearance: 1.5,
  /** Protected left-turn phase, only when cars are waiting to turn left. */
  minLeft: 2.5,
  maxLeft: 7,
} as const;

/** Roundabouts: no stopping and no phases; cars slow down to enter and go round the island. */
export const ROUNDABOUT = {
  /** Cars may only ask to enter below this speed. */
  entrySpeed: 8,
  /** How far the paths through the box swing out around the island (m). */
  bulge: 2.6,
} as const;

export const ROUTING = {
  /** Extra seconds per queued vehicle and lane. */
  queueWeight: 1.8,
  /** Weight of the measured average junction delay of an edge. */
  junctionDelayWeight: 1,
  /** Penalty multiplier for occupancy relative to lane storage capacity. */
  densityWeight: 6,
  /** Fixed cost per junction movement (seconds). */
  junctionBaseCost: 1.2,
  turnCost: 1.0,
  /** Penalty for unpopular bridges is not modelled; bridges are normal edges. */
  rerouteInterval: 4,
  /** Switch only when the new route is this much (relative) cheaper... */
  rerouteImprovement: 0.18,
  /** ...and at least this many seconds cheaper. */
  rerouteMinGain: 4,
  noRouteRetry: 2,
  noRouteTimeout: 40,
  /** Cached routes are refreshed after this many seconds of simulation time. */
  cacheTtl: 4,
  junctionDelaySmoothing: 0.15,
} as const;

export const VEHICLE_TYPES = {
  car: { length: 4.5, speedFactor: 1, weight: 0.68 },
  taxi: { length: 4.6, speedFactor: 1.05, weight: 0.22 },
  dolmus: { length: 6.2, speedFactor: 0.9, weight: 0.1 },
  /** Only for passengers leaving a ferry pier or metro station together (never picked at random). */
  otobus: { length: 11, speedFactor: 0.85, weight: 0 },
} as const;

export type VehicleKind = keyof typeof VEHICLE_TYPES;

/**
 * Demand: every workplace periodically gets a new "pin" (a trip request)
 * that a house of the same colour must serve by sending a car.
 */
export const DEMAND = {
  /** Seconds between new pins at one workplace at minute 0. */
  pinInterval: 10,
  pinIntervalMin: 3.5,
  /** The interval shrinks by this many seconds per simulated minute. */
  pinIntervalDecayPerMinute: 0.45,
  /** Delay before a new workplace receives its first pin. */
  firstPinDelay: 6,
  /** Hard cap of simultaneously active vehicles. */
  maxActiveVehicles: 600,
  /** Trips a single house may have queued. */
  maxPendingPerHouse: 8,
  /** Overflow drains this many times faster than it fills. */
  overflowRecovery: 1.5,
  /** New buildings are shown this long before they take part in demand. */
  newBuildingGrace: 8,
  /** Pending trips of unreachable houses are moved to reachable ones this often. */
  reassignInterval: 2,
} as const;

/**
 * Through traffic: cars that enter the map at one end of a highway and leave
 * at another. They score nothing but load the roads they use.
 */
export const THROUGH = {
  /** Seconds between cars entering at one gateway at minute 0... */
  interval: 7,
  /** ...shrinking by this much per simulated minute down to the minimum. */
  decayPerMinute: 0.25,
  intervalMin: 3.5,
  /** A gateway never queues more cars than this; extra cars are simply dropped. */
  maxPending: 3,
  /**
   * Share of highway cars that come into the city (to a house or workplace
   * the highway can reach) and of cars that leave the city from a connected
   * workplace onto the highway. The rest only pass through.
   */
  inboundShare: 0.25,
  outboundShare: 0.2,
  /** A workplace queues at most this many cars that leave the city. */
  maxOutboundPerWorkplace: 2,
  firstDelay: 3,
} as const;

/**
 * Little city life: gulls over open water (tap one for road pieces), horns
 * in heavy jams (limited, never endless) and the metrobüs on the D-100/O-1.
 */
export const AMBIENCE = {
  gullFirst: 30,
  gullIntervalMin: 40,
  gullIntervalMax: 80,
  /** Seconds a gull stays before flying off. */
  gullLife: 14,
  gullSpeed: 7,
  /** How often a flying gull calls, and how many times at most. */
  gullCallEvery: 4.5,
  gullCalls: 3,
  gullReward: 2,
  /** A queue this long (or a gridlock) counts as a heavy jam. */
  hornQueue: 8,
  /** Seconds between horn bursts, at most this many per jam, and calm time that ends a jam. */
  hornGap: 7,
  hornMaxPerJam: 3,
  hornCalm: 15,
  metrobusInterval: 30,
  metrobusSpeed: 16,
} as const;

/** Time of day: rush hours bring more trips, nights fewer. */
export const DAYTIME = {
  dayStartHour: 6,
  rushMorning: 8.5,
  rushEvening: 17.5,
  rushWidth: 1.4,
  /** Extra demand at the height of a rush hour. */
  rushBoost: 0.55,
  /** Less demand deep in the night. */
  nightDip: 0.45,
} as const;

/**
 * City events, one at a time from week 3: a match day around a workplace,
 * rain that slows every car down, or road works that close a street.
 */
export const EVENTS = {
  firstWeek: 3,
  gapMin: 70,
  gapMax: 120,
  durationMin: 30,
  durationMax: 45,
  /** Pins at the match workplace come this many times faster. */
  matchBoost: 3,
  /** Speed of all traffic in the rain. */
  rainSpeed: 0.8,
} as const;

/** Ferry and metro lines (vapur / metro hattı). */
export const TRANSIT = {
  /** Houses this many cells from a station can walk to it. */
  walkRadius: 7,
  /** Walking time per cell, seconds. */
  walkPerCell: 1.5,
  ferryTime: 18,
  metroTime: 10,
  /** Timetable: a ferry arrives every 15 s, a metro every 8 s, and lets everyone off together. */
  ferryEvery: 15,
  metroEvery: 8,
  /** Passengers for the same workplace who share a bus instead of taxis. */
  busMin: 3,
  busCapacity: 8,
  /** When a pin could go by road or by line, this share takes the line. */
  share: 0.45,
  /** Stations of one line are at least this many cells apart. */
  minLength: 6,
  /** A line is a ferry line when at least this share of it runs over water. */
  ferryWater: 0.4,
} as const;

export const TIPS = {
  /** Queue length (vehicles) at which the traffic-light tip appears once. */
  queueForLight: 6,
} as const;

export type GameMode = 'rahat' | 'normal' | 'zor';

export interface ModeRules {
  label: string;
  text: string;
  /** Multiplies the time between pins (higher = calmer). */
  pinIntervalFactor: number;
  /** Pins at which a workplace starts to overflow. */
  overflowPins: number;
  /** Seconds of continuous overflow until the game is lost. */
  overflowTime: number;
  /** In endless mode a full overflow never ends the game. */
  endless: boolean;
}

export const MODES: Record<GameMode, ModeRules> = {
  rahat: {
    label: 'Rahat',
    text: 'Oyun bitmez, sakin tempo',
    pinIntervalFactor: 1.7,
    overflowPins: 9,
    overflowTime: 60,
    endless: true,
  },
  normal: {
    label: 'Normal',
    text: 'Dengeli tempo',
    pinIntervalFactor: 1.25,
    overflowPins: 8,
    overflowTime: 75,
    endless: false,
  },
  zor: {
    label: 'Zor',
    text: 'Hızlı tempo',
    pinIntervalFactor: 1,
    overflowPins: 7,
    overflowTime: 45,
    endless: false,
  },
};

export const DEFAULT_MODE: GameMode = 'normal';

/** The playable area starts small and grows every week, so the map always fits the screen. */
export const PLAYFIELD = {
  startWidth: 18,
  startHeight: 12,
  growX: 4,
  growY: 2,
} as const;

export const GROWTH = {
  firstGrowthAt: 25,
  intervalStart: 30,
  intervalMin: 16,
  intervalDecayPerMinute: 1.2,
  maxBuildings: 70,
  /** Every n-th growth event adds a workplace instead of a house. */
  workplaceEvery: 5,
  maxColors: 5,
  /** A new colour is introduced at the start of these weeks. */
  newColorWeeks: [2, 4, 6, 9] as readonly number[],
  /** Chance that a new house / workplace appears across the water, so bridges are needed. */
  acrossWaterHouse: 0.3,
  acrossWaterWorkplace: 0.45,
  /** ...but only from this week on, so the first week never needs a bridge. */
  acrossWaterFromWeek: 2,
} as const;

export const ECONOMY = {
  /** Length of one in-game week in simulated seconds. */
  weekLength: 90,
  /** Road pieces granted at the start of every week. */
  weeklyRoads: 20,
  startBridges: 6,
  startBoulevards: 0,
  startLights: 2,
  startRoundabouts: 1,
  startLines: 1,
} as const;

export type ResourceKind = 'roads' | 'bridges' | 'boulevards' | 'lights' | 'roundabouts' | 'lines';

/** Weekly reward options; two are offered at random each week. */
export const UPGRADES: readonly { kind: ResourceKind; amount: number; label: string; text: string }[] = [
  { kind: 'roads', amount: 15, label: '+15 yol', text: 'Daha fazla yol parçası' },
  { kind: 'bridges', amount: 5, label: '+5 köprü', text: 'Suyun ya da otoyolun üstünden geçmek için' },
  { kind: 'boulevards', amount: 10, label: '+10 bulvar', text: 'İki şeritli, hızlı yollar' },
  { kind: 'lights', amount: 2, label: '+2 trafik ışığı', text: 'Kalabalık kavşakları sırayla akıt' },
  { kind: 'roundabouts', amount: 2, label: '+2 göbek', text: 'Durmadan dönülen göbekli kavşak' },
  { kind: 'lines', amount: 1, label: '+1 vapur/metro hattı', text: 'Yolcuları arabasız taşı' },
];

/** A trip is "on time" if travel time ≤ freeFlow × factor + slack (statistics only). */ export const TRIP = {
  onTimeFactor: 1.6,
  onTimeSlack: 10,
} as const;
export const STATS = {
  sampleInterval: 5,
  historyLength: 120,
  /** Vehicles slower than this are considered queued. */
  queueSpeed: 1.5,
} as const;
