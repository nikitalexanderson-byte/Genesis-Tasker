import assert from 'node:assert/strict';
import test from 'node:test';
import {MessengerCompositions,messengerComposeCell,parseMessengerCompose,serializeMessengerCompose} from '../app/messenger-compose.ts';
const chat='23000000-0000-0000-0000-000000000001',other='23000000-0000-0000-0000-000000000002';
function fixture(){const cells=new Map();let active=true,fail=false,changes=0;const ports={
 admit:()=>{const admitted=active;return()=>{assert(admitted&&active,'Retired owner');};},
 read:async(key,current)=>{current();return cells.get(key)??null;},
 compare:async(key,expected,next,current)=>{current();if(fail)throw Error('Storage unavailable');const old=cells.get(key)??null;if(old===next)return;if(old!==expected)throw Error('MESSENGER_DRAFT_CHANGED');current();cells.set(key,next);changes++;}
 };return{cells,model:()=>new MessengerCompositions('owner',ports),close:()=>{active=false;},fail:()=>{fail=true;},changes:()=>changes};}
const edited=value=>({...value,token:crypto.randomUUID(),sequence:1,text:'Edited existing message',edit:{id:other,seq:19,senderId:'owner',revision:7,sourceText:'Original message'}});
test('cold composition preserves exact legacy text and edit identity without interpreting it as a fresh message',async()=>{
 const f=fixture(),legacy='{"format":"some text, not a command"}';f.cells.set('draft:'+chat,legacy);const first=f.model();
 const initial=await first.load(chat);assert.equal(initial.text,legacy);assert.equal(f.cells.get('draft:'+chat),legacy);
 const next=edited(initial);await first.save(next,initial.token);const cold=await f.model().load(chat);
 assert.equal(cold.text,next.text);assert.deepEqual(cold.edit,next.edit);assert.equal(cold.token,next.token);
 assert(f.cells.has(`draft:${chat}:compose-history:${initial.token}:${initial.sequence}`));
});
test('queued input snapshots are ordered and cannot follow mutation of the caller object',async()=>{
 const f=fixture(),model=f.model(),initial=await model.load(chat),first={...initial,text:'First edit'},later={...initial,text:'Final edit'};
 const a=model.save(first),b=model.save(later);first.text='Caller changed';later.text='Caller also changed';await Promise.all([a,b]);
 assert.equal((await f.model().load(chat)).text,'Final edit');assert.equal(model.snapshot(chat).sequence,3);
});
test('exact acknowledgement is durable and a repeated acknowledgement cannot erase the next draft',async()=>{
 const f=fixture(),model=f.model(),initial=await model.load(chat);await model.save({...initial,text:'Submitted text'});const prepared=serializeMessengerCompose(model.snapshot(chat));
 const cleared=await model.acknowledge(chat,prepared);assert.equal(cleared.text,'');assert.notEqual(cleared.token,initial.token);
 await model.save({...cleared,text:'Independent next composition'});await model.acknowledge(chat,prepared);
 assert.equal((await f.model().load(chat)).text,'Independent next composition');assert(f.cells.has(`draft:${chat}:compose-history:${initial.token}:2`));
});
test('late acknowledgement retains revised text and gives its next create a distinct stable token',async()=>{
 const f=fixture(),model=f.model(),initial=await model.load(chat);await model.save({...initial,text:'Submitted text'});const prepared=serializeMessengerCompose(model.snapshot(chat));
 await model.save({...initial,text:'Later unsent revision'});const kept=await model.acknowledge(chat,prepared);
 assert.equal(kept.text,'Later unsent revision');assert.notEqual(kept.token,initial.token);assert.equal(kept.edit,null);
 assert.equal((await f.model().load(chat)).text,kept.text);
});
test('acknowledgement and legacy command cleanup do not clear a different composition or restore old raw text',async()=>{
 const f=fixture(),model=f.model(),initial=await model.load(chat);const prepared=serializeMessengerCompose(initial),edit=edited(initial);await model.save(edit,initial.token);
 const preserved=await model.acknowledge(chat,prepared);assert.deepEqual(preserved.edit,edit.edit);
 const old=await model.acknowledge(chat,null);assert.deepEqual(old,preserved);
});
test('two cold readers cannot overwrite each other and corruption never becomes an empty replacement',async()=>{
 const f=fixture(),a=f.model(),first=await a.load(chat),b=f.model(),second=await b.load(chat);await a.save({...first,text:'Other tab owns this edit'});
 await assert.rejects(b.save({...second,text:'Competing edit'}),/MESSENGER_DRAFT_CHANGED/);assert.equal((await f.model().load(chat)).text,'Other tab owns this edit');
 assert([...f.cells].some(([key,raw])=>key.startsWith(`draft:${chat}:compose-conflict:`)&&JSON.parse(raw).text==='Competing edit'));
 f.cells.set(messengerComposeCell(other),'{"format":"corrupt"}');const before=f.changes();await assert.rejects(a.load(other),/MESSENGER_DRAFT_INVALID/);assert.equal(f.changes(),before);
});
test('failed saves retain originals and flush refuses before send or navigation; retired owner cannot write',async()=>{
 const f=fixture(),model=f.model(),initial=await model.load(chat),original=f.cells.get(messengerComposeCell(chat));f.fail();await assert.rejects(model.save({...initial,text:'Unsaved'}),/Storage unavailable/);await assert.rejects(model.flush(),/Storage unavailable/);assert.equal(f.cells.get(messengerComposeCell(chat)),original);
 const g=fixture(),retired=g.model(),value=await retired.load(chat),count=g.changes();g.close();assert.throws(()=>retired.save({...value,text:'Wrong session'}),/Retired owner/);assert.equal(g.changes(),count);
});
test('malformed or foreign edit targets and composed authority fields cannot be imported as a draft',async()=>{
 const f=fixture(),initial=await f.model().load(chat);
 for(const change of [{ownerId:'foreign'},{chatId:other},{token:'not-a-uuid'},{sequence:0},{entitlement:'business'},{edit:{...edited(initial).edit,senderId:'foreign'}}])assert.throws(()=>parseMessengerCompose({...initial,...change},'owner',chat),/MESSENGER_DRAFT_INVALID/);
});
