import { STOICHEION_NUMERALS } from "./stoicheion-numerals.ts";

export type AuxiliaryId = "entrance" | "zenith" | "nadir" | "hearth" | "exit";
export type RestorationNeed = "deficit" | "excess" | "conflict";

export const AUXILIARY_WORDS: Readonly<Record<AuxiliaryId, string>> = Object.freeze({
  entrance: "Αὐγή",
  zenith: "Τάξις",
  nadir: "Βάθος",
  hearth: "Ἕδρα",
  exit: "Σφραγίς",
});

const AUXILIARY_ORDER: readonly AuxiliaryId[] = Object.freeze([
  "entrance", "zenith", "nadir", "hearth", "exit",
]);

// Milesian letter values. Archaic numeral signs keep their historical places;
// final sigma has the same value as sigma. Accents do not change a value.
const GREEK_VALUES: Readonly<Record<string, number>> = Object.freeze({
  α: 1, β: 2, γ: 3, δ: 4, ε: 5, ϛ: 6, ϝ: 6, ζ: 7, η: 8, θ: 9,
  ι: 10, κ: 20, λ: 30, μ: 40, ν: 50, ξ: 60, ο: 70, π: 80, ϟ: 90, ϙ: 90,
  ρ: 100, σ: 200, ς: 200, τ: 300, υ: 400, φ: 500, χ: 600, ψ: 700, ω: 800,
  ϡ: 900, ͳ: 900,
});

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function addSafe(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new RangeError("Restoration sum exceeds safe integer precision");
  return sum;
}

/** Sum a Greek word without silently accepting unsupported letters or symbols. */
export function greekIsopsephy(word: string): number {
  if (typeof word !== "string") throw new TypeError("Isopsephy requires a Greek word");
  const letters = word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  if (!letters) throw new RangeError("Isopsephy requires a non-empty Greek word");
  let total = 0;
  for (const letter of letters) {
    const value = GREEK_VALUES[letter];
    if (value === undefined) throw new RangeError(`Unsupported isopsephy character: ${letter}`);
    total = addSafe(total, value);
  }
  return total;
}

/** Positive digital root: multiples of nine have root nine, never zero. */
export function restorationRoot(value: number): number {
  requirePositiveSafeInteger(value, "Value");
  return ((value - 1) % 9) + 1;
}

/** The full decimal reduction, including the original value and final root. */
export function restorationTrace(value: number): readonly number[] {
  requirePositiveSafeInteger(value, "Value");
  const trace = [value];
  while (value > 9) {
    value = [...String(value)].reduce((sum, digit) => sum + Number(digit), 0);
    trace.push(value);
  }
  return Object.freeze(trace);
}

export type RestorationSupport = Readonly<{
  id: AuxiliaryId;
  word: string;
  value: number;
}>;

export type RestorationCandidate = Readonly<{
  id: string;
  symbol: string;
  name: string;
  value: number;
  pythmen: number;
}>;

export type RestorationEquation = Readonly<{
  target: number;
  supportTotal: number;
  requiredRoot: number;
  supports: readonly RestorationSupport[];
  candidates: readonly RestorationCandidate[];
}>;

/**
 * Authorial GENESIS rule, using ancient Greek numerical material:
 * ρ(card + resource + Σ auxiliary words) = ρ(original spread).
 * This only establishes arithmetic compatibility; callers must also explain
 * why the resource and auxiliary nodes fit the actual card and sector.
 */
export function buildRestorationEquation(
  cardValue: number,
  spreadTotal: number,
  supportIds: readonly AuxiliaryId[],
): RestorationEquation {
  requirePositiveSafeInteger(cardValue, "Card value");
  requirePositiveSafeInteger(spreadTotal, "Spread total");
  if (!Array.isArray(supportIds)) throw new TypeError("Auxiliary ids must be an array");
  const selected = new Set<AuxiliaryId>();
  for (const id of supportIds) {
    if (!AUXILIARY_ORDER.includes(id)) throw new RangeError("Unknown restoration auxiliary id");
    selected.add(id);
  }

  // Canonical order makes the result independent of selection order and duplicates.
  const supports = AUXILIARY_ORDER.filter((id) => selected.has(id)).map((id) => Object.freeze({
    id,
    word: AUXILIARY_WORDS[id],
    value: greekIsopsephy(AUXILIARY_WORDS[id]),
  }));
  const supportTotal = supports.reduce((sum, support) => addSafe(sum, support.value), 0);
  const baseTotal = addSafe(cardValue, supportTotal);
  const target = restorationRoot(spreadTotal);
  const requiredRoot = ((target - restorationRoot(baseTotal) + 8) % 9) + 1;
  const candidates = STOICHEION_NUMERALS
    .filter((letter) => restorationRoot(letter.value) === requiredRoot)
    .map(({ id, symbol, name, value }) => {
      // Every displayed equation must remain exact with JavaScript integers.
      addSafe(baseTotal, value);
      return Object.freeze({ id, symbol, name, value, pythmen: restorationRoot(value) });
    });

  return Object.freeze({
    target,
    supportTotal,
    requiredRoot,
    supports: Object.freeze(supports),
    candidates: Object.freeze(candidates),
  });
}
