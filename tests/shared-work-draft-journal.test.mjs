import test from 'node:test';
import assert from 'node:assert/strict';
import {SharedWorkDraftJournal,SHARED_WORK_DRAFT_PREFIX} from '../app/shared-work-draft-journal.ts';
import {clearPrivateDeviceStorage} from '../app/local-sign-out.ts';
class MemoryStorage{
 data=new Map();quota=false;
 get length(){return this.data.size;}key(index){return [...this.data.keys()][index]??null;}
 getItem(key){return this.data.get(key)??null;}setItem(key,value){if(this.quota)throw new DOMException('Quota','QuotaExceededError');this.data.set(key,String(value));}removeItem(key){this.data.delete(key);}
}
const valid=value=>{if(!value||typeof value.text!=='string'||value.pending!==null&&typeof value.pending?.requestId!=='string')throw Error('INVALID_DOCUMENT');return value;};
const payload=(text,requestId=null)=>({text,pending:requestId?{requestId,expectedRevision:3}:null});
async function cipher(){
 const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let active=true;
 const check=()=>{if(!active)throw Error('SESSION_ENDED');};
 return {check,revoke(){active=false;},async seal(value,scope){check();const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},key,new TextEncoder().encode(JSON.stringify(value)));check();return {iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(data).toString('base64')};},async open(value,scope){check();const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(value.iv,'base64'),additionalData:new TextEncoder().encode(scope)},key,Buffer.from(value.ciphertext,'base64'));check();return JSON.parse(new TextDecoder().decode(data));}};
}
const journal=(storage,access,writerId='writer-a',extra={})=>new SharedWorkDraftJournal({storage,access,userId:'user-a',projectId:'project-a',purpose:'workflow',validate:valid,writerId,...extra});

