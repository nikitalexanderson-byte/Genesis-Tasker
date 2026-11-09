import { MONTHS, getSacredDay } from "./calendar-data";
import { translateText, type Language } from "./i18n";
import labels from "./solar-model-labels.json";
import { solarLabelTranslator } from "./solar-model-localization.js";

export function solarModelTranslator(language: Language) {
  if (language === "ru") return (source: string) => source;
  const dictionary: Record<string, string> = { ...labels[language] };
  MONTHS.forEach((month, monthIndex) => {
    for (const source of [month.name, month.title, month.season]) dictionary[source] = translateText(source, language);
    month.days.forEach((day, dayIndex) => {
      dictionary[day.pyataTitle] = translateText(day.pyataTitle, language);
      const translated = getSacredDay(monthIndex, dayIndex + 1, language).name;
      dictionary[day.name] = translated;
      const split = /^(.*?)\s*(\([^()]+\))$/u;
      const originalParts = split.exec(day.name), localizedParts = split.exec(translated);
      if (originalParts && localizedParts) {
        dictionary[originalParts[1]] = localizedParts[1]; dictionary[originalParts[2]] = localizedParts[2];
      }
    });
  });
  for (const source of ["Хаос", "День", "Сакральный календарь"]) dictionary[source] = translateText(source, language);
  return solarLabelTranslator(dictionary, language);
}
