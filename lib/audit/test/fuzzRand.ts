/**
 * Deterministic PRNG helpers for fuzz tests: every instance derives from a
 * fixed seed, so a failure reproduces exactly — report the seed, not a flake.
 */
export type Rand = () => number;

/** Numerical Recipes LCG over uint32, mapped to [0, 1). */
export function lcg(seed: number): Rand {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Uniform integer in [lo, hi], inclusive. */
export const int = (rand: Rand, lo: number, hi: number): number =>
  lo + Math.floor(rand() * (hi - lo + 1));

export const pick = <T>(rand: Rand, xs: readonly T[]): T =>
  xs[Math.floor(rand() * xs.length)];

/** Fisher–Yates on a copy. */
export function shuffle<T>(rand: Rand, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
