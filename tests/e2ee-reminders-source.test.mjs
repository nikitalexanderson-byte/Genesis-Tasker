import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {createRecoveryKit} from '../app/e2ee/keys.ts';
const {PersonalRemindersSource,reminderWebStorageKeys,REMINDER_SOURCE_TABLES,readMigratedReminderHistory,classifyReminderWorkerRecord}=calendarModule('app/e2ee/reminders-source.ts');
const {normalizeNativeReminderCapture}=calendarModule('app/e2ee/reminders-native-source.ts');
const {captureWebReminderInventory}=calendarModule('app/e2ee/reminders-web-source.ts');
const memoryModule=calendarModule('app/reminder-migration-memory.ts');
const now='2026-11-19T14:00:00Z',ownerId='reminder-owner',scopeId='personal:'+ownerId;
const context={ownerId,scopeId,migrationId:'reminder-migration',fence:4,sourceHash:'A'.repeat(43),generation:2};
const encode=value=>new TextEncoder().encode(JSON.stringify(value)),decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const target={id:'private-occurrence',kind:'habit',date:'2026-11-19',at:now,timeZone:'Europe/Moscow',allowDuringQuietHours:false,habitId:'private-habit',ruleId:'private-rule',action:'input'};
const plan={version:1,generatedAt:now,expiresAt:'2026-11-20T14:00:00Z',timeZone:'Europe/Moscow',tone:'calm',quietHoursStart:'22:00',quietHoursEnd:'08:00',rows:[target]};
function fixture(){
 const local={platform:'web',inventoryVersion:1,entries:reminderWebStorageKeys(ownerId).map(key=>({store:'localStorage',key,value:null})),room:[],editors:[],worker:{state:'absent',records:[]},unassigned:[],projectionWanted:true};
 const memory={ownerId,generation:0,reconciliationRequired:false,local};
 const remote={protocol:1,ownerId,scopeId,migrationId:context.migrationId,fence:4,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  habitProfiles:[{encrypted_plan:'exact-old-plan-ciphertext',plan_hash:'a'.repeat(64),workspace_version:17,revision:6,expires_at:plan.expiresAt,needs_refresh:1,updated_at:now,plan_json:JSON.stringify(plan)}],
  habitDevices:[{id:'old-device',device_key:'exact-device-id',encrypted_subscription:'inert-old-subscription-ciphertext',enabled:0,request_id:'uncertain-request',request_hash:'b'.repeat(64),time_zone:'Europe/Moscow',max_per_day:24,snooze_minutes:15,revision:3,created_at:now,updated_at:now}],
  habitDeliveries:[{id:'old-delivery',device_id:'old-device',profile_revision:6,event_key:'c'.repeat(64),encrypted_target:'exact-old-target-ciphertext',scheduled_at:now,expires_at:now,state:'failed',sent_at:null,reserved_at:now,snooze_of:null,error_code:'OLD_FAILURE',created_at:now,updated_at:now,target_json:JSON.stringify(target)}],
  adviceDays:[{day_key:'2026-11-19',advice_id:'advice-'+'d'.repeat(24),collection:'philosophers',scheduled_time:'09:00',time_zone:'Europe/Moscow',expires_at:now,created_at:now}],
  adviceDeliveries:[{id:'old-advice-delivery',device_id:'old-advice-device',day_key:'2026-11-19',state:'cancelled',sent_at:null,error_code:'OLD_CANCEL',created_at:now,updated_at:now}],
  sharedPreferences:[{settings_json:'{ "enabled":false, "futurePrivatePreference":{"value":"retain"} }',revision:9,updated_at:now}],legacyKey:{keyMode:'empty',key:null}};
 let live=true,captured=false,reads=0;
 const ports={assertCurrent(){if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},memory:async()=>structuredClone(memory),legacyReminders:async value=>{assert.equal(captured,true);assert.deepEqual(value,context);reads++;return structuredClone(remote);}};
 const source=new PersonalRemindersSource(ownerId,scopeId,ports);
 return{local,memory,remote,ports,source,get reads(){return reads;},lock(){live=false;},
  async capture(){const value=await source.captureLocal();captured=true;return value;},async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}
function read(result){const local=new Map(result.localContent.map(row=>[row.objectId,row.bytes]));return readMigratedReminderHistory(async(_,id)=>local.has(id)?new Uint8Array(local.get(id)):null,ownerId);}

test('all six retained reminder sources survive exactly as inert local history, with only private shared preferences remote',async()=>{
 const f=fixture(),before=structuredClone(f.remote),result=await f.run(),history=await read(result);
 assert.equal(result.complete,true);assert.equal(result.content.length,1);assert.equal(result.content[0].objectId,'personal-reminders-preferences-v1');
 assert.equal(history.execution,'history-only');assert.equal(history.deliveryAuthority,'fresh-consent-required');
 for(const name of REMINDER_SOURCE_TABLES)assert.deepEqual(history.server.filter(row=>row.table===name).map(row=>row.original),f.remote[name]);
 assert.deepEqual(f.remote,before);assert.equal(f.reads,1);
 const remote=JSON.stringify(result.content.map(row=>decode(row.bytes)));
 for(const canary of ['private-habit','private-occurrence','uncertain-request','old-delivery','exact-old-target-ciphertext','inert-old-subscription-ciphertext'])assert.ok(!remote.includes(canary));
 assert.ok(result.localContent.every(row=>!row.objectId.includes('old-delivery')&&!row.objectId.includes('2026-11-19')));
});
test('raw device settings, snoozes, pending actions and detached numeric input are preserved without invoking their actions',async()=>{
 const f=fixture();f.local.entries.find(row=>row.key.includes('.snoozes.')).value='{ "pending":{"row":'+JSON.stringify(target)+',"due":"2026-11-19T14:10:00Z"} }';
 f.local.editors=[{source:'habit-reminder-input',mounted:false,state:{target,value:'1,,',note:'private unsent note',operationId:'exact-uncertain-operation'}}];
 f.local.worker={state:'captured',records:[{cache:'genesis-habit-push-receipts-v1',url:'https://example.invalid/__habit-intent/scoped-intent',raw:JSON.stringify({userId:ownerId,deliveryId:'old-delivery',action:'primary',receivedAt:1})}]};
 const history=await read(await f.run());assert.deepEqual(history.captures[0].local,f.local);assert.equal(history.captures[0].local.editors[0].state.value,'1,,');
});
test('old interrupted captures retain both local versions rather than silently choosing or replaying a stale snooze',async()=>{
 const f=fixture(),old=await f.capture();f.local.editors.push({source:'habit-reminder-input',mounted:true,state:{value:'22,',note:'newer edit'}});
 const history=await read(await f.run([old]));assert.equal(history.captures.length,2);assert.equal(history.captures[0].local.editors[0].state.value,'22,');assert.deepEqual(history.captures[1].local.editors,[]);
});
test('empty sources remain explicit while an old pruned snooze/advice reference remains non-executable history',async()=>{
 const f=fixture();f.remote.habitDeliveries[0].snooze_of='pruned-original';f.remote.adviceDays=[];assert.equal((await f.run()).complete,true);
 for(const name of REMINDER_SOURCE_TABLES)f.remote[name]=[];const result=await f.run(),history=await read(result);assert.deepEqual(history.server,[]);assert.equal(history.captures.length,1);assert.equal(decode(result.content[0].bytes).shared,null);
});
test('unattributed old origin-wide receipts require explicit attribution before any private server read',async()=>{
 const f=fixture();f.local.unassigned=[{source:'legacy-origin-receipts',raw:'["old-private-date"]'}];await assert.rejects(f.run(),/PROVENANCE_REVIEW_REQUIRED/);assert.equal(f.reads,0);
 f.ports.reviewUnassigned=async()=>null;await assert.rejects(f.run(),/PROVENANCE_REVIEW_REQUIRED/);assert.equal(f.reads,0);
 f.ports.reviewUnassigned=async rows=>{assert.equal(rows[0].raw,'["old-private-date"]');return'attribute-to-current-owner';};assert.deepEqual((await read(await f.run())).captures[0].local.unassigned,f.local.unassigned);
});
for(const change of [f=>f.remote.ownerId='foreign',f=>f.remote.scopeId='foreign',f=>f.remote.sourceHash='B'.repeat(43),f=>f.remote.fence++,f=>f.remote.legacyGeneration++,
 f=>f.remote.legacyKey={keyMode:'account',key:null},f=>f.remote.habitDevices.push({...f.remote.habitDevices[0]}),f=>f.remote.habitDeliveries[0].device_id='unknown',
 f=>f.remote.habitProfiles[0].plan_json='{"version":1,"version":1}',f=>f.remote.habitDeliveries[0].target_json=JSON.stringify({...target,unknownPrivateField:'retain'}),
 f=>f.remote.sharedPreferences[0].settings_json='{"enabled":false,"enabl\\u0065d":true}',f=>f.remote.habitDeliveries[0].state='future-executable-state'])
 test('foreign, partial, duplicate or unsupported reminder source refuses completeness: '+change.toString(),async()=>{const f=fixture();change(f);await assert.rejects(f.run(),/E2EE_/);});
test('account loss after the source read and mismatched retained generations cannot become empty migration',async()=>{
 const f=fixture(),raw=await f.capture();f.memory.generation=1;await assert.rejects(f.run([raw]),/GENERATION_REVIEW_REQUIRED/);assert.equal(f.reads,0);
 const other=fixture();other.ports.legacyReminders=async()=>{other.lock();return other.remote;};await assert.rejects(other.run(),/ACCOUNT_CHANGED/);
 const malformed=fixture();malformed.local.entries.pop();await assert.rejects(malformed.run(),/SOURCE_INVALID/);assert.equal(malformed.reads,0);
});
test('new-root device storage can cold-unlock all reminder history without old account keys; plaintext never enters persisted records',async()=>{
 const f=fixture();f.local.editors=[{source:'input',mounted:false,state:{value:'17,',note:'REMINDER-PRIVATE-CANARY'}}];const result=await f.run();
 const rows=new Map(),keys=new Map(),records={get:async id=>structuredClone(rows.get(id)??null),list:async prefix=>[...rows.keys()].filter(key=>key.startsWith(prefix)),commit:async changes=>{
  for(const row of changes)assert.equal(rows.get(row.key)?.serial??null,row.expected);for(const row of changes)rows.set(row.key,structuredClone(row.value));}};
 const keyStore={get:async id=>structuredClone(keys.get(id)??null),create:async(id,bundle)=>{keys.set(id,{serial:1,bundle:structuredClone(bundle)});}};
 const recovery=await createRecoveryKit(ownerId),device=await UnlockedWebDevice.provision(ownerId,recovery.secret,recovery.kit,records,keyStore);await device.ensureDurableKeys();
 await device.vault.write(result.localContent.map(row=>({domain:row.domain,objectId:row.objectId,value:row.bytes,expected:null})));device.lock();
 assert.ok(!JSON.stringify([...rows]).includes('REMINDER-PRIVATE-CANARY')&&!JSON.stringify([...rows]).includes('private-habit'));
 const cold=await UnlockedWebDevice.unlock(ownerId,recovery.secret,records,keyStore);
 const history=await readMigratedReminderHistory(async(domain,id)=>(await cold.vault.read(domain,id))?.value??null,ownerId);
 assert.equal(history.captures[0].local.editors[0].state.note,'REMINDER-PRIVATE-CANARY');assert.equal(history.server.find(row=>row.table==='habitDevices').original.request_id,'uncertain-request');cold.lock();
});
function nativeInput(){const accountScope='account-'+createHash('sha256').update(ownerId).digest('hex').slice(0,32);return{
 protocol:1,ownerId,scopeId,capturedAt:now,generation:0,pendingGeneration:null,accountScope,room:[],
 preferences:Object.fromEntries(['genesis_habit_reminder_preferences','genesis_habit_alarm_registry','genesis_sleep_alarm_registry','genesis_moon_alarm_registry','genesis.advice.alarms.v1'].map(name=>[name,{}])),
 localPreferences:{fullMoonLeadDays:'3,1',newMoonLeadDays:null},mounted:null};}
test('native inventories preserve raw snoozes and every Room state while independently attributing URI records',async()=>{
 const input=nativeInput(),scope=input.accountScope,uri=`genesis://habit-reminder/${scope}/old-event`,foreign='genesis://habit-reminder/account-'+'e'.repeat(32)+'/other-event';
 input.room=['pending','delivered','cancelled'].map((state,index)=>({scope,id:'row-'+index,taskId:'task',occurrenceId:'occurrence',revision:9,at:-1,state,deliveredAt:null}));
 input.preferences.genesis_habit_alarm_registry={alarms:[uri,foreign],delivered:[uri],deliveryTimes:[uri+'\t123'],snoozeRequests:[uri],snoozes:[JSON.stringify({scope,requestId:uri,habitId:'habit',date:'2026-11-19',at:123,ruleId:'rule',until:456})]};
 const normalized=await normalizeNativeReminderCapture(input,()=>{}),f=fixture();f.ports.memory=async()=>normalized.memory;
 const result=await f.run(),history=await read(result),local=history.captures[0].local;assert.equal(local.room.length,3);assert.equal(local.entries.find(row=>row.key==='fullMoonLeadDays').value,'3,1');
 assert.deepEqual(local.entries.find(row=>row.store==='genesis_habit_alarm_registry'&&row.key==='alarms').value,[uri]);assert.equal(JSON.stringify(local).includes('other-event'),false);
});
test('a complete native JSON capture with delivered rows, scoped frequency and detached input reconciles losslessly',async()=>{
 const input=nativeInput(),scope=input.accountScope,uri=`genesis://habit-reminder/${scope}/old-event`;
 input.room=['pending','delivered','cancelled'].map((state,index)=>({scope,id:'local-'+index,taskId:'task',occurrenceId:'occurrence',revision:7,at:123+index,state,deliveredAt:state==='delivered'?145:null}));
 input.preferences.genesis_habit_reminder_preferences={[scope+':max']:24,[scope+':snooze']:15};
 input.preferences.genesis_habit_alarm_registry={alarms:[uri],delivered:[uri],deliveryTimes:[uri+'\t145'],snoozeRequests:[uri],snoozes:[JSON.stringify({scope,requestId:uri,habitId:'synthetic-habit',date:'2026-11-19',at:123,ruleId:'synthetic-rule',until:456})]};
 input.mounted={editors:[{source:'habit-reminder-input',mounted:false,state:{value:'1,,',note:'Synthetic private unsent reminder 🌙',operationId:'exact-uncertain-operation'}}]};
 const wire=JSON.stringify(input).replaceAll('/','\\/'),normalized=await normalizeNativeReminderCapture(JSON.parse(wire),()=>{}),f=fixture();
 f.ports.memory=async()=>normalized.memory;f.remote.habitProfiles=[];f.remote.adviceDays=[];f.remote.adviceDeliveries=[];
 const result=await f.run(),history=await read(result);assert.equal(result.complete,true);assert.equal(history.captures[0].local.room[1].deliveredAt,145);
 assert.equal(history.captures[0].local.editors[0].state.value,'1,,');
});
test('native registry attribution remains correct with the observed opaque custom-scheme URL provider behavior',async()=>{
 // API34/WebView113 and API35/WebView124 expose an empty hostname for this
 // non-special scheme. Native Uri still has the exact authority and owner.
 const input=nativeInput(),uri=`genesis://habit-reminder/${input.accountScope}/old-event`,original=globalThis.URL;
 input.preferences.genesis_habit_alarm_registry={alarms:[uri]};
 globalThis.URL=class extends original{constructor(value,base){super(value,base);if(String(value).startsWith('genesis:'))Object.defineProperty(this,'hostname',{value:''});}};
 try{const result=await normalizeNativeReminderCapture(input,()=>{});assert.deepEqual(result.memory.local.entries.find(row=>row.store==='genesis_habit_alarm_registry'&&row.key==='alarms').value,[uri]);}
 finally{globalThis.URL=original;}
});
test('native registry URI authority never accepts query fragments controls userinfo or a different host',async()=>{
 const raw=nativeInput(),scope=raw.accountScope;
 for(const uri of [`genesis://foreign/${scope}/event`,`genesis://habit-reminder@foreign/${scope}/event`,`genesis://habit-reminder:443/${scope}/event`,
  `genesis://habit-reminder/${scope}/event?scope=other`,`genesis://habit-reminder/${scope}/event#other`,`genesis://habit-reminder/${scope}/eve\nnt`,`genesis://habit-reminder/${scope}/eve\\nt`]){
  const input=nativeInput();input.preferences.genesis_habit_alarm_registry={alarms:[uri]};await assert.rejects(normalizeNativeReminderCapture(input,()=>{}),/SOURCE_INVALID/);
 }
});
test('native duplicate JSON scope, foreign Room rows, fake empty inventory and pending generations fail closed',async()=>{
 const input=nativeInput();input.preferences.genesis_habit_alarm_registry.snoozes=['{"scope":"'+input.accountScope+'","scope":"foreign"}'];await assert.rejects(normalizeNativeReminderCapture(input,()=>{}),/SOURCE_INVALID/);
 const foreign=nativeInput();foreign.room=[{scope:'foreign',id:'row',taskId:'task',occurrenceId:'occurrence',revision:1,at:1,state:'pending',deliveredAt:null}];await assert.rejects(normalizeNativeReminderCapture(foreign,()=>{}),/SCOPE_BINDING_MISMATCH/);
 const pending=nativeInput();pending.pendingGeneration=2;await assert.rejects(normalizeNativeReminderCapture(pending,()=>{}),/GENERATION_REVIEW_REQUIRED/);
 const f=fixture();f.local.platform='android';f.local.entries=[{store:'native-reminder-inventory',key:'manifest',value:'android-v1'}];f.local.projectionWanted=null;f.local.worker.state='unsupported';await assert.rejects(f.run(),/NATIVE_INVENTORY_REQUIRED/);assert.equal(f.reads,0);
});
test('worker attribution never accepts a foreign intent or converts an ownerless receipt into current-account data',()=>{
 const record={cache:'genesis-habit-push-receipts-v1',url:'https://example.invalid/__habit-receipt/old-id',raw:'{"receivedAt":1}'};assert.equal(classifyReminderWorkerRecord(record,ownerId),'unassigned');
 assert.equal(classifyReminderWorkerRecord({...record,raw:'{"userId":"foreign","receivedAt":1}'},ownerId),'foreign');
 const event={...record,url:'https://example.invalid/__habit-event/'+encodeURIComponent(ownerId+':'+'a'.repeat(64))};assert.equal(classifyReminderWorkerRecord(event,ownerId),'owned');
 assert.throws(()=>classifyReminderWorkerRecord({...event,raw:'{"userId":"foreign"}'},ownerId),/SOURCE_INVALID/);
});
test('actual local collector reads existing owner keys/caches without mutation, retaining unknown provenance for review',async()=>{
 memoryModule.clearReminderMigrationMemory();const stored=new Map([[`genesis.habit-reminder.frequency.${ownerId}`,'{ "maxPerDay":24,"snoozeMinutes":15 }'],['genesis-habit-notifications-delivered-v1','["old-origin-date"]']]);
 const entries=[['https://example.invalid/__habit-intent/id',JSON.stringify({userId:ownerId,action:'primary'})],['https://example.invalid/__habit-receipt/id','{"receivedAt":1}'],['https://example.invalid/__habit-intent/foreign',JSON.stringify({userId:'foreign',action:'primary'})]];
 const calls=[],cache={keys:async()=>entries.map(([url])=>new Request(url)),match:async request=>new Response(entries.find(([url])=>url===request.url)[1])};
 const local=await captureWebReminderInventory(ownerId,{storage:{getItem:key=>stored.get(key)??null},assertCurrent:()=>{},caches:{has:async name=>name==='genesis-habit-push-receipts-v1',open:async name=>{calls.push(name);return cache;}},notifications:async()=>[],projectionWanted:false});
 assert.deepEqual(calls,['genesis-habit-push-receipts-v1']);assert.equal(local.worker.records.length,1);assert.equal(local.unassigned.length,2);assert.equal(JSON.stringify(local).includes('"foreign"'),false);assert.equal(stored.size,2);
});
test('detached reminder fields survive navigation and unfinished save tasks prevent source capture',async()=>{
 memoryModule.clearReminderMigrationMemory();let value={value:'1,,',note:'unsaved'};const detach=memoryModule.registerReminderMigrationEditor(ownerId,'input',()=>value);detach();value={value:'later',note:'changed'};
 assert.equal(memoryModule.captureReminderMigrationEditors(ownerId)[0].state.value,'1,,');
 let finish;const work=memoryModule.withReminderEditorTask(ownerId,()=>new Promise(resolve=>{finish=resolve;}));assert.throws(()=>memoryModule.captureReminderMigrationEditors(ownerId),/OPERATION_IN_PROGRESS/);finish();await work;
 assert.equal(memoryModule.captureReminderMigrationEditors(ownerId).length,1);memoryModule.clearReminderMigrationMemory();assert.deepEqual(memoryModule.captureReminderMigrationEditors(ownerId),[]);
});
