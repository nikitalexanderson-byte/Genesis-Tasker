import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url), ts = require("typescript"), cache = new Map();

/** Load real authored locale catalogs, including calendar raw source, without React rendering. */
export function localizedModule(path) {
  const file = resolve(root, path);
  if (cache.has(file)) return cache.get(file).exports;
  const loaded = { exports: {} }; cache.set(file, loaded);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  new Function("require", "module", "exports", source)(id => {
    if (!id.startsWith(".")) return require(id);
    const target = resolve(dirname(file), id.replace(/\?raw$/u, ""));
    if (id.endsWith("?raw")) return readFileSync(target, "utf8");
    if (id.endsWith(".json")) return JSON.parse(readFileSync(target, "utf8"));
    return localizedModule(existsSync(target) ? target : `${target}.ts`);
  }, loaded, loaded.exports);
  return loaded.exports;
}
