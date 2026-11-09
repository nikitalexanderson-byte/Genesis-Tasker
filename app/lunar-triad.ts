import copy from './lunar-triad-copy.json';
import type {Language} from './i18n';

export const LUNAR_PATRONS = ['artemis', 'selene', 'hecate'] as const;
export type LunarPatron = typeof LUNAR_PATRONS[number];
/** App convention, not a claim of a universal ancient cult calendar. Last decade may have nine days. */
export function lunarPatronForDay(day: number): LunarPatron {
  if (!Number.isInteger(day) || day < 1 || day > 30) throw new RangeError('Invalid lunar day');
  return day <= 10 ? 'artemis' : day <= 20 ? 'selene' : 'hecate';
}
export const lunarPatronNameRu = (day: number) => copy.ru[lunarPatronForDay(day)].name;
export const lunarPatronArt = (day: number) => `weekday-art/lunar-${lunarPatronForDay(day)}-v326.webp`;
export const lunarTriadCopy = (language: Language) => copy[language];
export const LUNAR_TRIAD_SOURCES = [
  {label: 'Πλούταρχος · Σόλων 25.3', url: 'https://lexundria.com/plut_sol/25/prr'},
  {label: 'Καλλίμαχος · Ὕμνος εἰς Ἄρτεμιν 1–40', url: 'https://www.theoi.com/Text/CallimachusHymns1.html'},
  {label: 'Ὁμηρικὸς ὕμνος 27 · Ἄρτεμις', url: 'https://www.theoi.com/Text/HomericHymns3.html'},
  {label: 'Ὁμηρικὸς ὕμνος 32 · Σελήνη 1–13', url: 'https://atlas.perseus.tufts.edu/library/passage/urn:cts:greekLit:tlg0013.tlg032.perseus-eng2:1-20/'},
  {label: 'Ὁμηρικὸς ὕμνος 2 · Δήμητρα 24–25, 51–61, 438–440', url: 'https://www.theoi.com/Text/HomericHymns1.html'},
  {label: 'Ἀριστοφάνης · Πλοῦτος 594–597', url: 'https://classics.mit.edu/Aristophanes/plutus.html'},
  {label: 'Πορφύριος · Περὶ ἀγαλμάτων, fr. 8', url: 'https://classics.mit.edu/Porphyry/images.html'},
] as const;
