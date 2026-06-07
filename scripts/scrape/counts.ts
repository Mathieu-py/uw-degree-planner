// Parsing spelled-out counts in Kuali requirement prose ("Complete two courses",
// "a minimum of three"). Shared by the subject-pool and electives parsers.

/** Spelled-out counts → integers, including the articles "a"/"an" (= 1). */
export const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** A count token (digit string or spelled-out word) → number, or undefined if neither. */
export function wordToNumber(tok: string): number | undefined {
  const n = WORD_NUMBERS[tok.toLowerCase()] ?? Number(tok);
  return Number.isFinite(n) ? n : undefined;
}
