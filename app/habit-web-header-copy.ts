import copy from "./habit-web-header-copy.json";
import type { Language } from "./i18n";

type HeaderCopy = { title: string; tabs: [string, string, string, string]; descriptions: [string, string, string, string] };

/** Website section labels and introductions; Android keeps its existing copy. */
export const habitWebHeaderCopy = copy as Record<Language, HeaderCopy>;
