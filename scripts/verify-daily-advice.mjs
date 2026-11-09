import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const adviceLanguages = ["ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja"];
const root = fileURLToPath(new URL("../", import.meta.url));

/** Bind each reviewed translation to its ID, language, body, category and artwork. */
export function verifyAdvicePairing(entry, language, content, reviewed) {
  const payload = [entry.id, entry.contentVersion, entry.categories, entry.image, language, content.title, content.body];
  if(entry.categories.includes("aphrodisia")) payload.push(entry.requiresAdult, entry.aphrodisiaTheme);
  if(entry.categories.includes("psychopompia")) payload.push(entry.requiresAdult, entry.containsAlcohol, entry.subcategories, entry.review?.status);
  const actual = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  if (reviewed?.locales?.[language] !== actual) throw new Error(`Unreviewed advice title/body pairing: ${entry.id} (${language})`);
}

/** Release gate: never let a partially translated or unillustrated post reach daily selection. */
export async function verifyDailyAdvice(base = root) {
  const catalog = JSON.parse(await readFile(resolve(base, "server/content/daily-advice.json"), "utf8"));
  if (catalog.version !== 1 || !Array.isArray(catalog.items)) throw new Error("Unsupported daily advice catalog");
  const review = JSON.parse(await readFile(resolve(base, "server/content/daily-advice-pairings.json"), "utf8"));
  if (review.version !== 1 || !review.entries || typeof review.entries !== "object") throw new Error("Missing advice pairing review");
  const catalogById = new Map(catalog.items.map(entry => [entry.id, entry]));
  for (const category of ["aretology", "hermetica", "kourotrophy", "hestiology", "aphrodisia"]) {
    if (!catalog.items.some(entry => entry.categories.includes(category))) continue;
    const source = JSON.parse(await readFile(resolve(base, `server/content/${category}-source-manifest.json`), "utf8"));
    for (const original of source.entries) {
      const entry = catalogById.get(original.id);
      if (!entry || !entry.categories.includes(category) || createHash("sha256").update(`${entry.title}${original.headingSeparator ?? ". "}${entry.body}`).digest("hex") !== original.textSha256
        || (entry.status ?? "published") !== original.status) throw new Error(`Author's ${category} source changed: ${original.number}`);
      const reviewed = review.entries[original.id];
      if (entry.status !== "draft" && (reviewed?.category !== category || reviewed?.sourceNumber !== original.number)) throw new Error(`Wrong advice source pairing: ${original.id}`);
    }
  }
  const ids = new Set(); const images = new Set(); const imageHashes = new Set(); const locales = new Map();
  let published = 0, drafts = 0;
  for (const entry of catalog.items) {
    if (!/^advice-[a-f0-9]{24}$/.test(entry.id) || ids.has(entry.id)) throw new Error("Invalid or duplicate advice identity");
    ids.add(entry.id);
    if (entry.status === "draft") { drafts++; continue; }
    published++;
    if (!/^[a-z0-9-]{1,80}$/.test(entry.contentVersion) || !entry.title?.trim() || !entry.body?.trim()) throw new Error(`Unprepared advice: ${entry.id}`);
    if(entry.categories.includes("aphrodisia") && (typeof entry.requiresAdult !== "boolean" || !["love","aesthetics","consciousness"].includes(entry.aphrodisiaTheme))) throw new Error(`Missing Aphrodisia classification: ${entry.id}`);
    const reviewed = review.entries[entry.id];
    if (reviewed?.contentVersion !== entry.contentVersion || reviewed?.title !== entry.title
      || Object.keys(reviewed.locales ?? {}).sort().join() !== [...adviceLanguages].sort().join()) throw new Error(`Missing advice pairing review: ${entry.id}`);
    if (!Array.isArray(entry.categories) || !entry.categories.length || entry.categories.some(id => !["aretology", "hermetica", "kourotrophy", "hestiology", "aphrodisia", "psychopompia"].includes(id))) throw new Error(`Invalid categories: ${entry.id}`);
    if (entry.image !== `/advice-art/${entry.categories[0]}/${entry.id}.webp` || images.has(entry.image)) throw new Error(`Missing distinct artwork: ${entry.id}`);
    images.add(entry.image);
    const image = await readFile(resolve(base, "public", entry.image.slice(1)));
    if (image.toString("ascii", 0, 4) !== "RIFF" || image.toString("ascii", 8, 12) !== "WEBP") throw new Error(`Invalid WebP: ${entry.id}`);
    const imageHash = createHash("sha256").update(image).digest("hex");
    if (imageHashes.has(imageHash)) throw new Error(`Reused illustration: ${entry.id}`);
    imageHashes.add(imageHash);
    for (const language of adviceLanguages) {
      const key = `${entry.contentVersion}:${language}`;
      if (!locales.has(key)) locales.set(key, JSON.parse(await readFile(resolve(base, "server/content/daily-advice", entry.contentVersion, `${language}.json`), "utf8")));
      const content = locales.get(key)[entry.id];
      if (!content || Object.keys(content).sort().join() !== "body,title" || typeof content.title !== "string" || typeof content.body !== "string"
        || !content.title.trim() || !content.body.trim() || Buffer.byteLength(content.title) > 2000 || Buffer.byteLength(content.body) > 24000
        || /\[\[\[|\]\]\]|GENESIS_TERM_|Результаты перевода|### Result/.test(content.title + content.body)) throw new Error(`Incomplete ${language} advice: ${entry.id}`);
      if (language === entry.language && (content.title !== entry.title || content.body !== entry.body)) throw new Error(`Source text changed in locale: ${entry.id}`);
      verifyAdvicePairing(entry, language, content, reviewed);
    }
    if (entry.schedule && (!entry.schedule.phases?.length || entry.schedule.phases.some(phase => !["new", "full"].includes(phase))
      || !entry.schedule.leadDays?.length || entry.schedule.leadDays.some(day => ![1, 2, 3].includes(day)))) throw new Error(`Invalid lunar window: ${entry.id}`);
    if (entry.timeOfDay !== undefined && !["morning", "evening"].includes(entry.timeOfDay)) throw new Error(`Invalid local time window: ${entry.id}`);
    if (entry.priority !== undefined && typeof entry.priority !== "boolean") throw new Error(`Invalid advice priority: ${entry.id}`);
  }
  if (Object.keys(review.entries).length !== published || Object.keys(review.entries).some(id => !ids.has(id) || catalogById.get(id).status === "draft")) throw new Error("Advice pairing review does not match the published catalog");
  return { published, drafts, languages: adviceLanguages.length, illustrations: images.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyDailyAdvice().then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
