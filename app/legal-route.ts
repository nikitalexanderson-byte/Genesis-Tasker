import {publicRouteForPath} from './public-route';
export type LegalPageName = keyof typeof import('./legal-content').legalPages;

const legalPageNames = ['privacy', 'terms', 'refund', 'support', 'delete-account'] as const satisfies readonly LegalPageName[];

/** Route detection stays independent of the localized document bundles. */
export function legalPageForPath(pathname: string): LegalPageName | null {
  const name = publicRouteForPath(pathname,process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'')?.page;
  return legalPageNames.find(page => page === name) ?? null;
}

export function currentLegalPage(): LegalPageName | null {
  return typeof window === 'undefined' ? null : legalPageForPath(window.location.pathname);
}
