import { restorationHabitDisplay } from "./restoration-habit-display";
import type { Habit } from "./habits";
import { STARTER_HABIT_TEMPLATES } from "./habit-templates";
import { SACRED_PRACTICES } from "./sacred-practices";
import { catalogText, type LocalizedPair } from "./catalog-i18n";
import { translateText, type Language } from "./i18n";
import { REGION_LANGUAGES } from "./region-language";

type HabitText = Pick<Habit, "title" | "description" | "sourceTemplateId" | "sacredPracticeId"> & Partial<Pick<Habit, "stoicheionRestoration">>;
type BuiltInText = { title: LocalizedPair; previousTitles?: readonly string[]; description: LocalizedPair; sacred: boolean };
const templates = new Map<string, BuiltInText>(STARTER_HABIT_TEMPLATES.map(template => [template.id, {
  title: { ru: template.title, en: template.titleEn },
  description: { ru: template.description, en: template.descriptionEn }, sacred: false,
}]));
const practices = new Map<string, BuiltInText>(SACRED_PRACTICES.map(practice => [practice.id, { ...practice, sacred: true }]));
const originals = new WeakMap<LocalizedPair, Set<string>>();

function render(copy: LocalizedPair, language: Language, sacred: boolean) {
  return sacred ? catalogText(copy, language) : language === "ru" ? copy.ru
    : language === "en" ? copy.en : translateText(copy.ru, language);
}

function localizeOriginal(saved: string, copy: LocalizedPair, language: Language, sacred: boolean, previous: readonly string[] = []) {
  let known = originals.get(copy);
  if (!known) {
    known = new Set([copy.ru, copy.en, ...previous, ...REGION_LANGUAGES.map(locale => render(copy, locale, sacred))]);
    originals.set(copy, known);
  }
  return known.has(saved) ? render(copy, language, sacred) : saved;
}

/** Translate only unchanged built-in fields. Stored/user-authored text is never rewritten. */
export function habitDisplayText(habit: HabitText, language: Language): Pick<Habit, "title" | "description"> {
  if (habit.stoicheionRestoration) return restorationHabitDisplay(habit, language);
  const original = habit.sacredPracticeId ? practices.get(habit.sacredPracticeId)
    : habit.sourceTemplateId ? templates.get(habit.sourceTemplateId) : undefined;
  if (!original) return { title: habit.title, description: habit.description };
  return {
    title: localizeOriginal(habit.title, original.title, language, original.sacred, original.previousTitles),
    description: localizeOriginal(habit.description, original.description, language, original.sacred),
  };
}
