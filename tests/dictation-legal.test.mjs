import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mkdir, writeFile, rm} from "node:fs/promises";
import {fileURLToPath, pathToFileURL} from "node:url";
import {randomUUID} from "node:crypto";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {build} from "vite";
import react from "@vitejs/plugin-react";
import test from "node:test";
import {calendarModule} from "./helpers/calendar-modules.mjs";
import {assertPublicDocumentReferences} from "../scripts/public-document-references.mjs";

const languages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const copy = JSON.parse(readFileSync(new URL("../app/dictation-copy.json", import.meta.url), "utf8"));
const policy = calendarModule("app/dictation-legal.ts");

test("all fourteen spelling disclosures are authored and retain the direct text/IP and HTTPS facts", () => {
  assert.deepEqual(Object.keys(copy).sort(), [...languages].sort());
  for (const language of languages) {
    for (const field of ["legalTitle", "legalBody"]) {
      assert.ok(copy[language][field].trim(), `${language}:${field}`);
      if (language !== "ru") assert.notEqual(copy[language][field], copy.ru[field], `${language}:${field}: Russian fallback`);
      if (!["ru", "en"].includes(language)) assert.notEqual(copy[language][field], copy.en[field], `${language}:${field}: English fallback`);
      if (!["ru", "sr", "uk"].includes(language)) assert.doesNotMatch(copy[language][field], /[А-Яа-яЁё]/u, `${language}:${field}: Russian leaked`);
      assert.doesNotMatch(copy[language][field], /<\/?[A-Za-z][^>]*>|client_secret|access_token|refresh_token|\b2200\b|\b2500\b/iu);
    }
    assert.match(copy[language].legalBody, /HTTPS/);
    assert.match(copy[language].legalBody, /IP/);
    assert.match(copy[language].legalBody, /(?:Yandex\.Speller|Яндекс\.Спеллер)/);
  }
  assert.match(copy.ru.legalBody, /по умолчанию выключена/);
  assert.match(copy.ru.legalBody, /только новые окончательные фразы на русском, английском или украинском/);
  assert.match(copy.ru.legalBody, /напрямую с устройства по HTTPS/);
  assert.match(copy.ru.legalBody, /заголовок заметки, идентификаторы записи и аккаунта и другие данные профиля не добавляются/);
  assert.match(copy.ru.legalBody, /не записывает открытый текст фраз в журналы/);
  assert.match(copy.ru.legalBody, /бесплатна в пределах лимитов поставщика/);
  assert.match(copy.ru.legalBody, /не требует аккаунта у поставщика или платёжных реквизитов/);
  assert.match(copy.ru.legalBody, /не гарантирует исправление всей грамматики или пунктуации/);
});

test("the Russian static tuple and every localized lookup share one complete policy", () => {
  assert.deepEqual(policy.dictationSpellingLegalSection, [copy.ru.legalTitle, copy.ru.legalBody]);
  for (const language of languages) {
    const localized = policy.localizedDictationLegalSections(language);
    assert.equal(localized.size, 1);
    assert.deepEqual(localized.get(copy.ru.legalTitle), [copy[language].legalTitle, copy[language].legalBody]);
  }
  for (const language of ["unknown", "__proto__", "constructor"]) {
    assert.deepEqual([...policy.localizedDictationLegalSections(language)], [...policy.localizedDictationLegalSections("en")]);
  }
});

test("the public reference guard permits only the exact spelling disclosure and still rejects old login/hosting", () => {
  const escape = value => value.replace(/[&<>"']/g, character => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[character]);
  const section = `<section><h2>${escape(copy.ru.legalTitle)}</h2><p>${escape(copy.ru.legalBody)}</p></section>`;
  for (const page of ["privacy", "terms"]) {
    assert.doesNotThrow(() => assertPublicDocumentReferences(`<body>${section}<p>Google OAuth</p></body>`, page));
    for (const forbidden of ["genesiscalendar.ru", "Beget", "Вход через Яндекс", "https://oauth.yandex.ru/authorize", "Yandex ID", section]) {
      assert.throws(() => assertPublicDocumentReferences(`<body>${section}<p>${forbidden}</p></body>`, page));
    }
    assert.throws(() => assertPublicDocumentReferences(`<body>${section.replace("бесплатна", "платна")}</body>`, page), /complete optional spelling disclosure/);
  }
  for (const page of ["support", "delete-account"]) assert.throws(() => assertPublicDocumentReferences(section, page));
});

test("real privacy and terms render the selected complete spelling policy without DOM translation", async () => {
  const root = fileURLToPath(new URL("../app/", import.meta.url)).replaceAll("\\", "/");
  const entry = "virtual:dictation-legal-contract";
  const bundle = await build({configFile: false, logLevel: "silent", plugins: [react(), {
    name: "dictation-legal-contract", resolveId: id => id === entry ? entry : undefined,
    load: id => id === entry ? `export {LegalPage} from ${JSON.stringify(root + "LegalPage.tsx")};export {legalPages} from ${JSON.stringify(root + "legal-content.ts")};export {setRuntimeLanguage} from ${JSON.stringify(root + "i18n.ts")};` : undefined,
  }], build: {ssr: true, write: false, rolldownOptions: {input: entry, external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"], output: {codeSplitting: false}}}});
  const directory = new URL("../node_modules/.cache/genesis-tests/", import.meta.url);
  await mkdir(directory, {recursive: true});
  const file = new URL(`dictation-legal-${randomUUID()}.mjs`, directory);
  await writeFile(file, bundle.output.find(item => item.isEntry).code);
  try {
    const {LegalPage, legalPages, setRuntimeLanguage} = await import(pathToFileURL(fileURLToPath(file)).href);
    for (const language of languages) {
      setRuntimeLanguage(language);
      for (const page of ["privacy", "terms"]) {
        assert.equal(legalPages[page].sections.filter(([title]) => title === copy.ru.legalTitle).length, 1);
        assert.ok(legalPages[page].sections.some(([title, body]) => title === copy.ru.legalTitle && body === copy.ru.legalBody));
        const html = renderToStaticMarkup(createElement(LegalPage, {page}));
        const expected = renderToStaticMarkup(createElement("section", {"data-no-translate": true}, createElement("h2", null, copy[language].legalTitle), createElement("p", null, copy[language].legalBody)));
        assert.ok(html.includes(expected), `${language}:${page}: actual section is missing or translated incrementally`);
        if (language !== "ru") assert.ok(!html.includes(copy.ru.legalBody), `${language}:${page}: Russian source leaked`);
        if (page === "terms") assert.ok(legalPages[page].sections.some(([title, body]) => title === "Учётная запись" && body.includes("только через Google OAuth")), "public authentication must stay Google-only");
      }
    }
  } finally { await rm(file); }
});
