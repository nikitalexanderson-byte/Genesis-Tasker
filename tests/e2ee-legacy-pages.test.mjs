import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {collectLegacyPersonalPages}=calendarModule('app/e2ee/legacy-pages.ts');
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const key=Buffer.alloc(32,29).toString('base64');
function fixture(source='mindmaps'){
 const tables=source==='mindmaps'?['maps','versions','receipts','deletions']:['owners','records','usedIds','receipts'];
 const rows=Object.fromEntries(tables.map(table=>[table,Array.from({length:3},(_,i)=>({id:table+'-'+i,raw:'{ "unprojected": true }'}))]));
 const calls=[];let live=true;
 const ports={assertCurrent(){if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},async readPage(value,table,offset){
  assert.deepEqual(value,context);calls.push({table,offset});const page=rows[table].slice(offset,offset+2);
  return{protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:'migration',fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
   table,offset,totals:Object.fromEntries(tables.map(name=>[name,rows[name].length])),rows:structuredClone(page),nextOffset:offset+page.length<rows[table].length?offset+page.length:null,
   legacyKey:page.length&&(table==='maps'||table==='versions'||table==='owners')?{keyMode:'account',key}:{keyMode:'empty',key:null}};
 }};
 return{tables,rows,calls,ports,lock(){live=false;},run(options={}){return collectLegacyPersonalPages(context,source,ports,options);}};
}
for(const source of ['mindmaps','physis'])test(`${source}: all exact tables and opaque JSON survive consecutive fenced pages`,async()=>{
 const f=fixture(source),result=await f.run();for(const table of f.tables){assert.deepEqual(result[table],f.rows[table]);assert.deepEqual(f.calls.filter(row=>row.table===table).map(row=>row.offset),[0,2]);}
 assert.equal(result.ownerId,'owner');assert.equal(result.legacyKey.key,key);assert.equal(result.sourceHash,context.sourceHash);assert.equal(result.checkpointHash,'A'.repeat(43));
 assert.ok(!Object.hasOwn(result,'rows')&&!Object.hasOwn(result,'totals')&&!Object.hasOwn(result,'nextOffset'));assert.equal(f.calls.length,8);
});
test('genuinely absent source tables are explicit, not synthesized from an incomplete first page',async()=>{
 const f=fixture('physis');for(const table of f.tables)f.rows[table]=[];
 const result=await f.run();for(const table of f.tables)assert.deepEqual(result[table],[]);assert.deepEqual(result.legacyKey,{keyMode:'empty',key:null});assert.equal(f.calls.length,4);
});
for(const change of [p=>p.ownerId='foreign',p=>p.scopeId='other',p=>p.migrationId='other',p=>p.fence++,p=>p.sourceHash='B'.repeat(43),p=>p.protocol=2,
 p=>p.table='users',p=>p.offset=1,p=>p.nextOffset=3,p=>p.nextOffset=0,p=>p.nextOffset=null,p=>p.rows=[],p=>p.rows=Array(129).fill({id:'duplicate'}),p=>p.extra=true])
 test('wrong page context, unknown metadata, skipped/repeated offset or false end cannot pass as a complete source '+change.toString(),async()=>{
  const f=fixture(),read=f.ports.readPage;f.ports.readPage=async(...args)=>{const page=await read(...args);change(page);return page;};await assert.rejects(f.run(),/E2EE_/);
 });
for(const change of [p=>p.totals.versions++,p=>p.checkpointHash='B'.repeat(43),p=>p.directoryRevision++,p=>p.legacyGeneration++,p=>p.legacyKey.key=Buffer.alloc(32,8).toString('base64')])
 test('a changed source header, totals or old key cannot splice separate pages '+change.toString(),async()=>{
  const f=fixture(),read=f.ports.readPage;let index=0;f.ports.readPage=async(...args)=>{const page=await read(...args);if(index++)change(page);return page;};await assert.rejects(f.run(),/E2EE_/);
 });
test('page bounds, unsupported source and generation mismatch refuse with no fabricated empty result',async()=>{
 const f=fixture();await assert.rejects(collectLegacyPersonalPages(context,'unknown',f.ports),/E2EE_/);assert.equal(f.calls.length,0);
 const read=f.ports.readPage;f.ports.readPage=async(...args)=>{const p=await read(...args);p.legacyGeneration=2;return p;};await assert.rejects(f.run(),/E2EE_/);
 const g=fixture(),other=g.ports.readPage;g.ports.readPage=async(...args)=>{const p=await other(...args);p.rows[0].raw='x'.repeat(17*1024*1024);return p;};await assert.rejects(g.run(),/E2EE_SOURCE_TOO_LARGE/);
});
test('a short byte-limited page continues past 16MiB total without silently ending at the first response',async()=>{
 const f=fixture();f.rows.maps=Array.from({length:4},(_,i)=>({id:'map-'+i,raw:'cipher-'+i+'x'.repeat(5*1024*1024)}));
 const read=f.ports.readPage;f.ports.readPage=async(...args)=>{const page=await read(...args);if(page.table==='maps'){
  page.rows=[structuredClone(f.rows.maps[page.offset])];page.nextOffset=page.offset+1<f.rows.maps.length?page.offset+1:null;
 }return page;};
 const result=await f.run();assert.equal(result.maps.length,4);assert.deepEqual(f.calls.filter(row=>row.table==='maps').map(row=>row.offset),[0,1,2,3]);assert.deepEqual(result.maps,f.rows.maps);
});
test('a native opaque old-key capability must be explicit; account-null responses never unlock a web source',async()=>{
 const f=fixture(),read=f.ports.readPage;f.ports.readPage=async(...args)=>{const p=await read(...args);p.legacyKey.key=null;return p;};
 await assert.rejects(f.run(),/E2EE_/);const result=await f.run({opaqueKeys:true});assert.deepEqual(result.legacyKey,{keyMode:'account',key:null});
});
test('malformed canonical old keys or invented key modes are rejected',async()=>{
 for(const old of [{keyMode:'account',key:'invalid'},{keyMode:'empty',key},{keyMode:'client',key},{keyMode:'future',key:null}]){
  const f=fixture(),read=f.ports.readPage;f.ports.readPage=async(...args)=>({...await read(...args),legacyKey:old});await assert.rejects(f.run(),/E2EE_/);
 }
});
test('an account change after a page response stops further IO and never returns a partial source',async()=>{
 const f=fixture(),read=f.ports.readPage;f.ports.readPage=async(...args)=>{const page=await read(...args);f.lock();return page;};await assert.rejects(f.run(),/ACCOUNT_CHANGED/);assert.equal(f.calls.length,1);
});
