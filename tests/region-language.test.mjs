import assert from "node:assert/strict";
import test from "node:test";
import { languageForRegion, regionFromLocales } from "../app/region-language.ts";

test("a language-only preference does not mask the device's region", () => {
  assert.equal(regionFromLocales(["en", "ru-RU"]), "RU");
  assert.equal(regionFromLocales(["zh-Hant-TW"]), "TW");
  assert.equal(regionFromLocales(["en-u-ca-gregory", "de-AT"]), "AT");
  assert.equal(regionFromLocales(["invalid!", "ja-JP"]), "JP");
});

test("location hints choose the city's language before a different interface locale", () => {
  assert.equal(languageForRegion("America/Los_Angeles", "RU"), "en");
  assert.equal(languageForRegion("Asia/Tokyo", "RU"), "ja");
  assert.equal(languageForRegion("Europe/Warsaw", "RU"), "pl");
  assert.equal(languageForRegion("Etc/UTC", "US"), "en");
});
