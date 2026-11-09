import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const sourcePath = new URL("../../app/i18n.ts", import.meta.url);
const outputPath = new URL("../../app/curated-translations.en.json", import.meta.url);
const source = ts.createSourceFile("i18n.ts", await readFile(sourcePath, "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const declaration = source.statements.flatMap((statement) =>
  ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [])
  .find((item) => item.name.getText(source) === "curatedTranslations");
if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) {
  throw new Error("Could not find the reviewed web translation catalog");
}

const translations = {};
for (const property of declaration.initializer.properties) {
  if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) ||
      !ts.isStringLiteral(property.initializer)) {
    throw new Error(`Unsupported curated translation at ${property.pos}`);
  }
  translations[property.name.text] = property.initializer.text;
}

const serialized = `${JSON.stringify(translations, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (await readFile(outputPath, "utf8") !== serialized) {
    throw new Error("Android curated translations are stale; run node android/tools/export-web-i18n.mjs");
  }
} else {
  await writeFile(outputPath, serialized);
}
