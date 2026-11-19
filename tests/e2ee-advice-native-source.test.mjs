import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {normalizeNativeAdviceCapture}=calendarModule('app/e2ee/advice-native-source.ts');
const {advicePreferences}=calendarModule('app/daily-advice.ts');
const sha=value=>createHash('sha256').update(value).digest('hex');
const OWNER='synthetic-native-advice',DAY='2026-11-19',ID='advice-0123456789abcdef01234567';
const preferences=JSON.stringify(advicePreferences({enabled:false,notifications:{enabled:true,time:'11:20',timeZone:'UTC'}}));
const profileHash=sha(`${OWNER}\0en\0${preferences}`);
const response=(body='Synthetic private native saved body',day=DAY)=>({dayKey:day,state:'ready',sequence:1,dailyLimit:9,remaining:8,canNext:true,
 advice:{id:ID,dayKey:day,language:'en',body,title:'Synthetic title',categories:['hermetica'],sources:[],dismissed:false,sequence:1},
 history:[{id:ID,dayKey:day,language:'en',body,title:'Synthetic title',categories:['hermetica'],sources:[],dismissed:false,sequence:1}]});
const document=(kind,value,revision=1,encrypted='synthetic-encrypted-'+kind)=>({kind,revision,encrypted,plain:JSON.stringify(value)});
function fixture(){
 const kind=`advice-snapshot-v1-${DAY}-aurora-${ID}`,marker=sha(`${ID}\0${DAY}`);
 const container=(body,legacyOriginal=null)=>({protocol:2,ownerId:OWNER,profiles:{[profileHash]:{language:'en',preferences,current:{deviceDay:DAY,response:response(body)},seen:{[marker]:{day:DAY,id:ID}},legacyOriginal}}});
 const encrypted='synthetic-previous-cache-ciphertext',legacyOriginal=JSON.stringify({deviceDay:'2026-11-18',response:response('Older original v1 body','2026-11-18')});
 const input={protocol:1,ownerId:OWNER,scopeId:'personal:'+OWNER,capturedAt:DAY+'T09:00:00Z',generation:0,pendingGeneration:null,outbox:[],unknownLegacyCount:0,
  knownProfiles:[{language:'en',preferences}],mounted:null,documents:[document('advice-cache-v2',container('Current native cache body',legacyOriginal),2),
   document('advice-cache-history-v2:'+sha(encrypted),container('Previous native cache body'),1,encrypted),document(kind,response()),
   document('advice-snapshots-v1',{entries:[kind],latest:[{day:DAY,language:'en',kind}],targets:[{day:DAY,kind}],delivered:[DAY]})],
  legacy:[{key:profileHash,value:JSON.stringify({deviceDay:DAY,response:response('Exact proven v1 body')})},{key:profileHash+':seen:'+ID,value:DAY}]};
 return{input,kind,remote:{days:[],entries:[],extraEntries:[]}};
}

test('actual v2 profile/history, older snapshots/index and proven v1 shapes retain content and provenance without quota fields',async()=>{
 const f=fixture(),before=structuredClone(f.input),{snapshot,metadata}=await normalizeNativeAdviceCapture(f.input,f.remote,()=>{});
 assert.equal(snapshot.ownerId,OWNER);assert.equal(snapshot.memory.rendered.length,5);assert.deepEqual(snapshot.memory.seen,[{dayKey:DAY,id:ID}]);
 for(const body of ['Current native cache body','Previous native cache body','Older original v1 body','Exact proven v1 body','Synthetic private native saved body'])assert.ok(snapshot.memory.rendered.some(row=>row.response.advice.body===body));
 assert.equal(metadata.profiles.length,2);assert.equal(metadata.profiles[0].preferences,preferences);assert.equal(metadata.indexes[0].targets[0].kind,f.kind);assert.deepEqual(metadata.indexes[0].delivered,[DAY]);assert.equal(metadata.legacy.length,2);
 // The common source sanitizes each rendered response. Metadata itself also
 // has no live draw permissions or legacy cipher/key bytes.
 for(const field of ['"dailyLimit":','"canNext":','"remaining":','synthetic-previous-cache-ciphertext'])assert.ok(!JSON.stringify(metadata).includes(field));
 assert.deepEqual(f.input,before);
});

test('unknown provenance, missing primary, owner/hash mismatch or malformed marker refuses normalization without altering originals',async()=>{
 for(const mutate of [f=>f.input.unknownLegacyCount=1,f=>f.input.pendingGeneration=1,f=>f.input.documents.shift(),
  f=>{const value=JSON.parse(f.input.documents[0].plain);value.ownerId='foreign';f.input.documents[0].plain=JSON.stringify(value);},
  f=>{const value=JSON.parse(f.input.documents[0].plain);value.profiles['0'.repeat(64)]=value.profiles[profileHash];delete value.profiles[profileHash];f.input.documents[0].plain=JSON.stringify(value);},
  f=>f.input.legacy[0].key='0'.repeat(64),f=>{const value=JSON.parse(f.input.documents[0].plain);value.profiles[profileHash].seen={['0'.repeat(64)]:{}};f.input.documents[0].plain=JSON.stringify(value);},
  f=>f.input.documents.push(document('advice-unknown-v99',{privateReflection:'retain'}))]){
  const f=fixture();mutate(f);const original=structuredClone(f.input);await assert.rejects(normalizeNativeAdviceCapture(f.input,f.remote,()=>{}),/E2EE_/);assert.deepEqual(f.input,original);
 }
});

test('older reminder index may reference signed server history but cannot silently keep a missing historical card',async()=>{
 const f=fixture();f.input.documents=f.input.documents.filter(row=>row.kind!==f.kind);
 await assert.rejects(normalizeNativeAdviceCapture(f.input,f.remote,()=>{}),/INDEX_REVIEW_REQUIRED/);
 f.remote.days=[{dayKey:DAY,adviceId:ID,entryJson:JSON.stringify({collection:'aurora'})}];
 const result=await normalizeNativeAdviceCapture(f.input,f.remote,()=>{});assert.deepEqual(result.metadata.indexes[0].missingLocal,[f.kind]);
});

test('account closure during hash validation prevents normalized private output',async()=>{
 const f=fixture();let checks=0;await assert.rejects(normalizeNativeAdviceCapture(f.input,f.remote,()=>{if(++checks>2)throw new Error('E2EE_ACCOUNT_CHANGED');}),/ACCOUNT_CHANGED/);
});
