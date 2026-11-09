import type { Language } from "./i18n";
import copy from "./workspace-conflict-translations.json";

/** Dedicated deferred copy avoids growing the main locale chunks. */
export function workspaceConflictCopy(language: Language) { return copy[language]; }
