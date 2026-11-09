import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SOURCE_ROOT = path.join(ROOT, "android/app/src/main/java/ru/genesis/calendar");
const I18N_SOURCE = path.join(SOURCE_ROOT, "ui/GenesisI18n.kt");
const CYRILLIC = /[А-Яа-яЁё]/u;
const SKIPPED_FILES = new Set([
  I18N_SOURCE,
  // Phonetic alphabet correspondences; these constants are not displayed labels.
  path.join(SOURCE_ROOT, "domain/GreekTerms.kt"),
  // This component keeps every Russian string beside its reviewed English
  // counterpart in a local copy(russian, english) helper.
  path.join(SOURCE_ROOT, "ui/CalendarYearDescription.kt"),
  // Explicit grammar tables contain Russian, Ukrainian and Serbian forms beside all other locales.
  path.join(SOURCE_ROOT, "ui/TaskCountCopy.kt"),
  // This compact header copy is defined explicitly for all 14 supported languages.
  path.join(SOURCE_ROOT, "ui/MobileCalendarCopy.kt"),
  // Release notes contain a complete reviewed table for all 14 shipped locales.
  path.join(SOURCE_ROOT, "ui/ReleaseNotes.kt"),
  // The update banner contains a complete 14-locale copy table.
  path.join(SOURCE_ROOT, "ui/AndroidUpdateBanner.kt"),
  // The shared update prompt copy defines all 14 locales explicitly.
  path.join(SOURCE_ROOT, "ui/AppUpdateCopy.kt"),
  // Advertisement labels are defined for every shipped locale in this component.
  path.join(SOURCE_ROOT, "ui/TodayAdPanel.kt"),
  // Generated RU/EN pairs; export-notification-copy.mjs --check verifies both platforms.
  path.join(SOURCE_ROOT, "reminders/HabitNotificationMessages.kt"),
  path.join(SOURCE_ROOT, "reminders/HabitNotificationCopy.kt"),
  path.join(SOURCE_ROOT, "reminders/NotificationAuxCopy.kt"),
  // Voice grammars contain Russian and English matching tokens, never displayed as UI copy.
  path.join(SOURCE_ROOT, "ui/NativeVoicePlan.kt"),
  path.join(SOURCE_ROOT, "ui/NativeVoiceActions.kt"),
  // Authored RU/EN parsing tokens only; rendered headings remain in the audited layout file.
  path.join(SOURCE_ROOT, "ui/StoicheionReadingGrammar.kt"),
  // These UI components pair every Russian branch with a reviewed English branch in place.
  path.join(SOURCE_ROOT, "ui/VoiceSpeechInput.kt"),
  path.join(SOURCE_ROOT, "ui/SacredHabitsBlock.kt"),
  // Reminder notification copy is selected explicitly by the saved language.
  path.join(SOURCE_ROOT, "reminders/MoonReminderScheduler.kt"),
  path.join(SOURCE_ROOT, "reminders/SleepReminderScheduler.kt"),
]);

function normalize(value) {
  return value.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

function decodeKotlinString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function kotlinStrings(source) {
  const result = [];
  let index = 0;
  let line = 1;
  while (index < source.length) {
    if (source.startsWith("//", index)) {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (source.startsWith("/*", index)) {
      index += 2;
      while (index < source.length && !source.startsWith("*/", index)) {
        if (source[index] === "\n") line += 1;
        index += 1;
      }
      index += 2;
      continue;
    }
    if (source.startsWith('"""', index)) {
      const startLine = line;
      index += 3;
      const start = index;
      while (index < source.length && !source.startsWith('"""', index)) {
        if (source[index] === "\n") line += 1;
        index += 1;
      }
      result.push({ line: startLine, value: source.slice(start, index) });
      index += 3;
      continue;
    }
    if (source[index] === '"') {
      const startLine = line;
      index += 1;
      let value = "";
      while (index < source.length && source[index] !== '"') {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        if (source[index] === "\n") line += 1;
        value += source[index];
        index += 1;
      }
      result.push({ line: startLine, value: decodeKotlinString(value) });
      index += 1;
      continue;
    }
    if (source[index] === "\n") line += 1;
    index += 1;
  }
  return result;
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return entry.name.endsWith(".kt") && !SKIPPED_FILES.has(absolute) ? [absolute] : [];
  }));
  return nested.flat();
}

