import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition} from '../app/e2ee/legacy-transport-fence.ts';
const turn=()=>new Promise(setImmediate),clone=value=>JSON.parse(JSON.stringify(value));
function fence(tab){const markers={get:async owner=>tab.legacyMarkers.get(owner)??null,commit:async(owner,expected,next)=>{
 validateLegacyTransportTransition(owner,tab.legacyMarkers.get(owner)??null,expected,next);if(next)tab.legacyMarkers.set(owner,next);else tab.legacyMarkers.delete(owner);
 }};return new WebMigrationTransportFence(new WebLegacyTransportGate(markers,tab.navigator.locks),tab.userId,'personal:'+tab.userId,()=>{});}
test('actual status API holds device-key creation, borrowed HTTP and projection adoption ahead of migration',{timeout:8000},async()=>{
 const tab=await cloudSyncClient(),entered=deferred(),release=deferred();let captured=false;
 tab.respond(async(url,init)=>{assert.equal(new URL(url).pathname,'/api/habit-reminders/status');assert.equal(new Headers(init.headers).get('X-Genesis-Account-Id'),tab.userId);entered.resolve();await release.promise;return Response.json({hasDevices:true,device:null,profile:null,capabilities:{available:false},workspaceVersion:0});});
 const loading=tab.client.loadHabitReminderStatus(tab.userId);await entered.promise;
 const source=await tab.client.createPersonalRemindersMigrationSource(tab.userId,'personal:'+tab.userId,{legacyRemindersPage:async()=>assert.fail('capture did private IO')});
 const migration=fence(tab).withFence(async()=>{const raw=await source.captureLocal();const value=JSON.parse(new TextDecoder().decode(raw));raw.fill(0);captured=true;
  assert.equal(value.memory.local.projectionWanted,true);assert.ok(value.memory.local.entries.some(row=>row.key===`genesis.habit-reminder.device.${tab.userId}`&&row.value));});
 await turn();assert.equal(captured,false);release.resolve();await Promise.all([loading,migration]);assert.equal(captured,true);
 const requestCount=tab.requests.length;tab.storage.removeItem(`genesis.habit-reminder.device.${tab.userId}`);
 await assert.rejects(tab.client.loadHabitReminderStatus(tab.userId),/LEGACY_TRANSPORT_FORBIDDEN/);assert.equal(tab.storage.getItem(`genesis.habit-reminder.device.${tab.userId}`),null);assert.equal(tab.requests.length,requestCount);
});
test('actual registration drains before preparation; later device registration and local settings do not mutate or send',{timeout:8000},async()=>{
 const tab=await cloudSyncClient(),entered=deferred(),release=deferred();let body;
 tab.respond(async(url,init)=>{assert.equal(new URL(url).pathname,'/api/habit-reminders/devices');body=JSON.parse(init.body);entered.resolve();await release.promise;return Response.json({id:'registered-device',revision:3});});
 const registering=tab.client.registerHabitReminderDevice(tab.userId,{toJSON:()=>({endpoint:'https://push.example.invalid/synthetic-only'})},{maxPerDay:24,snoozeMinutes:15},2,'exact-request');await entered.promise;
 const migration=fence(tab).withFence(async()=>assert.equal(body.requestId,'exact-request'));await turn();release.resolve();await Promise.all([registering,migration]);
 const original=[...tab.storage.data];const count=tab.requests.length;
 await assert.rejects(tab.client.registerHabitReminderDevice(tab.userId,{toJSON:()=>assert.fail('late subscription accessed')},{maxPerDay:4,snoozeMinutes:5},3,'late-request'),/LEGACY_TRANSPORT_FORBIDDEN/);
 await assert.rejects(tab.client.saveReminderLocalValue(tab.userId,`genesis.habit-reminder.frequency.${tab.userId}`,'{"maxPerDay":4}'),/LEGACY_TRANSPORT_FORBIDDEN/);
 assert.deepEqual([...tab.storage.data],original);assert.equal(tab.requests.length,count);
});
test('an admitted reminder callback borrows the same live owner permit across a queued exclusive migration',{timeout:8000},async()=>{
 const tab=await cloudSyncClient(),entered=deferred(),release=deferred();let nested=false;
 const operation=tab.client.withPersonalReminderOperation(tab.userId,async permit=>{entered.resolve();await release.promise;
  await tab.client.withPersonalReminderOperation(tab.userId,async()=>{nested=true;},permit);});await entered.promise;
 const migration=fence(tab).withFence(async()=>assert.equal(nested,true));await turn();release.resolve();await Promise.all([operation,migration]);
});
test('foreign, unauthenticated and closed reminder permits never authorize local writes',{timeout:8000},async()=>{
 const tab=await cloudSyncClient();let permit;
 await assert.rejects(tab.client.withPersonalReminderOperation('foreign',async()=>assert.fail('foreign operation')),/ACCOUNT_CHANGED/);
 await tab.client.withPersonalReminderOperation(tab.userId,async value=>{permit=value;});
 await assert.rejects(tab.client.withPersonalReminderOperation(tab.userId,async()=>assert.fail('closed operation'),permit),/INVALID_LEGACY_OPERATION/);
 const unauthenticated=await cloudSyncClient({authenticated:false,initializeWorkspace:false});await assert.rejects(unauthenticated.client.saveReminderLocalValue(unauthenticated.userId,`genesis-moon-reminders-v1:${unauthenticated.userId}`,'{}'),/ACCOUNT_CHANGED/);
 const snapshot=clone([...unauthenticated.storage.data]);assert.deepEqual(clone([...unauthenticated.storage.data]),snapshot);
});
test('a locally unlocked offline workspace retains local reminder settings without authorizing any server socket',{timeout:8000},async()=>{
 const tab=await cloudSyncClient({authenticated:false}),key=`genesis-moon-reminders-v1:${tab.userId}`;
 await tab.client.saveReminderLocalValue(tab.userId,key,'{"full":[1,3],"new":[]}');assert.equal(tab.storage.getItem(key),'{"full":[1,3],"new":[]}');
 await assert.rejects(tab.client.loadHabitReminderStatus(tab.userId),/ACCOUNT_BINDING_REQUIRED/);assert.equal(tab.requests.length,0);
 await fence(tab).withFence(async()=>{});await assert.rejects(tab.client.saveReminderLocalValue(tab.userId,key,'{}'),/LEGACY_TRANSPORT_FORBIDDEN/);
 assert.equal(tab.storage.getItem(key),'{"full":[1,3],"new":[]}');
});
test('known remote cutover blocks legacy local reminders even before this device has its own persistent marker',{timeout:8000},async()=>{
 const tab=await cloudSyncClient(),key=`genesis-moon-reminders-v1:${tab.userId}`;
 tab.respond(async url=>{assert.equal(new URL(url).pathname,'/api/session');return Response.json({user:{uid:tab.userId,privatePreferencesMode:'e2ee'},csrf:'fixture-csrf',loginId:'fixture-login:'+tab.userId});});
 await tab.client.loadGenesisSession();assert.equal(tab.legacyMarkers.size,0);const count=tab.requests.length;
 await assert.rejects(tab.client.saveReminderLocalValue(tab.userId,key,'{"full":[2],"new":[]}'),/E2EE_UPGRADE_REQUIRED/);
 assert.equal(tab.storage.getItem(key),null);assert.equal(tab.requests.length,count);
});
