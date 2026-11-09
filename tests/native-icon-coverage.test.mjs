import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../android/app/src/main/", import.meta.url));
const icons = readFileSync(path.join(root, "java/ru/genesis/calendar/ui/GenesisLucideIcons.kt"), "utf8");
const names = new Set([...icons.matchAll(/"([a-z0-9-]+)"\s*->/g)].map(match => match[1]));
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sources(file) : file.endsWith(".kt") ? [file] : [];
  });
}

test("literal native Lucide calls resolve to packaged drawables, including overflow-only content", () => {
  let checked = 0;
  for (const file of sources(path.join(root, "java"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/GenesisLucideIcon\(\s*"([a-z0-9_-]+)"/g)) {
      checked++;
      assert(names.has(match[1].replaceAll("_", "-")), `${path.relative(root, file)}: unbundled icon ${match[1]}`);
    }
  }
  assert(checked > 0, "The audit must cover actual feature call sites");
  for (const match of icons.matchAll(/R\.drawable\.([a-z0-9_]+)/g)) {
    assert(existsSync(path.join(root, `res/drawable/${match[1]}.xml`)), `Missing packaged drawable ${match[1]}`);
  }
});

test("release 3.1.9 labels cover the same 14 languages without missing text", () => {
  const copy = JSON.parse(readFileSync(new URL("../app/release-319-copy.json", import.meta.url), "utf8"));
  const languages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
  assert.deepEqual(Object.keys(copy).sort(), languages.sort());
  for (const [language, labels] of Object.entries(copy)) {
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(copy.ru).sort(), language);
    for (const value of Object.values(labels)) assert(typeof value === "string" && value.trim() && !value.includes("�"), language);
  }
  assert.equal(copy.ru.donation, "Донат на развитие приложения");
});
