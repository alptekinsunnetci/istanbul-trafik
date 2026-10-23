import { DAYTIME, ECONOMY } from '../core/constants';

/** Length of one in-game day in simulated seconds (a week has seven). */
export const DAY_LENGTH = ECONOMY.weekLength / 7;

/** Hour of the day (0–24) at a simulation time; every day starts at 06:00. */
export function hourAt(time: number): number {
  const into = (((time % DAY_LENGTH) + DAY_LENGTH) % DAY_LENGTH) / DAY_LENGTH;
  return (DAYTIME.dayStartHour + into * 24) % 24;
}

/** "08:30" style clock text. */
export function clockText(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function bump(hour: number, centre: number): number {
  const d = hour - centre;
  return Math.exp(-(d * d) / (2 * DAYTIME.rushWidth * DAYTIME.rushWidth));
}

/** 1 deep in the night, 0 in daylight, smooth at dusk and dawn. */
export function darkness(hour: number): number {
  if (hour >= 21 || hour < 4.5) return 1;
  if (hour >= 18.5) return (hour - 18.5) / 2.5;
  if (hour < 7) return (7 - hour) / 2.5;
  return 0;
}

/**
 * How busy the city is: more trips in the morning and evening rush hours,
 * fewer at night. Multiplies how fast pins and highway cars appear.
 */
export function demandFactor(hour: number): number {
  return (
    1 +
    DAYTIME.rushBoost * (bump(hour, DAYTIME.rushMorning) + bump(hour, DAYTIME.rushEvening)) -
    DAYTIME.nightDip * darkness(hour)
  );
}

/** Part of the day, for the HUD and the screen reader. */
export function dayPart(hour: number): string {
  if (hour < 6) return 'Gece';
  if (hour < 10) return 'Sabah';
  if (hour < 16) return 'Öğle';
  if (hour < 20) return 'Akşam';
  return 'Gece';
}