const [web, curated, i18nSource, sacredSource, sacredEnglish] = await Promise.all([
  readFile(path.join(ROOT, "app/translations.en.json"), "utf8").then(JSON.parse),
  readFile(path.join(ROOT, "app/curated-translations.en.json"), "utf8").then(JSON.parse),
  readFile(I18N_SOURCE, "utf8"),
  readFile(path.join(SOURCE_ROOT, "domain/SacredCatalog.kt"), "utf8"),
  readFile(path.join(ROOT, "app/calendar-days.en.json"), "utf8").then(JSON.parse),
]);

const stoicheionEnglish = JSON.parse(await readFile(path.join(ROOT, "app/stoicheion.en.json"), "utf8"));
if (Object.keys(stoicheionEnglish).length !== 24 || Object.values(stoicheionEnglish).some((letter) =>
  !letter.name || !letter.tagline || !letter.content || CYRILLIC.test(`${letter.name}${letter.tagline}${letter.content}`))) {
  throw new Error("The Android Stoicheion English catalog must contain 24 complete, Cyrillic-free entries.");
}

const native = {};
const pairPattern = /"((?:\\.|[^"\\])*)"\s+to\s*(?:\r?\n\s*)?"((?:\\.|[^"\\])*)"/gsu;
for (const match of i18nSource.matchAll(pairPattern)) {
  native[decodeKotlinString(match[1])] = decodeKotlinString(match[2]);
}
const sacredRussian = [...sacredSource.matchAll(/SacredDay\(\d+,\s*"((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)"/gsu)];
if (sacredRussian.length !== sacredEnglish.length) {
  throw new Error(`Sacred day catalogs differ: ${sacredRussian.length} Russian and ${sacredEnglish.length} English entries.`);
}
const sacred = {};
sacredRussian.forEach((match, index) => {
  sacred[decodeKotlinString(match[1])] = sacredEnglish[index].name;
  sacred[decodeKotlinString(match[2])] = sacredEnglish[index].description;
});
const supplemental=JSON.parse(await readFile(path.join(ROOT,"app/ui-translations/en.json"),"utf8"));
Object.assign(supplemental,JSON.parse(await readFile(path.join(ROOT,"app/year-translations/en.json"),"utf8")));
const monthCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-calendar-month-copy.json"), "utf8"));
const alphabetCopy = JSON.parse(await readFile(path.join(ROOT, "app/stoicheion-alphabet-copy.json"), "utf8"));
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(alphabetCopy[language] ?? {}).sort().join(",") !== "collapsed,expanded,title") {
    throw new Error(`Incomplete Stoicheion alphabet copy: ${language}`);
  }
  for (const value of Object.values(alphabetCopy[language])) {
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Invalid Stoicheion alphabet label: ${language}`);
    }
  }
}
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  for (const key of Object.keys(monthCopy.ru)) {
    const value = monthCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete month notes: ${language}: ${key}`);
    }
  }
}
Object.assign(supplemental, monthCopy.en, JSON.parse(await readFile(path.join(ROOT, "app/ui-refinement-copy.json"), "utf8")).en);

