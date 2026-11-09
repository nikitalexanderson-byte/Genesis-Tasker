export type LegalPageName = keyof typeof import('./legal-content').legalPages;

const legalPageNames = ['privacy', 'terms', 'support', 'delete-account'] as const satisfies readonly LegalPageName[];

/** Route detection stays independent of the localized document bundles. */
export function legalPageForPath(pathname: string): LegalPageName | null {
  const name = pathname.replace(/^\/+|\/+$/g, '').replace(/\.html$/, '');
  return legalPageNames.find(page => page === name) ?? null;
}

export function currentLegalPage(): LegalPageName | null {
  return typeof window === 'undefined' ? null : legalPageForPath(window.location.pathname);
}
