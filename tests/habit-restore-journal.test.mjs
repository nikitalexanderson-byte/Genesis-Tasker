import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {HabitRestoreJournal,validateHabitRestoreDeviceDraft}=calendarModule('app/habit-restore-journal.ts');
const input=()=>({version:1,filename:'Собственная копия.json',text:'{"own":"Непубличный текст"}',fingerprint:'a'.repeat(64),choices:{habit:'copy'},phase:'review'});
function store(){const rows=new Map();return {rows,async list(scope){return [...rows.values()].filter(row=>row.scope===scope).map(row=>structuredClone(row));},
 async put(row,previous){const key=row.scope+':'+row.id;assert.deepEqual(rows.get(key)??null,previous);rows.set(key,structuredClone(row));},
 async remove(row){const key=row.scope+':'+row.id;if(!rows.has(key))return;if(JSON.stringify(rows.get(key))!==JSON.stringify(row))throw Error('HABIT_RESTORE_DRAFT_CHANGED');rows.delete(key);}};}
async function cipher(){const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);let blocked=false;
 return {block(){blocked=true;},check(){if(blocked)throw Error('closed account');},async seal(value,scope){this.check();const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(scope)},key,new TextEncoder().encode(JSON.stringify(value)));this.check();return {iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(bytes).toString('base64')};},
 async open(row,scope){this.check();const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(row.iv,'base64'),additionalData:new TextEncoder().encode(scope)},key,Buffer.from(row.ciphertext,'base64'));this.check();return JSON.parse(new TextDecoder().decode(bytes));}};}

test('encrypted restore filename, original fingerprint and explicit choice survive a new reader',async()=>{
 const disk=store(),access=await cipher(),first=new HabitRestoreJournal('user',access,disk);await first.write(input());
 assert.ok(!JSON.stringify([...disk.rows.values()]).includes('Непубличный'));
 const cold=new HabitRestoreJournal('user',access,disk),rows=await cold.list();assert.equal(rows.length,1);assert.deepEqual(rows[0].value,input());
 assert.deepEqual(await new HabitRestoreJournal('other-user',access,disk).list(),[]);
});
test('independent tab writers never replace each other and stale removal preserves newer recovery',async()=>{
 const disk=store(),access=await cipher(),a=new HabitRestoreJournal('user',access,disk),b=new HabitRestoreJournal('user',access,disk);
 const old=await a.write(input());await b.write({...input(),filename:'second.json'});await a.write({...input(),choices:{habit:'keep'}});
 assert.equal((await b.list()).length,2);await assert.rejects(()=>b.remove(old),/CHANGED/);assert.equal((await a.list()).length,2);
});
test('queued encryption completes in input order and failing storage leaves the earlier valid draft',async()=>{
 const disk=store(),access=await cipher(),journal=new HabitRestoreJournal('user',access,disk);
 await Promise.all([journal.write(input()),journal.write({...input(),choices:{habit:'keep'}})]);
 assert.equal((await journal.list())[0].value.choices.habit,'keep');
 const original=disk.put;disk.put=async()=>{throw Error('disk full');};
 await assert.rejects(()=>journal.write({...input(),phase:'applying'}),/disk full/);disk.put=original;
 assert.equal((await journal.list())[0].value.phase,'review');assert.equal((await journal.list())[0].value.choices.habit,'keep');
});
test('pre-apply intent is durable without authorizing any automatic replay or reward call',async()=>{
 const disk=store(),access=await cipher(),journal=new HabitRestoreJournal('user',access,disk);
 const saved=await journal.write({...input(),phase:'applying'});const cold=new HabitRestoreJournal('user',access,disk);
 assert.equal((await cold.list())[0].value.phase,'applying');await cold.remove(saved);assert.equal((await cold.list()).length,0);
});
test('account closure invalidates in-flight writes and disposed readers cannot resume',async()=>{
 const disk=store(),access=await cipher(),journal=new HabitRestoreJournal('user',access,disk);access.block();
 await assert.rejects(()=>journal.write(input()),/closed account/);assert.equal(disk.rows.size,0);
 const next=new HabitRestoreJournal('user',await cipher(),disk);next.dispose();await assert.rejects(()=>next.list(),/UNAVAILABLE/);
});
test('damaged or unsupported draft metadata is rejected without coercing a saved choice',()=>{
 for(const mutate of [row=>row.version=2,row=>row.phase='automatic',row=>row.choices.habit='overwrite',row=>row.fingerprint='bad',row=>row.extra='unknown',row=>row.text=null]){
  const row=input();mutate(row);assert.throws(()=>validateHabitRestoreDeviceDraft(row),/INVALID/);
 }
});
test('a damaged encrypted record is retained for export and explicit scoped removal',async()=>{
 const disk=store(),access=await cipher(),a=new HabitRestoreJournal('user',access,disk),b=new HabitRestoreJournal('user',access,disk);
 const first=await a.write(input());await b.write({...input(),filename:'retain.json'});
 const key=first.raw.scope+':'+first.raw.id;disk.rows.set(key,{...first.raw,ciphertext:'damaged'});
 let broken;try{await a.list();assert.fail('damaged record accepted');}catch(error){broken=error.record;}
 assert.equal(broken.ciphertext,'damaged');assert.equal(disk.rows.size,2);
 await assert.rejects(()=>new HabitRestoreJournal('other-user',access,disk).discard(broken),/INVALID/);
 await a.discard(broken);assert.equal((await a.list()).length,1);assert.equal((await a.list())[0].value.filename,'retain.json');
});
