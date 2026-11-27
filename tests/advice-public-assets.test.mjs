import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {collectAdvicePublicAssets,verifyAdvicePublicPins,advicePublicLanguages} from '../scripts/advice-public-assets.mjs';

test('all actual public historical advice editions retain exact source bytes in eighteen languages without any account fields',()=>{
 const {assets,manifest}=collectAdvicePublicAssets(resolve('.'));
 assert.equal(manifest.protocol,1);assert.equal(manifest.catalogues.length,9*18);
 assert.equal(new Set(manifest.catalogues.map(row=>row.path)).size,manifest.catalogues.length);
 const legacy=JSON.parse(readFileSync('contracts/public-advice-editions-v1.json','utf8'));
 assert.equal(legacy.catalogues.length,9*14);
 assert.deepEqual(JSON.parse(assets.find(item=>item.fileName==='advice-catalogues/v1/manifest.json').source),legacy);
 assert.deepEqual(JSON.parse(assets.find(item=>item.fileName==='advice-catalogues/v2/manifest.json').source),manifest);
 assert.deepEqual(manifest.catalogues.filter(row=>!['he','ar','ko','nl'].includes(row.language)),legacy.catalogues);
 for(const row of manifest.catalogues){
  const directory=row.kind==='daily'?'daily-advice':'philosopher-aphorisms-locales';
  const original=readFileSync(`server/content/${directory}/${row.version}/${row.language}.json`);
  const asset=assets.find(asset=>asset.fileName===row.path);assert.deepEqual(asset.source,original);
  assert.equal(row.bytes,original.length);assert.equal(row.sha256,createHash('sha256').update(original).digest('hex'));
  assert.equal(row.path,`advice-catalogues/v1/${row.kind}/${row.version}/${row.language}.${row.sha256}.json`);
 }
 for(const kind of ['daily','philosophers'])for(const version of new Set(manifest.catalogues.filter(row=>row.kind===kind).map(row=>row.version))){
  assert.deepEqual(manifest.catalogues.filter(row=>row.kind===kind&&row.version===version).map(row=>row.language),advicePublicLanguages);
 }
 const version1=manifest.catalogues.find(row=>row.version==='psychopompia-2026-11-v1'&&row.language==='en');
 const version2=manifest.catalogues.find(row=>row.version==='psychopompia-2026-11-v2'&&row.language==='en');
 assert.notEqual(version1.path,version2.path);assert.ok(version1&&version2);
 const pins=structuredClone(manifest);pins.catalogues[0].sha256='0'.repeat(64);
 assert.throws(()=>verifyAdvicePublicPins(manifest,pins),/EDITION_CHANGED_USE_A_NEW_VERSION/);
 pins.catalogues=manifest.catalogues.slice(1);assert.throws(()=>verifyAdvicePublicPins(manifest,pins),/EDITION_CHANGED_USE_A_NEW_VERSION/);
});

test('a missing historical language or accidental non-editorial property blocks public export',()=>{
 const root=mkdtempSync(join(tmpdir(),'genesis-advice-public-'));
 try{
  for(const directory of ['daily-advice','philosopher-aphorisms-locales'])mkdirSync(join(root,'server/content',directory),{recursive:true});
  const version=join(root,'server/content/daily-advice/test-v1');mkdirSync(version);
  const body=JSON.stringify({'advice-0123456789abcdef01234567':{title:'Synthetic title',body:'Synthetic public body'}});
  for(const lang of advicePublicLanguages.slice(1))writeFileSync(join(version,lang+'.json'),body);
  assert.throws(()=>collectAdvicePublicAssets(root),/LANGUAGE_MISSING/);
  writeFileSync(join(version,'ru.json'),body.replace('"body":"Synthetic public body"','"body":"Synthetic public body","ownerId":"synthetic-private"'));
  assert.throws(()=>collectAdvicePublicAssets(root),/CONTENT_INVALID/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
