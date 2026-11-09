import copy from './account-retention-legal-copy.json';

/** Public policy only; exemption identities and provider credentials stay server-side. */
export type AccountRetentionLegalSection = readonly [title: string, body: string];
type RetentionLegalCopy = typeof copy.ru;

const termsSections = (value: RetentionLegalCopy): readonly AccountRetentionLegalSection[] => [
  [value.freeTitle, value.freeBody],
  [value.eliteTitle, value.eliteBody],
  [value.donationsTitle, value.donationsBody],
  [value.warningTitle, value.warningBody],
  [value.dataTitle, value.dataBody],
];

// Russian sections are also consumed by the static public-document build.
export const accountRetentionTermsSections = termsSections(copy.ru);
export const accountRetentionPrivacySection: AccountRetentionLegalSection = [copy.ru.privacyTitle, copy.ru.privacyBody];
export const accountRetentionDeleteSection: AccountRetentionLegalSection = [copy.ru.deleteAccountTitle, copy.ru.deleteAccountBody];

/** Match published source sections to complete authored copy in the selected language. */
export function localizedAccountRetentionSections(language: string): ReadonlyMap<string, AccountRetentionLegalSection> {
  const value = Object.prototype.hasOwnProperty.call(copy, language) ? copy[language as keyof typeof copy] : copy.en;
  const source = [...accountRetentionTermsSections, accountRetentionPrivacySection, accountRetentionDeleteSection];
  const localized: AccountRetentionLegalSection[] = [
    ...termsSections(value), [value.privacyTitle, value.privacyBody], [value.deleteAccountTitle, value.deleteAccountBody],
  ];
  return new Map(source.map(([title], index) => [title, localized[index]] as const));
}
