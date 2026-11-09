/* eslint-disable @typescript-eslint/no-require-imports */
// Editorial-only bridge for scripts/localize-catalogs.py.
// Install the helper outside the tracked tree: npm install --prefix output/i18n/translate anylang
const fs = require("node:fs");
const { GoogleTranslatorTokenFree } = require("../output/i18n/translate/node_modules/anylang/translators");

const { text, source, language } = JSON.parse(fs.readFileSync(0, "utf8"));
new GoogleTranslatorTokenFree()
  .translate(text, source, language === "zh" ? "zh-CN" : language)
  .then((translation) => process.stdout.write(JSON.stringify({ translation })))
  .catch((error) => {
    process.stderr.write(String(error));
    process.exitCode = 1;
  });
