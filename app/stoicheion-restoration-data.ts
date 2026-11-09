import content from "./stoicheion-restoration-content.json";
import type { StoicheionPracticeSectorId } from "./sacred-practices";

export type Localized = { ru: string; en: string };
export const RESTORATION_FRAMEWORK: {title: Localized; formula: string; body: Localized} = content.framework;
export type RestorationNeed = "deficit" | "excess" | "conflict";
export type AuxiliaryId = "entrance" | "zenith" | "nadir" | "hearth" | "exit";

export type RestorationAuxiliary = {
  id: AuxiliaryId;
  word: string;
  title: Localized;
  purpose: Localized;
  practiceId: string;
};

export type RestorationSectorNeed = {
  risk: Localized;
  quality: Localized;
  intention: Localized;
  action: Localized;
  practice: Localized;
  supportId: AuxiliaryId;
  practiceId: string;
};

export type RestorationSector = {
  id: StoicheionPracticeSectorId;
  title: Localized;
  field: Localized;
  ambivalence: Localized;
  myth: {
    title: Localized;
    body: Localized;
    source: string;
    url: string;
  };
  needs: Record<RestorationNeed, RestorationSectorNeed>;
};

export type RestorationLetterNeed = { action: Localized; practice: Localized };
export type RestorationLetterFocus = {
  risk: Localized;
  quality: Localized;
  needs: Record<RestorationNeed, RestorationLetterNeed>;
};

// Letter and sector identities stay aligned with the existing catalogs.
// The JSON catalog keeps authored bilingual copy outside the UI translation scanner.
export const RESTORATION_AUXILIARIES: readonly RestorationAuxiliary[] = content.auxiliaries as RestorationAuxiliary[];
export const RESTORATION_SECTORS: readonly RestorationSector[] = content.sectors as RestorationSector[];
export const RESTORATION_LETTER_FOCI: Readonly<Record<string, RestorationLetterFocus>> = content.letterFoci;
