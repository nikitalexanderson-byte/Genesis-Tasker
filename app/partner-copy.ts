import { REGION_LANGUAGES } from './region-language.ts';
import type { Language } from './i18n';
export const PARTNER_LANGUAGES: readonly Language[] = REGION_LANGUAGES;
import rows from './partner-copy.json' with { type: 'json' };

export type PartnerCopyKey = keyof typeof rows;
export function partnerText(key: PartnerCopyKey, language: Language): string {
  return rows[key][PARTNER_LANGUAGES.indexOf(language)] ?? rows[key][1];
}
export const partnerCopyRows = rows;
