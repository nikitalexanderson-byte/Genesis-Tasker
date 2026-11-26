import assert from 'node:assert/strict';
import {test} from 'node:test';
import {RelationalPrivatePathSource,privateTableObjectId} from '../app/e2ee/relational-path-source.ts';
import {privatePathSource} from '../app/e2ee/private-path-source.ts';
import {requiredPrivatePaths} from '../app/e2ee/private-paths.ts';
import {readPrivateTable} from '../app/e2ee/private-table-reader.ts';
import {E2eeMigrationSources} from '../app/e2ee/migration-sources.ts';
import {generateDeviceKeys,freshSecret} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot,sealE2eeEnvelope,openE2eeEnvelope} from '../app/e2ee/envelope.ts';

const encoder=new TextEncoder(),decode=value=>JSON.parse(new TextDecoder().decode(value));
const paths=['personal','project','space'].flatMap(kind=>requiredPrivatePaths(kind).filter(path=>kind!=='personal'||path.id==='personal.local-work'));

async function fixture(path){
 const kind=path.scope,resourceId=kind+'-resource',target={ownerId:'source-owner',scopeId:kind+':source-owner',kind,resourceId,pathId:path.id};
 const schema=privatePathSource(kind,path.id),tables={},expected=new Map();let captured=false,reads=0,live=true;
 const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const context={ownerId:target.ownerId,scopeId:target.scopeId,migrationId:'source-attempt',fence:1,sourceHash:'A'.repeat(43),generation:2};
 for(const table of schema.tables){
  const original=Object.fromEntries(table.columns.map(name=>[name,name.endsWith('_json')||['payload','content'].includes(name)?'{}':'retained:'+name]));
  const content=structuredClone(original);content.id='row-'+table.table;
  if(['shared_mindmaps','shared_mindmap_versions'].includes(table.table)){
   content.project_id=kind==='project'?resourceId:null;content.content=JSON.stringify({projectId:content.project_id,title:'Private map source'});
  }
  if(path.id==='project.files'){
   const bytes=encoder.encode('EXACT PRIVATE FILE '+table.table);
   delete content.ciphertext;delete content.filename_ciphertext;
   content.file={encoding:'base64url',bytes:encodeE2eeBytes(bytes),length:bytes.length,
    sha256:encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))),filename:'Private source.txt',mediaType:'text/plain'};
  }
  tables[table.table]=[{original,content,execution:'history-only'}];expected.set(table.table,structuredClone(content));
 }
 const remote={protocol:1,ownerId:target.ownerId,scopeId:target.scopeId,kind,resourceId,pathId:path.id,tables};
 const local={platform:'web',inventoryVersion:1,entries:[{store:'localStorage',key:'closed-editor',raw:'ORIGINAL OPAQUE CIPHERTEXT',content:{text:'Retained closed draft'},
  spaceId:kind==='space'?resourceId:null,projectId:kind==='project'?resourceId:null}],editors:[{text:'Mounted private draft'}]};
 const source=new RelationalPrivatePathSource(target,{assertCurrent:current,capture:async()=>{current();captured=true;return structuredClone(local);},
  read:async actual=>{assert(captured);assert.deepEqual(actual,context);reads++;return structuredClone(remote);}});
 return{source,remote,local,target,context,expected,get reads(){return reads;},retire(){live=false;}};
}

for(const path of paths)test(path.id+': real source preserves every table and retained editor through a new-key readback',async()=>{
 const f=await fixture(path),before=structuredClone(f.remote),local=await f.source.captureLocal();assert.equal(f.reads,0);
 const prior=decode(local);prior.local.editors=[{text:'Prior unmounted draft'}];const result=await f.source.reconcile(local,[encoder.encode(JSON.stringify(prior))],f.context);
 assert(result.complete);assert.deepEqual(f.remote,before);assert.equal(f.reads,1);
 const raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);const keys=await generateDeviceKeys(),sealed=new Map();
 for(const row of result.content){
  const context={cryptoProtocol:1,suite:E2EE_SUITE,ownerId:f.target.ownerId,scopeId:f.target.scopeId,domain:row.domain,objectId:row.objectId,
   schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'fresh-source-root',deviceId:'current-device',operationId:crypto.randomUUID()};
  const packet=await sealE2eeEnvelope(root,keys.signing.privateKey,context,row.bytes);assert(!JSON.stringify(packet).includes('Retained closed draft'));sealed.set(row.objectId,packet);
 }
 for(const [table,expected]of f.expected){
  const objectId=privateTableObjectId(path.id,table);
  const rows=await readPrivateTable(async id=>{const packet=sealed.get(id);assert(packet);return{bytes:await openE2eeEnvelope(root,keys.signing.publicKey,packet.context,packet),revision:1};},objectId,path.id,table,()=>{},1);
  if(path.id==='project.files'){
   const file=result.content.find(row=>row.objectId===rows[0].file.objectId);assert(file);assert.equal(new TextDecoder().decode(file.bytes),'EXACT PRIVATE FILE '+table);
   assert.equal(rows[0].file.filename,expected.file.filename);assert.equal(rows[0].file.size,expected.file.length);
  }else assert.deepEqual(rows,[expected]);
 }
 const histories=result.localContent.map(row=>decode(row.bytes)).filter(row=>row.format==='genesis-private-local-work-v1');
 assert.equal(histories.length,2);assert(histories.some(row=>row.editors[0].text==='Prior unmounted draft'));assert(histories.every(row=>row.execution==='history-only'));
 assert(!JSON.stringify(histories).includes('ORIGINAL OPAQUE CIPHERTEXT'));assert.equal(decode(local).local.entries[0].raw,'ORIGINAL OPAQUE CIPHERTEXT');
});

for(const path of paths)test(path.id+': missing tables, changed ownership and retirement retain exact original snapshots',async()=>{
 const f=await fixture(path),capture=await f.source.captureLocal(),exact=new Uint8Array(capture);
 f.remote.ownerId='foreign';await assert.rejects(f.source.reconcile(capture,[],f.context),/E2EE_SCOPE_BINDING_MISMATCH/);f.remote.ownerId=f.target.ownerId;
 const table=Object.keys(f.remote.tables)[0];if(table){delete f.remote.tables[table];await assert.rejects(f.source.reconcile(capture,[],f.context),/E2EE_/);}
 f.retire();await assert.rejects(f.source.reconcile(capture,[],f.context),/E2EE_ACCOUNT_CHANGED/);assert.deepEqual(capture,exact);
});

test('shared complete registries use the actual relational adapters for every declared path',async()=>{
 for(const kind of ['project','space']){
  const registry=new E2eeMigrationSources('source-owner',kind+':source-owner',kind);
  const cases=await Promise.all(requiredPrivatePaths(kind).map(fixture));cases.forEach(f=>registry.register(f.source));
  const snapshot=await registry.captureLocal(),result=await registry.reconcile(snapshot,[],cases[0].context);
  assert.deepEqual(result.coverage.map(row=>row.domain).sort(),requiredPrivatePaths(kind).map(path=>path.id).sort());assert(result.coverage.every(row=>row.complete));
  assert(cases.every(f=>f.reads===1));assert(result.localContent.length>=cases.length);
 }
});
