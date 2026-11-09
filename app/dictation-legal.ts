import copy from './dictation-copy.json';

export type DictationLegalSection = readonly [title: string, body: string];

/** The same Russian source is used for static, JavaScript-free public documents. */
export const dictationSpellingLegalSection: DictationLegalSection = [copy.ru.legalTitle, copy.ru.legalBody];

/** Complete authored policy, excluded from incremental DOM translation. */
export function localizedDictationLegalSections(language: string): ReadonlyMap<string, DictationLegalSection> {
  const value = Object.prototype.hasOwnProperty.call(copy, language) ? copy[language as keyof typeof copy] : copy.en;
  return new Map([[dictationSpellingLegalSection[0], [value.legalTitle, value.legalBody] as const]]);
}
