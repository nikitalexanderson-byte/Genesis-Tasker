import numerals from "./stoicheion-numerals.json";

export type StoicheionNumeral = Readonly<{
  id: string;
  symbol: string;
  name: string;
  value: number;
  pythmen: number;
}>;

// Keep arithmetic and persisted habit metadata independent of the full authored
// letter descriptions. Catalogue parity is checked in the restoration tests.
export const STOICHEION_NUMERALS: readonly StoicheionNumeral[] = Object.freeze(
  numerals.map((letter) => Object.freeze({ ...letter })),
);