test('planning task drafts have an independent authenticated namespace and share sign-out cleanup',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),workflow=journal(storage,access),planning=journal(storage,access,'writer-a',{purpose:'planning'}),tasks=journal(storage,access,'writer-a',{purpose:'planning-tasks'});
 await workflow.write(payload('workflow'));await planning.write(payload('sprint'));const saved=await tasks.write(payload('estimate','task-request'));
 assert.deepEqual((await workflow.list()).map(row=>row.value.text),['workflow']);assert.deepEqual((await planning.list()).map(row=>row.value.text),['sprint']);assert.deepEqual((await tasks.list()).map(row=>row.value.text),['estimate']);
 const planningKey=[...storage.data.keys()].find(key=>key.includes(':planning:')),taskKey=planningKey.replace(':planning:',':planning-tasks:');storage.setItem(taskKey,storage.getItem(planningKey));await assert.rejects(tasks.list(),/DRAFT_INVALID/);storage.setItem(taskKey,saved.raw);assert.equal((await tasks.list())[0].value.pending.requestId,'task-request');storage.setItem('public-theme','standart');clearPrivateDeviceStorage(storage);assert.deepEqual([...storage.data.keys()],['public-theme']);
});
test('reload restores encrypted draft and exact pending identity without plaintext',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),first=journal(storage,access);await first.write(payload('PRIVATE_WORKFLOW_TITLE','request-stable'));first.dispose();
 assert.ok(![...storage.data.values()].join('').includes('PRIVATE_WORKFLOW_TITLE'));assert.ok(![...storage.data.values()].join('').includes('request-stable'));
 const reloaded=journal(storage,access,'new-window'),rows=await reloaded.list();assert.equal(rows.length,1);assert.deepEqual(rows[0].value,payload('PRIVATE_WORKFLOW_TITLE','request-stable'));
 assert.equal((await journal(storage,access,'other',{userId:'other-user'}).list()).length,0);
 assert.equal((await journal(storage,access,'other',{projectId:'other-project'}).list()).length,0);
 assert.equal((await journal(storage,access,'other',{purpose:'planning'}).list()).length,0);
 const [oldKey,raw]=[...storage.data][0];storage.data.set(oldKey.replace('project-a','other-project'),raw);await assert.rejects(journal(storage,access,'other',{projectId:'other-project'}).list(),/DRAFT_INVALID/);
 storage.data.set(oldKey.replace('user-a','other-user'),raw);await assert.rejects(journal(storage,access,'other',{userId:'other-user'}).list(),/DRAFT_INVALID/);
 storage.data.set(oldKey.replace(':workflow:',':planning:'),raw);await assert.rejects(journal(storage,access,'other',{purpose:'planning'}).list(),/DRAFT_INVALID/);
});
test('independent tabs keep both edits and recovery deletion uses compare-and-swap',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),a=journal(storage,access),b=journal(storage,access,'writer-b');const old=await a.write(payload('A'));await b.write(payload('B'));assert.equal((await a.list()).length,2);
 await a.write(payload('A changed'));await assert.rejects(b.remove(old),/DRAFT_CHANGED/);assert.equal((await b.list()).length,2);
 const current=(await b.list()).find(row=>row.id==='writer-a');await b.remove(current);assert.equal((await b.list())[0].value.text,'B');
});
test('queued encryption preserves input snapshot and edit order',async()=>{
 const storage=new MemoryStorage(),access=await cipher();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);let calls=0;
 const slow={...access,async seal(value,scope){if(++calls===1){entered();await gate;}return access.seal(value,scope);}};
 const a=journal(storage,slow),input=payload('first'),first=a.write(input);input.text='mutated after staging';await started;const second=a.write(payload('second'));release();assert.equal((await first).value.text,'first');await second;assert.equal((await a.list())[0].value.text,'second');
});
test('sign-out blocks delayed crypto and clears the private namespace',async()=>{
 const storage=new MemoryStorage(),access=await cipher();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const slow={...access,async seal(value,scope){const result=await access.seal(value,scope);entered();await gate;return result;}};
 const a=journal(storage,slow),pending=a.write(payload('late'));await started;access.revoke();clearPrivateDeviceStorage(storage);release();await assert.rejects(pending,/SESSION_ENDED/);assert.equal(storage.length,0);
 const other=await cipher();await journal(storage,other).write(payload('saved'));storage.setItem('public-theme','standart');clearPrivateDeviceStorage(storage);assert.equal(storage.length,1);assert.equal(storage.getItem('public-theme'),'standart');
});
test('quota and corrupt bytes preserve the previous record until explicit recovery',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),a=journal(storage,access),saved=await a.write(payload('original'));storage.quota=true;await assert.rejects(a.write(payload('unsaved')),error=>error.name==='QuotaExceededError');storage.quota=false;assert.equal((await a.list())[0].value.text,'original');
 const key=[...storage.data.keys()][0];storage.data.set(key,'CORRUPT_RECOVERY_BYTES');let failure;try{await a.list();}catch(error){failure=error;}assert.equal(failure.message,'DRAFT_INVALID');assert.equal(storage.getItem(key),'CORRUPT_RECOVERY_BYTES');await assert.rejects(a.write(payload('do not overwrite')),/DRAFT_RECOVERY_REQUIRED/);await a.remove(failure.record);assert.equal((await a.list()).length,0);await a.write(payload('recovered'));assert.notEqual(storage.getItem(key),saved.raw);
});
test('size and count bounds never delete earlier drafts',async()=>{
 const storage=new MemoryStorage(),access=await cipher();for(let index=0;index<20;index++)await journal(storage,access,'writer-'+index).write(payload('draft '+index));
 const a=journal(storage,access,'overflow');await assert.rejects(a.write(payload('extra')),/DRAFT_LIMIT/);assert.equal(storage.length,20);assert.throws(()=>a.write(payload('я'.repeat(1_000_001))),/DRAFT_TOO_LARGE/);assert.equal(storage.length,20);assert.ok([...storage.data.keys()].every(key=>key.startsWith(SHARED_WORK_DRAFT_PREFIX)));
});
test('disposing a view blocks a delayed storage write',async()=>{
 const storage=new MemoryStorage(),access=await cipher();let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const slow={...access,async seal(value,scope){const result=await access.seal(value,scope);entered();await gate;return result;}};
 const a=journal(storage,slow),pending=a.write(payload('closed editor'));await started;a.dispose();release();await assert.rejects(pending,/DRAFT_CLOSED/);assert.equal(storage.length,0);
});

