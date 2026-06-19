/**
 * src/lib/trial/generatePassword.ts
 *
 * Pure {Adjective}{Noun}#{4digits} password generator (ported from V1
 * lib/trial/provisionTrial.ts). Produces memorable, strong-enough shared
 * credentials for trial demo accounts (all 4 roles share one password).
 *
 * The RNG is INJECTED so the unit test is deterministic (no Math.random in the
 * test). Production callers use the default `Math.random` source.
 */

export const ADJECTIVES = [
  'Bright', 'Brave', 'Calm', 'Clever', 'Eager', 'Gentle', 'Happy', 'Keen',
  'Lucky', 'Mighty', 'Noble', 'Quick', 'Sunny', 'Swift', 'Witty', 'Bold',
] as const;

export const NOUNS = [
  'Star', 'River', 'Falcon', 'Maple', 'Comet', 'Harbor', 'Summit', 'Meadow',
  'Anchor', 'Beacon', 'Canyon', 'Delta', 'Ember', 'Forest', 'Glacier', 'Horizon',
] as const;

/** A source of randomness in [0, 1). Defaults to Math.random in production. */
export type Rng = () => number;

function pick<T>(list: readonly T[], rng: Rng): T {
  const idx = Math.floor(rng() * list.length) % list.length;
  return list[idx];
}

/**
 * Generate a `{Adjective}{Noun}#{4digits}` password (e.g. `BlueStar#4821`).
 * Deterministic for a fixed `rng`.
 */
export function generateTrialPassword(rng: Rng = Math.random): string {
  const adjective = pick(ADJECTIVES, rng);
  const noun = pick(NOUNS, rng);
  const digits = String(Math.floor(rng() * 10000)).padStart(4, '0').slice(-4);
  return `${adjective}${noun}#${digits}`;
}
