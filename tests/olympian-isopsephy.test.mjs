import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Children, createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { calendarModule } from "./helpers/calendar-modules.mjs";

const content = JSON.parse(readFileSync(new URL("../app/olympian-isopsephy.json", import.meta.url), "utf8"));
const languages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const { greekIsopsephy, restorationRoot, restorationTrace } = calendarModule("app/stoicheion-restoration-math.ts");
const expected = {
  zeus: [612, "Закон, мера, причина жизни."],
  hera: [109, "Воздух, атмосфера, пространство."],
  poseidon: [1219, "Глубинные течения, подсознание."],
  demeter: [468, "Рост, питание, циклы материи."],
  athena: [69, "Интеллектуальный пик (акме), стратегия."],
  apollo: [1061, "Единство, ясность, изгнание тьмы."],
  artemis: [656, "Защита, чистота, сохранение."],
  ares: [309, "Импульс, воля к господству."],
  aphrodite: [993, "Гармония, тяга, объединение."],
  hephaestus: [1289, "Формирование материи, мастерство."],
  hermes: [353, "Коммуникация, речь, обмен."],
  hestia: [516, "Центр, стабильность, сущность дома."],
  dionysus: [1004, "Творческий экстаз, преображение."],
};

test("every Olympian symbol ships as a transparent PNG shared by web and Android", () => {
  for (const deity of content.deities) {
    const png = readFileSync(new URL(`../public/theokyklos-symbols/olympian-${deity.id}-v313.png`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${deity.id}: valid PNG`);
    assert.ok(png.readUInt32BE(16) >= 128, `${deity.id}: sufficient icon resolution`);
    assert.equal(png.readUInt32BE(16), png.readUInt32BE(20), `${deity.id}: square canvas`);
    assert.equal(png[25], 6, `${deity.id}: preserve RGBA transparency`);
  }
});

test("all 13 Olympian names use Greek letters and verified isopsephy with the approved Aphrodite correction", () => {
  assert.equal(content.deities.length, 13);
  assert.deepEqual(content.deities.map(row => row.id), Object.keys(expected));
  for (const row of content.deities) {
    assert.match(row.greek, /^\p{Script=Greek}+$/u, `${row.id}: no Cyrillic or Latin lookalikes`);
    assert.equal(row.number, expected[row.id][0]);
    assert.equal(row.summary.ru, expected[row.id][1]);
    assert.deepEqual([...row.greek].map(greekIsopsephy), row.summands, `${row.id}: each summand belongs to its Greek letter`);
    const calculated = greekIsopsephy(row.greek);
    assert.equal(row.summands.reduce((sum, value) => sum + value, 0), calculated);
    assert.equal(row.calculatedNumber ?? row.number, calculated);
    assert.equal(row.number, calculated);
    assert.equal(row.calculationNote, undefined);
    for (const language of languages) {
      assert.ok(row.name[language].length > 0);
      assert.ok(row.summary[language].length > 3);
      assert.ok(row.detail[language].length > 40);
      if (language !== "en") assert.notEqual(row.detail[language], row.detail.en, `${row.id}/${language}: translated text must not be English fallback`);
    }
  }
  const aphrodite = content.deities.find(row => row.id === "aphrodite");
  assert.deepEqual(restorationTrace(aphrodite.number), [993, 21, 3]);
  assert.equal(restorationRoot(aphrodite.number), 3);
});

test("all 14 languages contain every metadata field, deity text and Kronos reference", () => {
  assert.deepEqual(Object.keys(content.locales).sort(), [...languages].sort());
  for (const language of languages) {
    assert.deepEqual(Object.keys(content.locales[language]).sort(), ["title", "subtitle", "intro", "link", "close", "formula", "root"].sort());
    Object.entries(content.locales[language]).forEach(([key, value]) => assert.ok(typeof value === "string" && value.trim(), `${language}/${key}`));
    assert.ok(content.references[0].name[language]);
    for (const row of content.deities) {
      for (const field of ["name", "summary", "detail"]) assert.deepEqual(Object.keys(row[field]).sort(), [...languages].sort(), `${row.id}/${field}`);
      assert.equal(greekIsopsephy(row.greek), row.number);
    }
  }
});

test("Kronos remains a verified reference outside the 13 Olympians, each with distinct shared vector geometry", () => {
  assert.deepEqual(content.references.map(row => row.id), ["kronos"]);
  assert.equal(greekIsopsephy(content.references[0].greek), 510);
  assert.equal(content.references[0].number, 510);
  assert.equal(content.deities.some(row => row.id === "kronos"), false);
  const symbols = new Set(content.deities.map(row => row.paths.join("|")));
  assert.equal(symbols.size, 13);
  content.deities.forEach(row => {
    assert.ok(row.paths.length >= 1);
    row.paths.forEach(path => assert.match(path, /^[Mm][0-9A-Za-z.,\s-]+$/));
  });
});

function descendants(node) {
  if (!isValidElement(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(descendants)];
}
const escaped = value => renderToStaticMarkup(createElement("p", null, value)).slice(3, -4);

test("the real spoiler, all 13 dialogs and Stoicheion navigation preserve content and accessibility", async t => {
  const root = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:olympian-isopsephy-render";
  const bundle = await build({
    configFile: false, logLevel: "silent",
    plugins: [react(), {
      name: "olympian-isopsephy-render-entry",
      resolveId: id => id === entry ? entry : undefined,
      load: id => id === entry ? `
        export { OlympianIsopsephy, OlympianIsopsephyContent, OlympianIsopsephyDialog } from ${JSON.stringify(root + "OlympianIsopsephy.tsx")};
        export { TheokyklosView } from ${JSON.stringify(root + "TheokyklosView.tsx")};
        export { EMPTY_HABIT_WORKSPACE } from ${JSON.stringify(root + "habits.ts")};
      ` : undefined,
    }],
    build: { ssr: true, write: false, rolldownOptions: {
      input: entry, external: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
      output: { codeSplitting: false },
    } },
  });
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL(`olympian-isopsephy-${randomUUID()}.mjs`, directory);
  await writeFile(file, bundle.output.find(row => row.isEntry).code);
  try {
    const api = await import(pathToFileURL(fileURLToPath(file)).href);
    await t.test("the Olympian catalog starts as a dialog button at the end of Theokyklos in all 14 languages", () => {
      for (const language of languages) {
        const lang = language;
        const html = renderToStaticMarkup(createElement(api.TheokyklosView, {
          language, workspace: api.EMPTY_HABIT_WORKSPACE, date: "2026-10-30", calendarMode: "profane", onChange() {},
        }));
        assert.match(html, /<div class="olympian-isopsephy"[^>]*>/);
        assert.match(html, /<button[^>]*class="year-details-button olympian-disclosure"[^>]*aria-haspopup="dialog"/);
        assert.doesNotMatch(html, /<details class="olympian-isopsephy"/);
        assert.equal((html.match(/data-olympian=/g) ?? []).length, 0, "the unopened catalog does not occupy page space");
        assert.ok(html.indexOf('class="olympian-isopsephy"') > html.indexOf('class="theokyklos-mandala"'));
        assert.ok(html.endsWith("</button></div></section>"), "the dialog entry belongs at the very end of the section");
        assert.ok(html.includes(content.locales[lang].title));
        const catalog = renderToStaticMarkup(createElement(api.OlympianIsopsephyContent, { language, onSelect() {} }));
        assert.equal((catalog.match(/data-olympian=/g) ?? []).length, 13);
        for (const deity of content.deities) {
          assert.ok(catalog.includes(escaped(deity.summary[lang])), `${language}/${deity.id}: complete summary`);
          assert.ok(catalog.includes(`/theokyklos-symbols/olympian-${deity.id}-v313.png`));
        }
        assert.match(catalog, /<li class="olympian-wide"><button[^>]*data-olympian="dionysus"/);
      }
    });
    await t.test("each tile selects its own deity, and the actual Stoicheion link invokes navigation once", () => {
      const selected = [];
      let opens = 0;
      let prevented = 0;
      const tree = api.OlympianIsopsephyContent({ language: "ru", onSelect: deity => selected.push(deity.id), onOpenStoicheion: () => opens++ });
      const nodes = descendants(tree);
      const tiles = nodes.filter(node => node.type === "button" && node.props["data-olympian"]);
      assert.equal(tiles.length, 13);
      tiles.forEach(tile => {
        assert.equal(tile.props["aria-haspopup"], "dialog");
        assert.equal(tile.props["data-dialog-save"], "false", "translated descriptions cannot be mistaken for a Save control");
        tile.props.onClick();
      });
      assert.deepEqual(selected, content.deities.map(row => row.id));
      const link = nodes.find(node => node.type === "a" && node.props.href === "#stoicheion");
      link.props.onClick({ preventDefault() { prevented++; } });
      assert.equal(opens, 1);
      assert.equal(prevented, 1);
      link.props.onClick({ metaKey: true, preventDefault() { prevented++; } });
      assert.equal(opens, 1, "modified clicks retain ordinary link behaviour");
      assert.equal(prevented, 1);
    });
    await t.test("every small dialog labels itself, shows the true calculation and retains the authored interpretation", () => {
      for (const language of languages) {
        for (const deity of content.deities) {
          const html = renderToStaticMarkup(createElement(api.OlympianIsopsephyDialog, { deity, language, onClose() {} }));
          const sum = deity.calculatedNumber ?? deity.number;
          assert.equal((html.match(/role="dialog"/g) ?? []).length, 1);
          assert.match(html, /aria-modal="true"/);
          assert.match(html, /aria-labelledby="[^"]+" aria-describedby="[^"]+"/);
          assert.ok(html.includes(deity.greek));
          assert.ok(html.includes(escaped(deity.detail[language])));
          assert.ok(html.includes(`${deity.summands.join(" + ")} = ${sum}`));
          assert.ok(html.includes(`${content.locales[language].root}: ${restorationRoot(sum)}`));
          assert.ok(html.includes(`${content.locales[language].close}: ${deity.name[language]}`));
          if (deity.calculationNote) assert.ok(html.includes(escaped(deity.calculationNote[language])));
        }
      }
    });
  } finally { await rm(file); }
});
