// Verify public originals -> Gradle generated copies -> decompressed APK entry bytes.
// No dependencies, extraction, image conversion, server reads, or source writes.
import { readFileSync, readdirSync, statSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const publicRoot=resolve(root,'public');
const generatedRoot=resolve(root,'android/app/build/generated/genesisAssets/originals');
const mainOriginalsRoot=resolve(root,'android/app/src/main/assets/originals');
const manifestPath=resolve(root,'docs/android/ASSET_MANIFEST.json');
const markdownPath=resolve(root,'docs/android/ASSET_MANIFEST.md');
const args=process.argv.slice(2);
const apkArg=args.indexOf('--apk');
if(apkArg>=0 && (!args[apkArg+1] || args[apkArg+1].startsWith('--'))) throw Error('--apk needs a file path');
const apkPath=resolve(root,apkArg>=0?args[apkArg+1]:'android/app/build/outputs/apk/debug/app-debug.apk');
const noWrite=args.includes('--check');
const requireApk=args.includes('--require-apk');
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const slash=(value)=>value.replaceAll('\\','/');
const localPath=(path)=>slash(relative(root,path));
const check=(condition,message)=>{if(!condition)throw Error(message);};
const gradle=readFileSync(resolve(root,'android/app/build.gradle.kts'),'utf8');
const includeBlock=gradle.match(/from\(rootProject\.file\("\.\.\/public"\)\)\s*\{\s*include\(([\s\S]*?)\)\s*\}/);
check(includeBlock,'Could not locate literal public include() block; inspect changed Gradle packaging');
const includes=Array.from(includeBlock[1].matchAll(/"([^"\r\n]+)"/g),(match)=>match[1]);
check(includes.length>0 && includes.every((p)=>!p.includes('..') && (p.endsWith('/**') || !/[?*]/.test(p))),'Unsupported include pattern; update verifier explicitly');
const included=(path)=>includes.some((pattern)=>pattern.endsWith('/**')?path.startsWith(pattern.slice(0,-2)):path===pattern);

function walk(base,prefix='') {
  const files=[];
  for(const entry of readdirSync(resolve(base,prefix),{withFileTypes:true})) {
    const path=prefix?`${prefix}/${entry.name}`:entry.name;
    check(!entry.isSymbolicLink(),`Symbolic link is not an original regular file: ${path}`);
    if(entry.isDirectory())files.push(...walk(base,path));
    else if(entry.isFile())files.push(path);
  }
  return files.sort();
}

/** Bounded classic ZIP reader. APK signing blocks are naturally outside entry spans.
 * Supports only stored/deflated entries; rejects ZIP64/multidisk/encrypted archives.
 * Never writes entry paths to disk, executes contents, or trusts declared inflate size.
 */
function apkReader(path) {
  const before=statSync(path);
  check(before.size<=512*1024*1024,'APK exceeds 512 MiB verifier bound');
  const zip=readFileSync(path);
  check(zip.length>=22,'Truncated APK');
  let eocd=-1;
  for(let i=zip.length-22;i>=Math.max(0,zip.length-22-65535);i--) {
    if(zip.readUInt32LE(i)===0x06054b50 && i+22+zip.readUInt16LE(i+20)===zip.length){eocd=i;break;}
  }
  check(eocd>=0,'Missing ZIP end-of-central-directory');
  const count=zip.readUInt16LE(eocd+10), centralSize=zip.readUInt32LE(eocd+12), centralStart=zip.readUInt32LE(eocd+16);
  check(zip.readUInt16LE(eocd+4)===0 && zip.readUInt16LE(eocd+6)===0 && zip.readUInt16LE(eocd+8)===count,'Multidisk ZIP unsupported');
  check(count!==0xffff && centralSize!==0xffffffff && centralStart!==0xffffffff,'ZIP64 unsupported');
  check(count<=20000 && centralStart+centralSize<=eocd,'Invalid central directory bounds');
  const entries=new Map();
  let cursor=centralStart;
  for(let index=0;index<count;index++) {
    check(cursor+46<=centralStart+centralSize && zip.readUInt32LE(cursor)===0x02014b50,'Invalid central entry');
    const flags=zip.readUInt16LE(cursor+8), method=zip.readUInt16LE(cursor+10);
    const compressed=zip.readUInt32LE(cursor+20), size=zip.readUInt32LE(cursor+24), nameLength=zip.readUInt16LE(cursor+28);
    const extraLength=zip.readUInt16LE(cursor+30), commentLength=zip.readUInt16LE(cursor+32), offset=zip.readUInt32LE(cursor+42);
    const end=cursor+46+nameLength+extraLength+commentLength;
    check(end<=centralStart+centralSize,'Central entry overflow');
    const name=zip.subarray(cursor+46,cursor+46+nameLength).toString('utf8');
    check(!name.startsWith('/') && !name.includes('\\') && !name.split('/').includes('..') && !name.includes('\0'),'Unsafe ZIP entry name');
    check(!entries.has(name),`Duplicate ZIP entry: ${name}`);
    check((flags&1)===0,'Encrypted ZIP unsupported');
    check(size!==0xffffffff && compressed!==0xffffffff && offset!==0xffffffff,'ZIP64 entry unsupported');
    entries.set(name,{flags,method,compressed,size,offset}); cursor=end;
  }
  check(cursor===centralStart+centralSize,'Unexpected central directory tail');
  const after=statSync(path);
  check(after.size===before.size && after.mtimeMs===before.mtimeMs,'APK changed while reading; rerun after build finishes');
  let inflatedTotal=0;
  return {
    path:localPath(path),size:zip.length,sha256:sha(zip),entryNames:[...entries.keys()],
    read(name,expectedSize) {
      const entry=entries.get(name);
      if(!entry)return null;
      const {flags,method,compressed,size,offset}=entry;
      check(size===expectedSize,`Size mismatch for ${name}: expected ${expectedSize}, APK ${size}`);
      check(size<=64*1024*1024 && inflatedTotal+size<=512*1024*1024,'Entry/total inflation exceeds safe bound');
      check(offset+30<=centralStart && zip.readUInt32LE(offset)===0x04034b50,'Invalid local entry');
      check(zip.readUInt16LE(offset+6)===flags && zip.readUInt16LE(offset+8)===method,'Local/central header mismatch');
      const nameLength=zip.readUInt16LE(offset+26), extraLength=zip.readUInt16LE(offset+28);
      const start=offset+30+nameLength+extraLength;
      check(start+compressed<=centralStart,'Compressed entry overflow');
      check(zip.subarray(offset+30,offset+30+nameLength).toString('utf8')===name,'Local entry name mismatch');
      check(method===0 || method===8,`Unsupported ZIP compression method ${method}`);
      const compressedBytes=zip.subarray(start,start+compressed);
      const bytes=method===0?compressedBytes:inflateRawSync(compressedBytes,{maxOutputLength:Math.max(1,expectedSize+1)});
      check(bytes.length===size,'Inflated size mismatch');
      inflatedTotal+=size;
      return {bytes,method:method===0?'stored':'deflate',compressedSize:compressed};
    },
  };
}

// Slot descriptions are manually traced to current web/native source, not a visual QA claim.
const slots={
  icons:['app identity/icon family','Header renders icon-192.png only; other web icon variants are not UI-parity verified','PARTIAL_IN_CODE'],
  'weekday-art':['Gregorian selected-day header','DayHeader references all seven original weekday files','IN_CODE_NOT_VISUALLY_VERIFIED'],
  'day-art-v1':['Sacred selected-day artwork, month/day paths','DayHeader computes original month/day path; crop/layout in both themes still unverified','IN_CODE_NOT_VISUALLY_VERIFIED'],
  'month-art-v4':['Sacred month/year illustrations','All 13 original month images have native sacred month and lazy year slots; current month and Apeiron observed on one phone, full 13-month visual matrix pending','IN_CODE_NOT_VISUALLY_VERIFIED'],
  'theokyklos-art':['14 Theokyklos deity/sector illustrations','Native sector dialog renders original artwork; four critical detail states checked on one phone, full visual matrix pending','IN_CODE_NOT_VISUALLY_VERIFIED'],
  'theokyklos-symbols':['Theokyklos symbol overlays','Native mandala renders all 14 original sigils including zenith, nadir, entry and exit; one-phone theme screenshots captured','IN_CODE_NOT_VISUALLY_VERIFIED'],
  'stoicheion-cards':['Stoicheion card faces and frames','All 24 original card faces and letter details have native slots; local daily and nine-card gesture readings work with a three-minute reroll timer, but account synchronization is pending','PARTIAL_IN_CODE'],
  'achievement-art':['Achievement medallion artwork','All 18 original webp medallions render in the Experimental gallery with locally persisted unlocks; complete web award rules and account synchronization are pending','PARTIAL_IN_CODE'],
  'habit-ranks':['Heroic rank background','Original rank panorama remains in the native habit progress card; Experimental also has the individual rank tree, checkpoint actions and detail artwork','PARTIAL_IN_CODE'],
  'habit-reward-art':['Hestia spark/comeback reward illustrations','Both original images render in Experimental Habits; local Spark purchase/automatic use and three-day Comeback awards work, but cloud synchronization is pending','PARTIAL_IN_CODE'],
  'hero-path':['Hero path 256/512 artwork','Original 256px rank and amphora artwork renders in the Experimental tree; 512px rank detail and local checkpoint claims are implemented, but web/account parity is pending','PARTIAL_IN_CODE'],
  'calendar-art':['Gregorian Saturn/Cronus description artwork','Original annual description slot not ported','NOT_PORTED'],
  'genesis-hero.png':['Original GENESIS hero background','Hero composition and theme variants not ported','NOT_PORTED'],
  'month-frieze-v2.png':['Legacy combined month frieze','Preserved in APK but intentionally not rendered in Projects; sacred calendar uses individual original month-art-v4 images','PRESERVED_NOT_RENDERED'],
};
const files=walk(publicRoot);
// Existing main-source-set artwork is packaged alongside the generated public copies.
const mainFiles=existsSync(mainOriginalsRoot)?walk(mainOriginalsRoot):[];
const mainOriginals=mainFiles.filter((path)=>files.includes(path));
const nativeOnlyOriginals=mainFiles.filter((path)=>!files.includes(path));
check(nativeOnlyOriginals.every(path=>/\.(png|jpe?g|webp|svg|gif|avif|woff2?|ttf|otf)$/i.test(path)),'Unexpected non-media file in native-only originals');
const originals=[...new Set([...files.filter(included),...mainOriginals])].sort();
check(originals.length>0,'No selected original files');
for(const pattern of includes)check(originals.some((p)=>pattern.endsWith('/**')?p.startsWith(pattern.slice(0,-2)):p===pattern),`Empty source include: ${pattern}`);
const apk=existsSync(apkPath)?apkReader(apkPath):null;
const sourceSet=new Set(originals);
nativeOnlyOriginals.forEach(path=>sourceSet.add(path));
// These reviewed text catalogs are declared separately from public images in Gradle.
// Verify their bytes as well, while still rejecting any undeclared extra APK entry.
const catalogByAsset=new Map();
for(const match of gradle.matchAll(/from\(rootProject\.file\("\.\.\/(app(?:\/[^"\r\n]+)?)"\)\)\s*\{([^}]+)\}/g)) {
  const source=match[1],block=match[2],destination=block.match(/\binto\("((?:i18n|catalogs)(?:\/[^"\r\n]+)?)"\)/)?.[1];
  if(!destination)continue;
  check(!source.includes('..')&&!destination.includes('..'),'Catalog paths must stay within app and declared catalog directories');
  const path=resolve(root,source),names=[];
  if(statSync(path).isFile()) {
    check(source.endsWith('.json'),'Declared catalog must be JSON');names.push({source,name:source.split('/').at(-1)});
  } else {
    const includes=block.match(/\binclude\(([\s\S]*?)\)/);
    check(includes,'Grouped catalog source needs literal include patterns');
    const patterns=Array.from(includes[1].matchAll(/"([^"\r\n]+)"/g),item=>item[1]);
    check(patterns.length>0&&patterns.every(p=>p.endsWith('.json')&&!p.includes('..')&&!p.includes('/')&&!p.includes('?')),'Unsupported catalog include pattern');
    const filenames=readdirSync(path,{withFileTypes:true}).filter(item=>item.isFile()).map(item=>item.name);
    for(const pattern of patterns) {
      const expression=new RegExp('^'+pattern.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$');
      const selected=filenames.filter(name=>expression.test(name));check(selected.length>0,`Empty catalog pattern: ${source}/${pattern}`);
      for(const name of selected)names.push({source:`${source}/${name}`,name});
    }
  }
  for(const item of names) {
    const asset=`${destination}/${item.name}`,previous=catalogByAsset.get(asset);
    check(!previous||previous.source===item.source,`Catalog destination collision: ${asset}`);
    catalogByAsset.set(asset,{source:item.source,asset});
  }
}
const catalogs=[...catalogByAsset.values()].sort((a,b)=>a.asset.localeCompare(b.asset));
const catalogPaths=new Set(catalogs.map((entry)=>entry.asset));
const generatedFiles=existsSync(generatedRoot)?walk(generatedRoot):[];
const extraGenerated=generatedFiles.filter((p)=>!sourceSet.has(p) && !catalogPaths.has(p));
const extraApk=apk?apk.entryNames.filter((p)=>p.startsWith('assets/originals/') && !p.endsWith('/') &&
  !sourceSet.has(p.slice('assets/originals/'.length)) && !catalogPaths.has(p.slice('assets/originals/'.length))):[];
const failures=[];
const catalogVerification=catalogs.map(({source,asset})=>{
  const bytes=readFileSync(resolve(root,source)), hash=sha(bytes);
  const generated=resolve(generatedRoot,asset);
  const generatedPass=existsSync(generated) && sha(readFileSync(generated))===hash;
  let apkPass=null;
  try { if(apk) apkPass=sha(apk.read(`assets/originals/${asset}`,bytes.length).bytes)===hash; }
  catch { apkPass=false; }
  if(!generatedPass || apkPass===false) failures.push(`Declared text catalog missing/mismatch: ${asset}`);
  return {source,asset,sha256:hash,generatedPass,apkPass};
});
const nativeOnlyVerification=nativeOnlyOriginals.map(path=>{
  const source=resolve(mainOriginalsRoot,path),bytes=readFileSync(source),hash=sha(bytes);
  let apkHash=null;
  try{if(apk)apkHash=sha(apk.read(`assets/originals/${path}`,bytes.length).bytes);}catch{apkHash='INVALID';}
  const apkPass=apk?apkHash===hash:null;
  if(apkPass===false)failures.push(`Native-only original missing/mismatch: ${path}`);
  return {source:localPath(source),asset:`originals/${path}`,sha256:hash,apkSha256:apkHash,apkPass};
});
const entries=originals.map((path)=>{
  const bytes=readFileSync(resolve(publicRoot,path));
  const hash=sha(bytes), family=path.includes('/')?path.split('/')[0]:path;
  const generatedPath=resolve(generatedRoot,path);
  const generated=existsSync(generatedPath)?generatedPath:resolve(mainOriginalsRoot,path);
  const copyHash=existsSync(generated)?sha(readFileSync(generated)):null;
  const copied=copyHash===hash;
  const apkEntry=`assets/originals/${path}`;
  let packaged=null,apkError=null;
  try{packaged=apk?.read(apkEntry,bytes.length)??null;}catch(error){apkError=error.message;}
  const apkHash=packaged?sha(packaged.bytes):null;
  const apkStatus=apk?(apkHash===hash?'PASS':'FAIL'):'PENDING_NO_APK';
  if(!copied)failures.push(`Generated copy missing/mismatch: ${path}`);
  if(apk && apkStatus==='FAIL')failures.push(apkError??`APK entry missing/mismatch: ${path}`);
  const [webSlot,nativeSlot,uiStatus]=slots[family]??['Unmapped source family','Needs manual source/UI audit','NOT_REVIEWED'];
  return {source:`public/${path}`,asset:`originals/${path}`,apkEntry,family,bytes:bytes.length,sha256:hash,
    generated:{status:copied?'PASS':'FAIL',sha256:copyHash,path:localPath(generated),kind:generated===generatedPath?'generated':'main-source-set'},apk:{status:apkStatus,sha256:apkHash,compression:packaged?.method??null,compressedBytes:packaged?.compressedSize??null,error:apkError},
    webSlot,nativeSlot,uiStatus,visualParity:'NOT_RUN'};
});
if(extraGenerated.length)failures.push(`Unexpected generated originals: ${extraGenerated.length}`);
if(extraApk.length)failures.push(`Unexpected APK originals: ${extraApk.length}`);
if(requireApk&&!apk)failures.push('APK required but missing');
const media=/\.(png|jpe?g|webp|svg|gif|avif|woff2?|ttf|otf)$/i;
const omitted=files.filter((path)=>media.test(path)&&!sourceSet.has(path)).map((path)=>({source:`public/${path}`,bytes:statSync(resolve(publicRoot,path)).size,
  reason:'Not selected by current Gradle includes; relevance/legacy replacement must be assessed before release'}));
const families=[...new Set(entries.map((e)=>e.family))].sort().map((family)=>{
  const list=entries.filter((e)=>e.family===family);
  return {family,count:list.length,bytes:list.reduce((sum,e)=>sum+e.bytes,0),generatedPass:list.filter((e)=>e.generated.status==='PASS').length,
    apkPass:list.filter((e)=>e.apk.status==='PASS').length,webSlot:list[0].webSlot,nativeSlot:list[0].nativeSlot,uiStatus:list[0].uiStatus};
});
const report={schemaVersion:1,generatedAt:new Date().toISOString(),command:'node android/tools/verify-assets.mjs --require-apk',
  sourceRoot:'public',gradle:'android/app/build.gradle.kts',gradleSha256:sha(Buffer.from(gradle)),includes,
  generatedRoot:localPath(generatedRoot),apk:apk?{path:apk.path,size:apk.size,sha256:apk.sha256}:null,
  summary:{files:entries.length,originalBytes:entries.reduce((sum,e)=>sum+e.bytes,0),generatedPassed:entries.filter((e)=>e.generated.status==='PASS').length,
    apkPassed:entries.filter((e)=>e.apk.status==='PASS').length,nativeOnlyOriginals:nativeOnlyVerification.length,catalogs:catalogVerification.length,byteParity:failures.length?'FAIL':apk?'PASS':'PENDING_APK',visualParity:'NOT_RUN',omittedPublicMedia:omitted.length},
  families,entries,catalogVerification,nativeOnlyVerification,extraGenerated,extraApk,omitted,failures,
  limitations:['Byte parity is not proof of UI placement, visual parity, image decoding, licensing, or APK signature validity.',
    'Public originals selected by actual Gradle includes or existing main source-set paths are hashed. Grouped and individual declared i18n catalogs are checked separately. No server/private data is read.',
    'Native OriginalImage currently uses BitmapFactory: copied SVG frames are not a working SVG renderer.',
    'No bundled public TTF/OTF/WOFF font is asserted ready; native font licensing/conversion and typography remain pending.',
    'Slot mapping is manually reviewed source evidence; mobile/tablet/font-scale and Standart/Experimental visual matrix is NOT_RUN.']};
const markdown=`# Android original asset manifest\n\nGenerated: ${report.generatedAt}. Byte parity: **${report.summary.byteParity}**. Visual parity: **NOT_RUN**.\n\n${entries.length} public originals, ${report.summary.originalBytes} original bytes. Generated copies match: ${report.summary.generatedPassed}/${entries.length}. APK decompressed entries match: ${report.summary.apkPassed}/${entries.length}.\n\n${apk?`APK: \`${apk.path}\` (${apk.size} bytes), SHA-256 \`${apk.sha256}\`.`:'APK unavailable; ZIP comparison pending.'}\n\n## Reproduce\n\n\`node android/tools/verify-assets.mjs --require-apk\` regenerates this report and ASSET_MANIFEST.json; append \`--apk relative/path.apk\` to select an artifact. \`--check\` performs checks without rewriting either report. A nonzero exit means missing/mismatched data or invalid ZIP. Run after the integrated build finishes.\n\nThe verifier reads the actual literal public include block in Gradle. It uses SHA-256 on original, generated copy and decompressed APK entry bytes. ZIP reader uses only Node built-ins, validates central/local headers and bounds, caps the archive at 512 MiB and each decoded original at 64 MiB, supports stored/deflated entries, rejects encrypted/ZIP64/multidisk archives, and never extracts files or converts images.\n\n## Packaged families and UI slots\n\n| Family | Files | Original bytes | Generated | APK | UI status | Native slot/remaining work |\n|---|---:|---:|---:|---:|---|---|\n${families.map((f)=>`| originals/${f.family} | ${f.count} | ${f.bytes} | ${f.generatedPass}/${f.count} | ${f.apkPass}/${f.count} | ${f.uiStatus} | ${f.nativeSlot} |`).join('\n')}\n\nPer-file source → asset → ZIP mapping, lengths, all three hashes, compression and slot annotations are in [ASSET_MANIFEST.json](ASSET_MANIFEST.json).\n\n## Omitted public media\n\n${omitted.length} public media files are not selected by current Gradle includes. They are listed explicitly in the JSON \`omitted\` section; omission alone does not prove they are still used by current web UI (older month-art versions can be legacy). Assess relevance before release; this report does not silently add, remove or replace them.\n\n## SVG, fonts and visual limitations\n\n${report.limitations.map((line)=>`- ${line}`).join('\n')}\n\nThe native source reviewed includes \`ui/GenesisApp.kt\`, \`ui/HeroRankTree.kt\`, \`ui/HabitArtGallery.kt\` and \`ui/StoicheionDrawUi.kt\`. Relevant web source families: \`GenesisCalendar.tsx\`, \`theokyklos-assets.ts\`, \`StoicheionView.tsx\`, \`achievements.ts\`, \`HabitTracker.tsx\`, \`hero-path-assets.ts\` and \`globals.css\`. A packaged image does not count as a ported screen; full visual and behavioral parity remains unverified.\n\nNo Gradle edit, build, source image rewrite, bulk source copy, secret read, SSH or server operation is performed by this verifier.\n\n## Failures\n\n${failures.length?failures.map((f)=>`- ${f}`).join('\n'):'None in the measured byte-comparison scope.'}\n`;
if(!noWrite){mkdirSync(dirname(manifestPath),{recursive:true});writeFileSync(manifestPath,`${JSON.stringify(report,null,2)}\n`);writeFileSync(markdownPath,markdown);}
console.log(JSON.stringify({summary:report.summary,apk:report.apk,families:families.map(({family,count,generatedPass,apkPass})=>({family,count,generatedPass,apkPass})),failures},null,2));
if(failures.length)process.exitCode=1;
