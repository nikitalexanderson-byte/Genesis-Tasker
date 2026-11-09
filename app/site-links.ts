import type { Language } from './i18n';
import labels from './site-links.json' with { type: 'json' };
export const GENESIS_TELEGRAM = 'https://t.me/genesiscalendar';
export const genesisTelegramLabel = (language: Language) => labels[language];
