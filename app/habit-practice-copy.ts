import copy from "./habit-practice-copy.json";
import type { Language } from "./i18n";
export const practiceCopy = (language: Language) => copy[language] ?? copy.en;
