/** Internal arithmetic only. Never render sums or solver diagnostics in the wizard. */
export const GREEK_VALUES: Readonly<Record<string, number>> = Object.freeze({
  Α:1, Β:2, Γ:3, Δ:4, Ε:5, Ϛ:6, Ϝ:6, Ζ:7, Η:8, Θ:9,
  Ι:10, Κ:20, Λ:30, Μ:40, Ν:50, Ξ:60, Ο:70, Π:80, Ϟ:90,
  Ρ:100, Σ:200, Τ:300, Υ:400, Φ:500, Χ:600, Ψ:700, Ω:800, Ϡ:900,
});
export const ORDINARY_GREEK = 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ';
export const GREEK_VOWELS = 'ΑΕΗΙΟΥΩ';
export const ORTHOGRAPHY_VERSION = 'grc-nfd-iota-expanded-v1';

export class GreekOrthographyError extends Error {
  constructor(public readonly character: string, public readonly position: number) {
    super('UNSUPPORTED_GREEK_CHARACTER'); this.name = 'GreekOrthographyError';
  }
}

/** NFD deliberately avoids compatibility/transliteration substitutions. */
export function normalizeGreek(input: string, options: {phrases?: boolean; archaic?: boolean} = {}): string {
  if (typeof input !== 'string' || !input || input.length > 2048) throw new Error('INVALID_GREEK_FORM');
  let result = '', hasBase = false;
  const source = [...input.normalize('NFD')];
  for (let index=0; index<source.length; index++) {
    const character = source[index];
    if (character === ' ' && options.phrases) { result += ' '; hasBase = false; continue; }
    if (character === '\u0345') {
      if (!hasBase) throw new GreekOrthographyError(character,index);
      result += 'Ι'; continue;
    }
    if (/\p{M}/u.test(character)) {
      if (!hasBase || !/^[\u0300\u0301\u0304\u0306\u0308\u0313\u0314\u0342]$/u.test(character)) throw new GreekOrthographyError(character,index);
      continue;
    }
    const upper = character.toUpperCase();
    if ([...upper].length !== 1 || !Object.hasOwn(GREEK_VALUES,upper)
      || (options.archaic === false && !ORDINARY_GREEK.includes(upper))) throw new GreekOrthographyError(character,index);
    result += upper; hasBase = true;
  }
  if (!result || (options.phrases && (result.startsWith(' ') || result.endsWith(' ') || result.includes('  ')))) throw new Error('INVALID_GREEK_FORM');
  return result;
}

export function isopsephy(input: string, options: {phrases?: boolean; archaic?: boolean} = {}): number {
  return [...normalizeGreek(input,options)].reduce((sum,letter)=>sum+(letter===' '?0:GREEK_VALUES[letter]),0);
}
