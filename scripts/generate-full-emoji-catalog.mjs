// Unicode Emoji 18.0 data: https://www.unicode.org/Public/emoji/latest/emoji-test.txt
// © 2026 Unicode, Inc. https://www.unicode.org/terms_of_use.html
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) throw new Error("Pass the downloaded Unicode emoji-test.txt path.");
const labels = {
  "Smileys & Emotion": "Лица и эмоции",
  "People & Body": "Люди и жесты",
  Component: "Варианты",
  "Animals & Nature": "Животные и природа",
  "Food & Drink": "Еда и напитки",
  "Travel & Places": "Путешествия и места",
  Activities: "Занятия",
  Objects: "Предметы",
  Symbols: "Символы",
  Flags: "Флаги",
};
const groups = [];
let group = null;
for (const line of readFileSync(input, "utf8").split(/\r?\n/u)) {
  if (line.startsWith("# group: ")) {
    const labelEn = line.slice(9);
    if (!labels[labelEn]) throw new Error(`Unknown Unicode group: ${labelEn}`);
    group = { id: labelEn.toLowerCase().replace(/[^a-z]+/gu, "-"),
      label: labels[labelEn], labelEn, emojis: [] };
    groups.push(group);
    continue;
  }
  const match = line.match(/^([0-9A-F ]+)\s*;\s*(fully-qualified|component)\s*#/u);
  if (match && group) group.emojis.push(String.fromCodePoint(...match[1].trim().split(/\s+/u)
    .map((code) => Number.parseInt(code, 16))));
}
if (groups.length !== 10 || groups.reduce((sum, item) => sum + item.emojis.length, 0) < 3500) {
  throw new Error("The Unicode emoji file is incomplete.");
}
writeFileSync(new URL("../app/emoji-full-catalog.json", import.meta.url),
  `${JSON.stringify(groups, null, 2)}\n`);
process.stdout.write(`${groups.length} groups, ${groups.reduce((sum, item) => sum + item.emojis.length, 0)} emoji\n`);
