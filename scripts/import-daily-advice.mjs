import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const adviceCategories = ["aretology", "hermetica", "kourotrophy", "hestiology", "aphrodisia", "psychopompia"];

export function parseAdviceParagraphs(text, category, { language = "ru", sources = [] } = {}) {
  if (!adviceCategories.includes(category)) throw new Error("Unknown advice category");
  if (!/^[a-z]{2}(?:-[A-Za-z]{2,8})?$/.test(language)) throw new Error("Invalid content language");
  if (!Array.isArray(sources) || sources.some(source => !source.work?.trim() || !["quote", "inspired"].includes(source.kind))) throw new Error("Invalid source metadata");
  const paragraphs = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split(/\n[\t ]*\n+/).map(body => body.trim()).filter(Boolean);
  if (!paragraphs.length) throw new Error("The input contains no advice paragraphs");
  return paragraphs.map(body => {
    if (Buffer.byteLength(body, "utf8") > 24000) throw new Error("An advice paragraph exceeds 24000 bytes; check paragraph separators");
    const normalized = body.normalize("NFC").replace(/\s+/gu, " ");
    return { id: `advice-${createHash("sha256").update(normalized).digest("hex").slice(0, 24)}`, categories: [category], body, language, sources };
  });
}

export function mergeAdviceCatalog(catalog, entries) {
  if (catalog.version !== 1 || !Array.isArray(catalog.items)) throw new Error("Unsupported advice catalog");
  const items = new Map(catalog.items.map(entry => [entry.id, entry]));
  if (items.size !== catalog.items.length) throw new Error("Duplicate IDs in the existing catalog");
  for (const entry of entries) {
    const previous = items.get(entry.id);
    if (previous && previous.language !== entry.language) throw new Error("An existing paragraph has a different language");
    items.set(entry.id, previous ? { ...previous,
      categories: adviceCategories.filter(id => [...previous.categories, ...entry.categories].includes(id)),
      sources: Array.from(new Map([...previous.sources, ...entry.sources].map(source => [JSON.stringify(source), source])).values()),
    } : entry);
  }
  return { ...catalog, items: [...items.values()] };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (args.includes("--help")) {
    console.log("node scripts/import-daily-advice.mjs --category hermetica --input advice.txt [--language ru] [--source-work WORK --source-author AUTHOR] [--write]\nWithout --write, only reports the import. Separate posts with a blank line. New raw posts are private drafts until titles, artwork and all translations are prepared."); return;
  }
  const category = option("--category"), input = option("--input");
  if (!input || !category) throw new Error("Both --category and --input are required; use --help");
  const catalogPath = fileURLToPath(new URL("../server/content/daily-advice.json", import.meta.url));
  const sources = option("--source-work") ? [{ work: option("--source-work"), ...(option("--source-author") ? { author: option("--source-author") } : {}), kind: "inspired" }] : [];
  const entries = parseAdviceParagraphs(await readFile(resolve(input), "utf8"), category, { language: option("--language") || "ru", sources }).map(entry => ({ ...entry, status: "draft" }));
  const catalog = JSON.parse(await readFile(catalogPath, "utf8"));
  const merged = mergeAdviceCatalog(catalog, entries);
  if (args.includes("--write")) await writeFile(catalogPath, JSON.stringify(merged, null, 2) + "\n");
  console.log(JSON.stringify({ mode: args.includes("--write") ? "written" : "preview", paragraphs: entries.length, added: merged.items.length - catalog.items.length, total: merged.items.length }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
