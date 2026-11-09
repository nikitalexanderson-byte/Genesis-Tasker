import type { Habit } from "./habits";
import type { Language } from "./i18n";
import { LANGUAGES } from "./i18n";
import { getStoicheionLetters } from "./stoicheion-data";
import { restorationCopy, restorationLocal } from "./stoicheion-restoration-copy";
import { restorationRecommendation } from "./stoicheion-restoration-commit";
import { RESTORATION_SECTORS } from "./stoicheion-restoration-data";

/** Translate authored snapshot paragraphs at display time. Custom paragraphs and storage remain intact. */
export function restorationHabitDisplay(habit: Pick<Habit, "title" | "description" | "stoicheionRestoration">, language: Language) {
  const snapshot = habit.stoicheionRestoration;
  if (!snapshot) return { title: habit.title, description: habit.description };
  const plan = snapshot;
  const target = restorationRecommendation(snapshot, snapshot.sectorId, plan, language);
  const targetParts = [target.action, target.practiceText].flatMap(value => value.split("\n\n"));
  const replacements = new Map<string, string>();
  const titleFor = (locale: Language) => `${restorationCopy(locale).title} · ${getStoicheionLetters(locale).find(letter => letter.id === snapshot.letterId)!.name}`;
  const intention = RESTORATION_SECTORS.find(sector => sector.id === snapshot.sectorId)!.needs[snapshot.need].intention;
  for (const locale of LANGUAGES) {
    const source = restorationRecommendation(snapshot, snapshot.sectorId, plan, locale);
    [source.action, source.practiceText].flatMap(value => value.split("\n\n")).forEach((part, index) => replacements.set(part, targetParts[index]));
    replacements.set(titleFor(locale), titleFor(language));
    replacements.set(restorationLocal(intention, locale), restorationLocal(intention, language));
  }
  return {
    title: replacements.get(habit.title) ?? habit.title,
    description: habit.description.split("\n\n").map(part => replacements.get(part) ?? part).join("\n\n"),
  };
}
