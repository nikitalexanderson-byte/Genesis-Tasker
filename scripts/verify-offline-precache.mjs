import { readdir, readFile, stat } from "node:fs/promises";

const outputRoot = new URL("../dist-web/public_html/", import.meta.url);
const assetsRoot = new URL("assets/", outputRoot);
const MAX_PRODUCTION_JS_CHUNK_BYTES = 350_000;
const HERO_PATH_ICON_FILES = [
  "01_tantal",
  "02_sisyphus",
  "03_cyclops",
  "04_icarus",
  "05_lionheart",
  "06_poison_conqueror",
  "07_golden_horn_pathfinder",
  "08_mountain_tamer",
  "09_lord_of_the_flow",
  "10_bronze_wing",
  "11_tamer_of_might",
  "12_iron_charioteer",
  "13_bearer_of_royal_honor",
  "14_guardian_of_the_western_border",
  "15_keeper_of_the_golden_garden",
  "16_risen_from_the_abyss",
  "17_amphora_of_aspiration",
  "18_amphora_of_endurance",
  "19_amphora_of_mastery",
  "20_amphora_of_abyss",
];
const mindmapIcons = JSON.parse(await readFile(new URL("../app/mindmap-icon-catalog.json", import.meta.url), "utf8"));
const physisExerciseMedia = JSON.parse(await readFile(new URL("../app/physis/exercise-media-data.json", import.meta.url), "utf8"));
const moodFaces = JSON.parse(await readFile(new URL("../app/mood-faces.json", import.meta.url), "utf8"));
const REQUIRED_VISUAL_ASSETS = [
  "weekday-art/lunar-artemis-v326.webp",
  "weekday-art/lunar-selene-v326.webp",
  "weekday-art/lunar-hecate-v326.webp",
  ...moodFaces.faces.map(face => `tracker-art/moods/mood-${face.value + 5}.svg`),
  ...Object.values(physisExerciseMedia).flatMap(asset => [asset.src.slice(1), asset.poster.slice(1)]),
  ...mindmapIcons.map(icon => `mindmap-icons/${icon.id}.png`),
  ...Array.from({ length: 13 }, (_, index) => `lunar-month-art-v1/month-${String(index + 1).padStart(2, "0")}.webp`),
  "habit-ranks/heroic-ranks.webp",
  "physis-art/apollo-artemis-v1.webp",
  "physis-art/apollo-artemis-mobile-v1.webp",
  "physis-art/landscape-v2.webp",
  "physis-art/apollo-artemis-cutout-v2.webp",
  "calendar-art/saturn-cronus.webp",
  "calendar-art/genesis-sacred-calendar-v8.svg",
  "achievement-art/first-step.png",
  "achievement-art/three-day-rhythm.png",
  "achievement-art/seven-sunrises.png",
  "achievement-art/fortnight-rhythm.png",
  "achievement-art/perfect-day.png",
  "achievement-art/habit-thirty.png",
  "achievement-art/century.png",
  "achievement-art/iron-rhythm.png",
  "achievement-art/fifty-sunrises.png",
  "achievement-art/hundred-day-path.png",
  "achievement-art/perfect-week.png",
  "achievement-art/perfect-month.png",
  "achievement-art/half-year-circle.png",
  "achievement-art/full-revolution.png",
  "achievement-art/five-hundred-sunrises.png",
  "achievement-art/thousand-day-path.png",
  "achievement-art/comeback.png",
  "achievement-art/consistency.png",
  "habit-reward-art/hestia-spark.png",
  "habit-reward-art/comeback.png",
  ...HERO_PATH_ICON_FILES.flatMap((fileName) => [
    `hero-path/256/${fileName}.webp`,
    `hero-path/512/${fileName}.webp`,
  ]),
  "theokyklos-art/northwest-apollo.webp",
  "theokyklos-art/north-athena.webp",
  "theokyklos-art/northeast-artemis.webp",
  "theokyklos-art/west-poseidon-amphitrite.webp",
  "theokyklos-art/center-dionysus-ariadne.webp",
  "theokyklos-art/east-hermes-peitho.webp",
  "theokyklos-art/southwest-demeter.webp",
  "theokyklos-art/south-ares-aphrodite.webp",
  "theokyklos-art/southeast-hephaestus-aglaea.webp",
  "theokyklos-art/zenith-zeus-hera.webp",
  "theokyklos-art/hearth-hestia.webp",
  "theokyklos-art/nadir-hades-persephone.webp",
  "theokyklos-art/entrance-aether-hemera.webp",
  "theokyklos-art/exit-eros-psyche.webp",
  "theokyklos-symbols/northwest-apollo.png",
  "theokyklos-symbols/north-athena.png",
  "theokyklos-symbols/northeast-artemis.png",
  "theokyklos-symbols/west-poseidon-amphitrite.png",
  "theokyklos-symbols/center-dionysus-ariadne.png",
  "theokyklos-symbols/east-hermes-peitho.png",
  "theokyklos-symbols/southwest-demeter.png",
  "theokyklos-symbols/south-ares-aphrodite.png",
  "theokyklos-symbols/southeast-hephaestus-aglaea.png",
  "theokyklos-symbols/zenith-zeus-hera.png",
  "theokyklos-symbols/hearth-hestia.png",
  "theokyklos-symbols/nadir-hades-persephone.png",
  "theokyklos-symbols/entrance-aether-hemera.png",
  "theokyklos-symbols/exit-eros-psyche.png",
  "theokyklos-symbols/olympian-zeus-v313.png",
  "theokyklos-symbols/olympian-hera-v313.png",
  "theokyklos-symbols/olympian-poseidon-v313.png",
  "theokyklos-symbols/olympian-demeter-v313.png",
  "theokyklos-symbols/olympian-athena-v313.png",
  "theokyklos-symbols/olympian-apollo-v313.png",
  "theokyklos-symbols/olympian-artemis-v313.png",
  "theokyklos-symbols/olympian-ares-v313.png",
  "theokyklos-symbols/olympian-aphrodite-v313.png",
  "theokyklos-symbols/olympian-hephaestus-v313.png",
  "theokyklos-symbols/olympian-hermes-v313.png",
  "theokyklos-symbols/olympian-hestia-v313.png",
  "theokyklos-symbols/olympian-dionysus-v313.png",
  "theokyklos-symbols/olympian-kronos-v324.png",
];
const [html, manifest, serviceWorker] = await Promise.all([
  readFile(new URL("index.html", outputRoot), "utf8"),
  readFile(new URL("precache-manifest.js", outputRoot), "utf8"),
  readFile(new URL("sw.js", outputRoot), "utf8"),
]);

