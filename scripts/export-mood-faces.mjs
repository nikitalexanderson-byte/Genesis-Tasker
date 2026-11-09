import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const catalog=JSON.parse(readFileSync(resolve(root,'app/mood-faces.json'),'utf8'));
const check=process.argv.includes('--check');
assert.equal(catalog.viewport,64);
assert.deepEqual(catalog.faces.map(face=>face.value),Array.from({length:12},(_,i)=>i-5));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
function output(path,text){
  const full=resolve(root,path);
  if(check)assert.equal(readFileSync(full,'utf8'),text,`Generated mood face drift: ${path}`);
  else {mkdirSync(dirname(full),{recursive:true});writeFileSync(full,text);}
}
for(const face of catalog.faces){
  const layers=[{d:catalog.face,fill:face.fill,stroke:catalog.outline,width:1.6},...face.paths];
  for(const layer of layers){
    assert.match(layer.d,/^[Mm]/u);
    for(const color of [layer.fill,layer.stroke].filter(Boolean))assert.match(color,/^#[\da-f]{6}$/iu);
  }
  output(`public/tracker-art/moods/mood-${face.value+5}.svg`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">\n`+
    layers.map(layer=>`  <path d="${escape(layer.d)}" fill="${layer.fill??'none'}" stroke="${layer.stroke??catalog.outline}" stroke-width="${layer.width??3}" stroke-linecap="round" stroke-linejoin="round"/>`).join('\n')+'\n</svg>\n');
  output(`android/app/src/main/res/drawable/genesis_mood_${face.value+5}.xml`,
    `<!-- Generated from app/mood-faces.json; node scripts/export-mood-faces.mjs -->\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="64dp" android:height="64dp" android:viewportWidth="64" android:viewportHeight="64">\n`+
    layers.map(layer=>`  <path android:pathData="${escape(layer.d)}" android:fillColor="${layer.fill??'#00000000'}" android:strokeColor="${layer.stroke??catalog.outline}" android:strokeWidth="${layer.width??3}" android:strokeLineCap="round" android:strokeLineJoin="round"/>`).join('\n')+'\n</vector>\n');
}
console.log(`Mood faces: ${catalog.faces.length} shared SVG/Android vectors ${check?'verified':'exported'}.`);
