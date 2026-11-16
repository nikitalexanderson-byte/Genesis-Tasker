import { greekIsopsephy, restorationRoot, restorationTrace } from './stoicheion-restoration-math';

export function olympianLetterEquation(greek: string) {
  // Epithets such as Ζεὺς Ἑρκεῖος are phrases. Whitespace has no numerical
  // value; keep the word calculator's strict validation for every actual letter.
  const form = greek.replace(/\s/gu, '');
  const total = greekIsopsephy(form);
  const letters = [...form.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()];
  return `${letters.map(letter => `${letter}(${greekIsopsephy(letter)})`).join(' + ')} = ${total}`;
}

/** Expand printed name totals as well as the interactive calculation. */
export function expandOlympianEquations(text: string) {
  return text.replace(/([Α-ΩϚϜϞϘϠ]+)\s*=\s*(\d+)/gu, (expression, greek: string, total: string) =>
    greekIsopsephy(greek) === Number(total) ? `${greek}: ${olympianLetterEquation(greek)}` : expression);
}

export function olympianBalance(first: number, second: number) {
  const sum = first + second;
  const needed = (6 - restorationRoot(sum) + 9) % 9 || 9;
  // All resources belong to the existing 24-letter Stoicheion. Xi supplies 6.
  const letter = ['', 'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ξ', 'Ζ', 'Η', 'Θ'][needed];
  const value = greekIsopsephy(letter);
  const alternativeLetter = ['', 'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Χ', 'Ο', 'Π', 'ΘΘ'][needed];
  const alternativeValue = greekIsopsephy(alternativeLetter);
  return { sum, root: restorationRoot(sum), letter, value, total: sum + value, trace: restorationTrace(sum + value),
    alternative: { letter: alternativeLetter, value: alternativeValue, total: sum + alternativeValue } };
}