const entryAssets = Array.from(html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/gi), (match) => match[1]);
if (!entryAssets.length) throw new Error("Built index.html contains no JavaScript or CSS entry assets.");

const missingAssets = entryAssets.filter((asset) => !manifest.includes(JSON.stringify(asset)));
if (missingAssets.length) throw new Error(`Offline precache manifest is missing: ${missingAssets.join(", ")}`);
if (!/__GENESIS_PRECACHE_VERSION="[a-f0-9]{16}"/.test(manifest)) throw new Error("Offline precache manifest has no build fingerprint.");
const precacheVersion = manifest.match(/__GENESIS_PRECACHE_VERSION="([a-f0-9]{16})"/)?.[1];
if (!serviceWorker.startsWith(`// GENESIS precache build: ${precacheVersion}\n`)) {
  throw new Error("Service worker is not stamped with the current precache build.");
}
const configuredBase = process.env.GENESIS_BASE_PATH?.trim() || "/";
const basePath = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;
const precacheUrls = JSON.parse(manifest.match(/self\.__GENESIS_PRECACHE=(\[.*?\]);/s)?.[1] || "[]");
if (!precacheUrls.length) throw new Error("Offline precache manifest has no resource URLs.");
const nonexistentPrecacheAssets = [];
for (const url of precacheUrls) {
  if (!url.startsWith(basePath)) throw new Error(`Unexpected precache URL: ${url}`);
  const relativePath = url.slice(basePath.length);
  if (relativePath.includes("..")) throw new Error(`Unsafe precache path: ${url}`);
  try {
    await stat(new URL(relativePath, outputRoot));
  } catch {
    nonexistentPrecacheAssets.push(url);
  }
}
if (nonexistentPrecacheAssets.length) throw new Error(`Offline precache references nonexistent build files: ${nonexistentPrecacheAssets.join(", ")}`);
if (!serviceWorker.includes('importScripts(new URL("./precache-manifest.js", SCOPE).href)')) throw new Error("Service worker does not import the generated precache manifest.");

const missingVisualAssets = [];
for (const asset of REQUIRED_VISUAL_ASSETS) {
  try {
    await stat(new URL(asset, outputRoot));
  } catch {
    missingVisualAssets.push(asset);
    continue;
  }
  if (asset.startsWith("mindmap-icons/") || asset.startsWith("tracker-art/moods/")) {
    if (!precacheUrls.includes(`${basePath}${asset}`)) missingVisualAssets.push(`${asset} (not precached)`);
  } else if (asset.startsWith("hero-path/")) {
    const fileName = asset.slice(asset.lastIndexOf("/") + 1, -".webp".length);
    const size = asset.split("/")[1];
    if (!serviceWorker.includes(JSON.stringify(fileName)) || !serviceWorker.includes(`\`./hero-path/${size}/\${fileName}.webp\``)) {
      missingVisualAssets.push(`${asset} (not precached)`);
    }
  } else if (!serviceWorker.includes(JSON.stringify(`./${asset}`))) {
    missingVisualAssets.push(`${asset} (not precached)`);
  }
}
if (missingVisualAssets.length) throw new Error(`Required visual assets are missing: ${missingVisualAssets.join(", ")}`);

const javascriptAssets = (await readdir(assetsRoot)).filter((fileName) => fileName.endsWith(".js"));
const javascriptAssetSizes = await Promise.all(javascriptAssets.map(async (fileName) => ({
  fileName,
  bytes: (await stat(new URL(fileName, assetsRoot))).size,
})));
const oversizedChunks = javascriptAssetSizes.filter(({ bytes }) => bytes > MAX_PRODUCTION_JS_CHUNK_BYTES);
if (oversizedChunks.length) {
  throw new Error(`Production JavaScript chunk budget exceeded (${MAX_PRODUCTION_JS_CHUNK_BYTES} bytes): ${oversizedChunks.map(({ fileName, bytes }) => `${fileName}=${bytes}`).join(", ")}`);
}
const largestChunk = javascriptAssetSizes.sort((left, right) => right.bytes - left.bytes)[0];

console.log(`Offline precache verified: ${entryAssets.length} mandatory entry assets and ${REQUIRED_VISUAL_ASSETS.length} visual assets. Largest JS chunk: ${largestChunk.fileName} (${largestChunk.bytes} bytes).`);
