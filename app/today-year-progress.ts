import type { Language } from './i18n';
import yearProgressCopy from './today-year-progress-copy.json';

const copy: Record<Language, string> = yearProgressCopy;

export function todayYearProgress(day: number, total: number, language: Language): string {
  return copy[language].replace('{day}', String(day)).replace('{total}', String(total));
}
