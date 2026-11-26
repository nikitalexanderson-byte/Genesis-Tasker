import assert from 'node:assert/strict';
import test from 'node:test';
import {resolve} from 'node:path';
import {collectAdvicePublicAssets,advicePublicLanguages} from '../scripts/advice-public-assets.mjs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {PublicAdviceCatalogues,publicAdviceCatalogueReader}=calendarModule('app/e2ee/advice-catalogue.ts');
const exported=collectAdvicePublicAssets(resolve('.'));
const assets=new Map(exported.assets.map(row=>[row.fileName,typeof row.source==='string'?new TextEncoder().encode(row.source):new Uint8Array(row.source)]));
function rig(){
 let live=true;const calls=[],data=new Map(assets);
 const check=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const client=new PublicAdviceCatalogues(async(path)=>{calls.push(path);assert.ok(data.has(path),'Only emitted public assets may be requested');return new Uint8Array(data.get(path));},check);
 return{client,data,calls,check,lock(){live=false;},manifest(change){const copy=structuredClone(exported.manifest);change(copy);data.set('advice-catalogues/v1/manifest.json',new TextEncoder().encode(JSON.stringify(copy)));}};
}

test('each actual historical edition resolves exact translations in every language without sending the selected identity',async()=>{
 const f=rig();
 for(const row of exported.manifest.catalogues){
  const texts=JSON.parse(new TextDecoder().decode(assets.get(row.path))),id=Object.keys(texts)[0];
  const result=await f.client.resolve(row.kind,row.version,row.language,id);assert.deepEqual(result,texts[id]);
  result.body='Changed caller copy';assert.deepEqual(await f.client.resolve(row.kind,row.version,row.language,id),texts[id]);
 }
 assert.equal(f.calls.length,127);assert.ok(f.calls.every(path=>!/advice-[a-f0-9]{24}/.test(path)&&!path.includes('?')));
 assert.equal(new Set(exported.manifest.catalogues.map(row=>row.language)).size,advicePublicLanguages.length);
});

test('a modified public edition or manifest never becomes an empty or current-edition fallback',async()=>{
 const row=exported.manifest.catalogues[0],texts=JSON.parse(new TextDecoder().decode(assets.get(row.path))),id=Object.keys(texts)[0];
 const corrupt=rig(),changed=new Uint8Array(corrupt.data.get(row.path));changed[changed.length-2]^=1;corrupt.data.set(row.path,changed);
 await assert.rejects(corrupt.client.resolve(row.kind,row.version,row.language,id),/CATALOGUE_INTEGRITY/);
 const shorter=rig();shorter.data.set(row.path,changed.slice(1));await assert.rejects(shorter.client.resolve(row.kind,row.version,row.language,id),/CATALOGUE_INVALID/);
 const missing=rig();await assert.rejects(missing.client.resolve(row.kind,'missing-historical-v1',row.language,id),/CATALOGUE_UNAVAILABLE/);assert.equal(missing.calls.length,1);
 await assert.rejects(rig().client.resolve(row.kind,row.version,row.language,'advice-ffffffffffffffffffffffff'),/TRANSLATION_MISSING/);
 for(const mutate of [m=>m.catalogues.pop(),m=>m.catalogues.push(m.catalogues[0]),m=>m.catalogues[0].path='https://foreign.invalid/private',m=>m.catalogues[0].ownerId='synthetic-private']){
  const bad=rig();bad.manifest(mutate);await assert.rejects(bad.client.resolve(row.kind,row.version,row.language,id),/E2EE_/);assert.equal(bad.calls.length,1);
 }
});

test('concurrent requests for one edition share the download and account closure invalidates cached public text',async()=>{
 const f=rig(),row=exported.manifest.catalogues[0],id=Object.keys(JSON.parse(new TextDecoder().decode(assets.get(row.path))))[0];
 const results=await Promise.all(Array.from({length:8},()=>f.client.resolve(row.kind,row.version,row.language,id)));
 assert.equal(results.length,8);assert.equal(f.calls.length,2);f.lock();await assert.rejects(f.client.resolve(row.kind,row.version,row.language,id),/ACCOUNT_CHANGED/);assert.equal(f.calls.length,2);
 let active=true;const client=new PublicAdviceCatalogues(async path=>{active=false;return assets.get(path);},()=>{if(!active)throw new Error('E2EE_ACCOUNT_CHANGED');});
 await assert.rejects(client.resolve(row.kind,row.version,row.language,id),/ACCOUNT_CHANGED/);
});

test('the actual public HTTP reader omits account credentials/referrer and permits only same-origin catalogue paths',async()=>{
 const calls=[];let open=true;const reader=publicAdviceCatalogueReader(new URL('https://example.invalid/app/'),()=>{if(!open)throw new Error('E2EE_ACCOUNT_CHANGED');},async(url,options)=>{
  calls.push({url:String(url),options});return new Response('{}',{headers:{'Content-Type':'application/json; charset=utf-8'}});
 });
 assert.equal(new TextDecoder().decode(await reader('advice-catalogues/v1/manifest.json')),'{}');
 assert.equal(calls[0].url,'https://example.invalid/app/advice-catalogues/v1/manifest.json');
 assert.deepEqual(calls[0].options,{credentials:'omit',referrerPolicy:'no-referrer',redirect:'error',cache:'no-cache'});
 for(const path of ['https://foreign.invalid/advice-catalogues/v1/manifest.json','../advice-catalogues/v1/manifest.json','advice-catalogues/v1/manifest.json?owner=private'])await assert.rejects(reader(path),/CATALOGUE_INVALID/);
 assert.equal(calls.length,1);open=false;await assert.rejects(reader('advice-catalogues/v1/manifest.json'),/ACCOUNT_CHANGED/);
 assert.throws(()=>publicAdviceCatalogueReader(new URL('http://example.invalid/'),()=>{}),/CATALOGUE_INVALID/);
});

test('HTTP missing editions, HTML/redirect responses, declared or streamed oversize and late owner changes fail before use',async()=>{
 const path='advice-catalogues/v1/manifest.json';
 for(const response of [new Response('{}',{status:404}),new Response('<html>',{headers:{'content-type':'text/html'}}),new Response('{}',{status:302}),new Response('{}',{headers:{'content-type':'application/json','content-length':String(1024*1024+1)}})]){
  const reader=publicAdviceCatalogueReader(new URL('https://example.invalid/'),()=>{},async()=>response);await assert.rejects(reader(path),/CATALOGUE_/);
 }
 let cancelled=false;const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled=true;}});
 const reader=publicAdviceCatalogueReader(new URL('https://example.invalid/'),()=>{},async()=>new Response(stream,{headers:{'content-type':'application/json'}}));
 await assert.rejects(reader(path),/CATALOGUE_INVALID/);assert.equal(cancelled,true);
 let live=true;const changed=publicAdviceCatalogueReader(new URL('https://example.invalid/'),()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},async()=>{live=false;return new Response('{}',{headers:{'content-type':'application/json'}});});
 await assert.rejects(changed(path),/ACCOUNT_CHANGED/);
});
