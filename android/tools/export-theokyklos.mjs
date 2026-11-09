import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const repo = resolve(import.meta.dirname, '../..');
const output = resolve(repo, 'android/app/src/main/assets/catalogs/theokyklos.json');
const ids = [
  'north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest',
  'zenith', 'nadir', 'hearth', 'center', 'entrance', 'exit',
];

function sourceExports(relativePath) {
  const source = readFileSync(resolve(repo, relativePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
    reportDiagnostics: true,
  });
  if (compiled.diagnostics?.length) throw new Error(`TypeScript diagnostics in ${relativePath}`);
  const sourceModule = { exports: {} };
  runInNewContext(compiled.outputText, { module: sourceModule, exports: sourceModule.exports }, {
    filename: relativePath,
    timeout: 2000,
  });
  return sourceModule.exports;
}

const { THEOKYKLOS_SEGMENTS, THEOKYKLOS_DIRECTION_IDS } = sourceExports('app/theokyklos-data.ts');
const { THEOKYKLOS_DETAIL_ART, THEOKYKLOS_SYMBOL_ART, THEOKYKLOS_SYMBOL_COLORS } = sourceExports('app/theokyklos-assets.ts');
const { SACRED_PRACTICES, SACRED_SECTOR_GUIDANCE } = sourceExports('app/sacred-practices.ts');

if (THEOKYKLOS_SEGMENTS.length !== 14 || new Set(THEOKYKLOS_SEGMENTS.map(s => s.id)).size !== 14 ||
    ids.some((id, index) => THEOKYKLOS_SEGMENTS[index].id !== id)) {
  throw new Error('Theokyklos source must contain all 14 ordered sectors');
}
if (THEOKYKLOS_DIRECTION_IDS.length !== 8 ||
    ids.slice(0, 8).some((id, index) => THEOKYKLOS_DIRECTION_IDS[index] !== id)) {
  throw new Error('The eight mandala directions changed');
}
const segments = THEOKYKLOS_SEGMENTS.map(segment => {
  if (segment.words.length !== 4) throw new Error(`${segment.id}: expected four sacred words`);
  const art = THEOKYKLOS_DETAIL_ART[segment.id];
  const symbolArt = THEOKYKLOS_SYMBOL_ART[segment.id];
  if (!art || !symbolArt || !THEOKYKLOS_SYMBOL_COLORS[segment.id] ||
      !existsSync(resolve(repo, `public${art}`)) || !existsSync(resolve(repo, `public${symbolArt}`))) {
    throw new Error(`${segment.id}: original artwork or color missing`);
  }
  return { ...segment, art: art.slice(1), symbolArt: symbolArt.slice(1),
    color: THEOKYKLOS_SYMBOL_COLORS[segment.id] };
});
if (new Set(SACRED_PRACTICES.map(p => p.id)).size !== SACRED_PRACTICES.length ||
    SACRED_PRACTICES.some(p => !ids.includes(p.sectorId))) {
  throw new Error('Sacred practice IDs or sector links are invalid');
}
if (SACRED_SECTOR_GUIDANCE.length !== 9 ||
    new Set(SACRED_SECTOR_GUIDANCE.map(g => g.sectorId)).size !== 9 ||
    SACRED_SECTOR_GUIDANCE.some(g => ![...ids.slice(0, 8), 'center'].includes(g.sectorId) ||
      !g.upright?.ru || !g.reversed?.ru)) {
  throw new Error('Stoicheion sector guidance must cover the eight directions and center');
}
const serialized = `${JSON.stringify({ schemaVersion: 1, segments, practices: SACRED_PRACTICES,
  stoicheionGuidance: SACRED_SECTOR_GUIDANCE }, null, 2)}\n`;
if (process.argv.includes('--check')) {
  if (!existsSync(output) || readFileSync(output, 'utf8') !== serialized) {
    throw new Error('Theokyklos catalog is stale; run node android/tools/export-theokyklos.mjs');
  }
  process.stdout.write(`Theokyklos catalog matches source: ${segments.length} sectors, ${SACRED_PRACTICES.length} practices\n`);
} else {
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, serialized);
  process.stdout.write(`Exported ${segments.length} sectors and ${SACRED_PRACTICES.length} practices\n`);
}
