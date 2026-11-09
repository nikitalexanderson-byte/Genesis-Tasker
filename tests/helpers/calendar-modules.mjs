import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const modules = new Map();
export function calendarModule(path) {
  const file = resolve(root, path);
  if (modules.has(file)) return modules.get(file);
  const loaded = {exports: {}};
  const js = ts.transpileModule(readFileSync(file, "utf8"), {compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText;
  new Function("require", "module", "exports", js)(id => {
    if (id === "./i18n") return {runtimeLocale: () => "ru-RU", getRuntimeLanguage: () => "ru", translateText: value => value};
    if (id.endsWith("?raw")) return readFileSync(resolve(dirname(file), id.slice(0, -4)), "utf8");
    if (id.endsWith(".json")) return JSON.parse(readFileSync(resolve(dirname(file), id), "utf8"));
    return id.startsWith(".") ? calendarModule(resolve(dirname(file), id.endsWith(".ts") ? id : `${id}.ts`)) : require(id);
  }, loaded, loaded.exports);
  modules.set(file, loaded.exports);
  return loaded.exports;
}
