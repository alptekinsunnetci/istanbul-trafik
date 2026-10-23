/** Tiny structural validators for untrusted JSON (no dependencies). */

export class ValidationError extends Error {
  constructor(path: string, expected: string) {
    super(`${path}: ${expected} bekleniyordu`);
    this.name = 'ValidationError';
  }
}

export function obj(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new ValidationError(path, 'nesne');
  return value as Record<string, unknown>;
}

export function arr(value: unknown, path: string, max = 100_000): unknown[] {
  if (!Array.isArray(value)) throw new ValidationError(path, 'dizi');
  if (value.length > max) throw new ValidationError(path, `en fazla ${max} öğe`);
  return value;
}

export function num(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new ValidationError(path, `${min}..${max} aralığında sayı`);
  }
  return value;
}

export function int(value: unknown, path: string, min = -Infinity, max = Infinity): number {
  const n = num(value, path, min, max);
  if (!Number.isInteger(n)) throw new ValidationError(path, 'tam sayı');
  return n;
}

export function str(value: unknown, path: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.length > maxLength) throw new ValidationError(path, 'metin');
  return value;
}

export function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError(path, 'mantıksal değer');
  return value;
}

export function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new ValidationError(path, options.join(' | '));
  }
  return value as T;
}

export function nullable<T>(value: unknown, fn: (v: unknown) => T): T | null {
  return value === null || value === undefined ? null : fn(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(text: string, expectedLength: number, path: string): Uint8Array {
  let raw: string;
  try {
    raw = atob(text);
  } catch {
    throw new ValidationError(path, 'base64 veri');
  }
  if (raw.length !== expectedLength) throw new ValidationError(path, `${expectedLength} baytlık veri`);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