const habitReports=JSON.parse(await readFile(path.join(ROOT,"app/habit-report-translations.json"),"utf8"));
const workCopy=JSON.parse(await readFile(path.join(ROOT,"app/shared-work-translations/en.json"),"utf8"));
const exportCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-data-export-translations.json"), "utf8"));
const exportKeys = Object.keys(exportCopy.ru ?? {});
if (exportKeys.length !== 13) throw new Error("Native export copy must contain all 13 labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(exportCopy[language] ?? {}).length !== exportKeys.length) throw new Error(`Incomplete native export catalog: ${language}`);
  for (const key of exportKeys) {
    const value = exportCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete native export copy: ${language}: ${key}`);
    }
  }
}
const importCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-data-import-translations.json"), "utf8"));
const importKeys = Object.keys(importCopy.ru ?? {});
if (importKeys.length !== 38) throw new Error("Native import copy must contain all 38 labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(importCopy[language] ?? {}).length !== importKeys.length) throw new Error(`Incomplete native import catalog: ${language}`);
  for (const key of importKeys) {
    const value = importCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete native import copy: ${language}: ${key}`);
    }
  }
}
const bulkCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-bulk-translations.json"), "utf8"));
const bulkKeys = Object.keys(bulkCopy.ru ?? {});
if (bulkKeys.length !== 36) throw new Error("Native bulk copy must contain all 36 labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(bulkCopy[language] ?? {}).sort().join("\n") !== [...bulkKeys].sort().join("\n")) throw new Error(`Incomplete native bulk catalog: ${language}`);
  for (const key of bulkKeys) {
    const value = bulkCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete native bulk copy: ${language}: ${key}`);
    }
  }
}
const templateCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-template-labels.json"), "utf8"));
const templateKeys = Object.keys(templateCopy.ru ?? {});
if (templateKeys.length !== 40) throw new Error("Native template labels must contain all 40 labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(templateCopy[language] ?? {}).sort().join("\n") !== [...templateKeys].sort().join("\n")) throw new Error(`Incomplete native template labels: ${language}`);
  for (const key of templateKeys) {
    const value = templateCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) throw new Error(`Invalid native template label: ${language}: ${key}`);
  }
}
const automationsCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-automations-translations.json"), "utf8"));
const automationsKeys = Object.keys(automationsCopy.ru ?? {});
if (automationsKeys.length !== 83) throw new Error("Native automations copy must contain all 83 labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(automationsCopy[language] ?? {}).sort().join("\n") !== [...automationsKeys].sort().join("\n")) throw new Error(`Incomplete native automations catalog: ${language}`);
  for (const key of automationsKeys) {
    const value = automationsCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete native automations copy: ${language}: ${key}`);
    }
  }
}
const savedViewsCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-saved-views-translations.json"), "utf8"));
const savedViewKeys = Object.keys(savedViewsCopy.ru ?? {});
if (savedViewKeys.length !== 21) throw new Error("Native saved views must contain all 21 supplemental labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(savedViewsCopy[language] ?? {}).sort().join("\n") !== [...savedViewKeys].sort().join("\n")) throw new Error(`Incomplete native saved views: ${language}`);
  for (const key of savedViewKeys) {
    const value = savedViewsCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) throw new Error(`Invalid saved-view copy: ${language}: ${key}`);
  }
}
const fieldRecoveryCopy = JSON.parse(await readFile(path.join(ROOT, "app/custom-field-recovery-translations.json"), "utf8"));
const fieldRecoveryKeys = Object.keys(fieldRecoveryCopy.ru ?? {});
if (fieldRecoveryKeys.length !== 2) throw new Error("Custom field recovery needs two shared labels.");
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(fieldRecoveryCopy[language] ?? {}).sort().join("\n") !== [...fieldRecoveryKeys].sort().join("\n")) throw new Error(`Incomplete field recovery: ${language}`);
  for (const key of fieldRecoveryKeys) {
    const value = fieldRecoveryCopy[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) throw new Error(`Invalid field recovery: ${language}: ${key}`);
  }
}
const mobileDesignCopy = JSON.parse(await readFile(path.join(ROOT, "app/native-mobile-design-translations.json"), "utf8"));
const mobileDesignKeys = Object.keys(mobileDesignCopy.ru ?? {}).sort();
for (const language of ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  if (Object.keys(mobileDesignCopy[language] ?? {}).sort().join("\n") !== mobileDesignKeys.join("\n")) throw new Error("Incomplete native mobile design copy: " + language);
  for (const key of mobileDesignKeys) {
    const value = mobileDesignCopy[language][key];
    if (typeof value !== "string" || !value.trim() || (!["ru", "sr", "uk"].includes(language) && CYRILLIC.test(value))) throw new Error("Invalid native mobile design copy: " + language + ": " + key);
  }
}
const backupEnglish=JSON.parse(await readFile(path.join(ROOT,"app/backup-copy.en.json"),"utf8"));
for(const language of ["ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"]){
 const copy=JSON.parse(await readFile(path.join(ROOT,`app/backup-locales/${language}.json`),"utf8"));
 if(Object.keys(copy).sort().join('\n')!==Object.keys(backupEnglish).sort().join('\n')||Object.values(copy).some(value=>typeof value!=="string"||!value.trim()))throw Error(`Incomplete native backup copy: ${language}`);
}
const translations = { ...web, ...curated, ...supplemental, ...sacred, ...native, ...workCopy, ...exportCopy.en, ...importCopy.en, ...bulkCopy.en, ...templateCopy.en, ...automationsCopy.en, ...savedViewsCopy.en, ...fieldRecoveryCopy.en, ...habitReports.en, ...mobileDesignCopy.en,...backupEnglish };
for(const language of ["en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja"])for(const key of Object.keys(habitReports.en)){
  const value=habitReports[language]?.[key];
  if(typeof value!=="string"||!value.trim()||(!["sr","uk"].includes(language)&&CYRILLIC.test(value)))throw Error(`Incomplete native habit report copy: ${language}: ${key}`);
}
const affairs = JSON.parse(await readFile(path.join(ROOT, "app/native-affairs-translations.json"), "utf8"));
const affairKeys = Object.keys(affairs.en ?? {});
if (affairKeys.length !== 41) throw new Error("Native supplemental copy must contain all 41 labels.");
for (const language of ["en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"]) {
  for (const key of affairKeys) {
    const value = affairs[language]?.[key];
    if (typeof value !== "string" || !value.trim() || (!["sr", "uk"].includes(language) && CYRILLIC.test(value))) {
      throw new Error(`Incomplete native affairs copy: ${language}: ${key}`);
    }
    if (language === "en" && value !== native[key]) throw new Error(`Native English copy differs: ${key}`);
  }
}
const fragments = Object.entries(translations)
  .filter(([source, translated]) => source.length >= 3 && source.length <= 180 && source !== translated)
  .sort(([left], [right]) => right.length - left.length);

function isCovered(source) {
  const normalized = normalize(source);
  if (normalized === "Српски" || normalized === "Українська") return true;
  if (!CYRILLIC.test(normalized)) return true;
  const exact = translations[normalized];
  if (exact && !CYRILLIC.test(exact)) return true;
  let translated = normalized;
  for (const [fragment, replacement] of fragments) {
    if (translated.includes(fragment)) translated = translated.replaceAll(fragment, replacement);
  }
  return !CYRILLIC.test(translated);
}

const missing = [];
for (const file of await sourceFiles(SOURCE_ROOT)) {
  const source = await readFile(file, "utf8");
  for (const item of kotlinStrings(source)) {
    const value = normalize(item.value);
    if (value && CYRILLIC.test(value) && !isCovered(value)) {
      missing.push({ location: `${path.relative(ROOT, file)}:${item.line}`, value });
    }
  }
}

if (missing.length) {
  console.error(`Untranslated Android strings: ${missing.length}`);
  for (const item of missing) console.error(`${item.location}\t${item.value}`);
  process.exitCode = 1;
} else {
  console.log("Android English translation audit passed: no uncovered Russian strings.");
}