function durableStore(legacy){
 const data=new Map();return {data,fail:false,beforeCommit:async()=>{},
  async keys(prefix){return [...new Set([...data.keys(),...legacy.data.keys()])].filter(key=>key.startsWith(prefix));},
  async read(key){return data.get(key)??legacy.getItem(key);},
  async write(key,raw,previous,prefix,limit,check){await this.beforeCommit();check();if(this.fail)throw new DOMException('disk full','QuotaExceededError');if((data.get(key)??null)!==previous)throw Error('DRAFT_CHANGED');if(!data.has(key)&&(await this.keys(prefix)).length>=limit)throw Error('DRAFT_LIMIT');check();data.set(key,raw);},
  async remove(key,expected,check){await this.beforeCommit();check();const current=await this.read(key);if(current!==null&&current!==expected)throw Error('DRAFT_CHANGED');data.delete(key);if(legacy.getItem(key)===expected)legacy.removeItem(key);},
 };
}

test('a valid five-megabyte template and duplicated pending snapshots fit the encrypted async journal',async()=>{
 const storage=new MemoryStorage(),asyncStorage=durableStore(storage),access=await cipher(),text='я'.repeat(2_300_000);
 const input={text,pending:{requestId:'stable',manifest:text,original:text}};
 const a=journal(storage,access,'large',{purpose:'templates',asyncStorage,maxBytes:20_000_000});await a.write(input);
 // Base64 ciphertext can contain the letters stable by chance; only the quoted JSON value indicates plaintext.
 assert.equal(storage.length,0);assert.equal(asyncStorage.data.size,1);assert.ok(![...asyncStorage.data.values()][0].includes(JSON.stringify(input.pending.requestId)));
 const b=journal(storage,access,'cold',{purpose:'templates',asyncStorage,maxBytes:20_000_000});assert.deepEqual((await b.list())[0].value,input);
 assert.throws(()=>journal(storage,access).write(input),/DRAFT_TOO_LARGE/);
 assert.throws(()=>a.write(payload('я'.repeat(10_000_001))),/DRAFT_TOO_LARGE/);
});

test('legacy recovery keeps its original bytes until the new async writer is durable',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),old=journal(storage,access,'legacy',{purpose:'templates'});
 const saved=await old.write(payload('old own input','stable-request')),asyncStorage=durableStore(storage);
 const next=journal(storage,access,'new',{purpose:'templates',asyncStorage});assert.deepEqual((await next.list())[0].value,saved.value);
 asyncStorage.fail=true;await assert.rejects(next.write(saved.value),error=>error.name==='QuotaExceededError');assert.equal(storage.length,1);assert.equal([...storage.data.values()][0],saved.raw);
 asyncStorage.fail=false;await next.write(saved.value);assert.equal((await next.list()).length,2);await next.remove(saved);
 assert.equal(storage.length,0);assert.equal((await next.list())[0].value.pending.requestId,'stable-request');
});

test('async compare-and-put rejects a writer changed while encryption was pending',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),asyncStorage=durableStore(storage),a=journal(storage,access,'same',{asyncStorage});await a.write(payload('original'));
 asyncStorage.beforeCommit=async()=>{asyncStorage.beforeCommit=async()=>{};const b=journal(storage,access,'same',{asyncStorage});await b.write(payload('other tab'));};
 await assert.rejects(a.write(payload('stale overwrite')),/DRAFT_CHANGED/);assert.equal((await a.list())[0].value.text,'other tab');
});

test('async commit rechecks account access after crypto and before touching durable storage',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),asyncStorage=durableStore(storage),a=journal(storage,access,'writer',{asyncStorage});
 asyncStorage.beforeCommit=async()=>access.revoke();await assert.rejects(a.write(payload('late')),/SESSION_ENDED/);assert.equal(asyncStorage.data.size,0);
});

test('legacy and async drafts share the twenty-record limit and stale removal preserves the latest input',async()=>{
 const storage=new MemoryStorage(),access=await cipher(),asyncStorage=durableStore(storage);
 for(let i=0;i<10;i++)await journal(storage,access,'legacy-'+i).write(payload('old '+i));
 for(let i=0;i<10;i++)await journal(storage,access,'new-'+i,{asyncStorage}).write(payload('new '+i));
 const a=journal(storage,access,'overflow',{asyncStorage});assert.equal((await a.list()).length,20);await assert.rejects(a.write(payload('extra')),/DRAFT_LIMIT/);
 const b=journal(storage,access,'new-0',{asyncStorage}),old=(await b.list()).find(row=>row.id==='new-0');await b.write(payload('updated'));
 await assert.rejects(a.remove(old),/DRAFT_CHANGED/);assert.equal(storage.length+asyncStorage.data.size,20);
});
