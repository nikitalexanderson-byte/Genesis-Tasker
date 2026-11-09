import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = path.join(ROOT, "app");
const CYRILLIC = /[А-Яа-яЁё]/u;
const SKIPPED_FILES = new Set([
  "i18n.ts",
  // Alphabet correspondences are phonetic data, not UI labels.
  "greek-terms.ts",
  "local-voice-plan.ts",
  "task-reminders.ts",
  "stoicheion-data.ts",
  // Authored card parser and content repairs; translations are supplied by stoicheion-data.en.ts.
  "stoicheion-reading.ts",
  "stoicheion-data.en.ts",
  "theokyklos-data.ts",
  "sacred-practices.ts",
  "habits.ts",
  "habit-progress.ts",
  "habit-templates.ts",
  "mood-tracker.ts",
  "sleep-tracker.ts",
  "addiction-tracker.ts",
  "task-count-i18n.ts",
  "CalendarTaskCounts.tsx",
  // Command grammar literals are recognition tokens, not user-facing copy.
  "web-voice-actions.ts",
  // Fourteen explicit locale labels; checked with the ad copy coverage test.
  "TodayAdBlock.tsx",
  // Explicit 14-language collaboration dictionary, checked in affairs-moon.test.mjs.
  "collaboration-copy.ts",
]);

function normalize(value) {
  return value.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    if (!/\.tsx?$/u.test(entry.name) || SKIPPED_FILES.has(entry.name) || entry.name.includes(".en.")) return [];
    return [absolute];
  }));
  return nested.flat();
}

function readCuratedTranslations(sourceText) {
  const source = ts.createSourceFile("i18n.ts", sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const entries = {};
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "curatedTranslations" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property) || !ts.isStringLiteralLike(property.name) || !ts.isStringLiteralLike(property.initializer)) continue;
        entries[property.name.text] = property.initializer.text;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return entries;
}

const [catalogText, curatedText, i18nText] = await Promise.all([
  readFile(path.join(APP_DIR, "translations.en.json"), "utf8"),
  readFile(path.join(APP_DIR, "curated-translations.en.json"), "utf8"),
  readFile(path.join(APP_DIR, "i18n.ts"), "utf8"),
]);
const trialCopy = JSON.parse(await readFile(path.join(APP_DIR, "billing-trial-copy.json"), "utf8"));
const trialPrivacy = Object.fromEntries(['privacyTitle','privacyNotice','updatedAt'].map(key => [trialCopy.ru[key], trialCopy.en[key]]));
const translations = {
  ...JSON.parse(await readFile(path.join(APP_DIR, "backup-copy.en.json"), "utf8")),
  ...trialPrivacy,
  // Web-only Physis ships RU/EN; this catalog is not exported to the native client.
  ...JSON.parse(await readFile(path.join(APP_DIR, "physis/copy.en.json"), "utf8")),
  ...JSON.parse(await readFile(path.join(APP_DIR, "solar-calendar-copy.en.json"), "utf8")),
  ...JSON.parse(catalogText),
  ...JSON.parse(curatedText),
  ...JSON.parse(await readFile(path.join(APP_DIR, "ui-translations/en.json"), "utf8")),
  ...JSON.parse(await readFile(path.join(APP_DIR, "year-translations/en.json"), "utf8")),
  ...JSON.parse(await readFile(path.join(APP_DIR, "ui-refinement-copy.json"), "utf8")).en,
  ...JSON.parse(await readFile(path.join(APP_DIR, "shared-work-translations/en.json"), "utf8")),
  ...JSON.parse(await readFile(path.join(APP_DIR, "habit-report-translations.json"), "utf8")).en,
  ...JSON.parse(await readFile(path.join(APP_DIR, "custom-field-recovery-translations.json"), "utf8")).en,
  ...readCuratedTranslations(i18nText),
};
const partialTranslations = Object.entries(translations)
  .filter(([source, translated]) => source.length >= 4 && source.length <= 180 && source !== translated)
  .sort(([left], [right]) => right.length - left.length);

function isCovered(source) {
  const normalized = normalize(source);
  if (!CYRILLIC.test(normalized)) return true;
  if (translations[normalized] && !CYRILLIC.test(translations[normalized])) return true;
  let translated = normalized;
  for (const [fragment, replacement] of partialTranslations) {
    if (translated.includes(fragment)) translated = translated.replaceAll(fragment, replacement);
  }
  return !CYRILLIC.test(translated);
}

function isNonUiString(node) {
  const parent = node.parent;
  let owner = parent;
  while (owner) {
    if (ts.isVariableDeclaration(owner) && ["COLOR_MODE_NAMES", "CURRENT_THEME_LABEL", "CARD_LABEL"].includes(owner.name.getText())) return true;
    owner = owner.parent;
  }
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  return false;
}


const missing = new Map();
for (const file of await sourceFiles(APP_DIR)) {
  const sourceText = await readFile(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const record = (value, node) => {
    const normalized = normalize(value);
    if (!normalized || !CYRILLIC.test(normalized) || isCovered(normalized)) return;
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    const key = `${path.relative(ROOT, file)}:${line + 1}`;
    missing.set(`${key}\0${normalized}`, { location: key, value: normalized });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) record(node.getText(source), node);
    if (ts.isStringLiteralLike(node) && !isNonUiString(node)) record(node.text, node);
    if (ts.isTemplateExpression(node)) {
      record(node.head.text, node.head);
      for (const span of node.templateSpans) record(span.literal.text, span.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (missing.size) {
  console.error(`Untranslated Russian UI fragments: ${missing.size}`);
  for (const item of missing.values()) console.error(`${item.location}\t${item.value}`);
  process.exitCode = 1;
} else {
  console.log("English UI translation audit passed: no uncovered Russian fragments.");
}
