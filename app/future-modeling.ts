import guide from "./future-modeling.json";
import el from "./future-modeling-locales/el.json";
import de from "./future-modeling-locales/de.json";
import fr from "./future-modeling-locales/fr.json";
import es from "./future-modeling-locales/es.json";
import it from "./future-modeling-locales/it.json";
import pt from "./future-modeling-locales/pt.json";
import pl from "./future-modeling-locales/pl.json";
import sr from "./future-modeling-locales/sr.json";
import uk from "./future-modeling-locales/uk.json";
import zh from "./future-modeling-locales/zh.json";
import tr from "./future-modeling-locales/tr.json";
import ja from "./future-modeling-locales/ja.json";

function baseLocale(language: "ru" | "en") {
  return {
    ...guide.locales[language],
    sectors: guide.sectors.map(sector => ({ id: sector.id, title: sector.title[language], meaning: sector.meaning[language] })),
    goals: guide.goals.map(goal => ({ deityId: goal.deityId, goal: goal.goal[language] })),
  };
}

const locales = { ru: baseLocale("ru"), en: baseLocale("en"), el, de, fr, es, it, pt, pl, sr, uk, zh, tr, ja };
export type FutureModelingLanguage = keyof typeof locales;

export function futureModelingCopy(language: string) {
  const locale = Object.hasOwn(locales, language) ? language as FutureModelingLanguage : "en";
  const copy = locales[locale];
  return {
    ...copy, language: locale,
    sectors: guide.sectors.map(sector => ({ ...sector, ...copy.sectors.find(row => row.id === sector.id)! })),
  };
}
