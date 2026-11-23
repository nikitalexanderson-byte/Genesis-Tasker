import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {cacheLastUser,LAST_USER_CACHE_KEY,privateUserCacheRequired,retainPrivateUserCache,userCachePreferenceOriginal,privateUserProfile} from '../app/last-user-cache.ts';
import {protectPrivateWorkspaceOwner} from '../app/private-workspace-storage.ts';
import {retainLocalMigrationFence} from '../app/e2ee/web-local-migration-fence.ts';
import {retainEncryptedUserCache,retainedProfilePreferenceHistory} from '../app/e2ee/user-cache-retention.ts';
import {inspectDeviceControlCustody} from '../app/e2ee/device-control-custody.ts';
import {captureWebPrivatePathLocal} from '../app/e2ee/local-work-source.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {createRecoveryKit} from '../app/e2ee/keys.ts';

const fixture=(uid,extra={})=>({uid,email:'synthetic@example.invalid',language:'en',advicePreferences:{philosophers:true},uiVisibility:{hiddenMenuItems:['PRIVATE-CACHE-CANARY']},syncRouting:{mode:'fixed',defaultAccountIds:[uid],categoryAccountIds:{}},...extra});
function storage(){const rows=new Map();return{rows,get length(){return rows.size;},key:index=>[...rows.keys()][index]??null,getItem:key=>rows.get(key)??null,setItem:(key,value)=>rows.set(key,value),removeItem:key=>rows.delete(key)};}
const read=s=>JSON.parse(s.getItem(LAST_USER_CACHE_KEY));
test('private presentation flag follows confirmed deny-legacy state and ignores an unrelated server boolean',()=>{
 const original=fixture('view-owner',{privateVault:true}),copy=structuredClone(original);
 assert(!Object.hasOwn(privateUserProfile(original,false),'privateVault'));assert.deepEqual(original,copy);
 const privateView=privateUserProfile(fixture('view-owner'),true);assert.equal(privateView.privateVault,true);assert.equal(privateView.privatePreferencesMode,'e2ee');
 assert.deepEqual(privateView.uiVisibility,original.uiVisibility);
});
class Records{
 rows=new Map();async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes){for(const c of changes)assert.equal(this.rows.get(c.key)?.serial??null,c.expected);for(const c of changes)this.rows.set(c.key,structuredClone(c.value));}
}
class Keys{
 rows=new Map();async get(owner){return structuredClone(this.rows.get(owner)??null);}
 async create(owner,bundle){assert(!this.rows.has(owner));this.rows.set(owner,{serial:1,bundle:structuredClone(bundle)});}
}
test('legacy profile serialization stays compatible; migrated profile excludes all private preference families without mutating memory',()=>{
 const s=storage(),legacy=fixture('cache-legacy');assert(cacheLastUser(legacy,s));assert.deepEqual(read(s),legacy);
 const user=fixture('cache-private',{privatePreferencesMode:'e2ee'}),before=structuredClone(user);assert(cacheLastUser(user,s));
 assert.deepEqual(user,before);assert.equal(read(s).privatePreferencesMode,'e2ee');
 for(const key of ['advicePreferences','uiVisibility','syncRouting'])assert(!Object.hasOwn(read(s),key));
 assert(!s.getItem(LAST_USER_CACHE_KEY).includes('PRIVATE-CACHE-CANARY'));
});
test('known protected owner and durable active marker deny stale unflagged profile callbacks, including after lock',()=>{
 for(const [owner,mark]of [['cache-known',()=>protectPrivateWorkspaceOwner('cache-known','workspace:cache-known')],['cache-active',s=>retainLocalMigrationFence('cache-active','scope:cache-active','token:cache-active','active',s)],['cache-persisted',s=>s.setItem(LAST_USER_CACHE_KEY,JSON.stringify({uid:'cache-persisted',privatePreferencesMode:'e2ee'}))]]){
  const s=storage();mark(s);assert(privateUserCacheRequired(fixture(owner),s));assert(cacheLastUser(fixture(owner),s));
  assert(!s.getItem(LAST_USER_CACHE_KEY).includes('PRIVATE-CACHE-CANARY'));assert.equal(read(s).privatePreferencesMode,'e2ee');
 }
});
test('preparing migration freezes profile bytes; failed retention, changed account and foreign-owner cache preserve exact originals',async()=>{
 const s=storage(),user=fixture('cache-preserved'),raw=JSON.stringify(user);s.setItem(LAST_USER_CACHE_KEY,raw);
 retainLocalMigrationFence(user.uid,'scope:cache-preserved','token:cache-preserved','preparing',s);
 assert.equal(cacheLastUser({...user,email:'new@example.invalid'},s),false);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 await assert.rejects(retainPrivateUserCache(user.uid,async()=>{throw Error('DISK_FULL');},()=>{},s),/DISK_FULL/);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 let current=true;await assert.rejects(retainPrivateUserCache(user.uid,async()=>{current=false;},()=>{if(!current)throw Error('ACCOUNT_CHANGED');},s),/ACCOUNT_CHANGED/);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 let calls=0;await retainPrivateUserCache('cache-foreign',async()=>{calls++;},()=>{},s);assert.equal(calls,0);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 assert.equal(userCachePreferenceOriginal(raw,'cache-foreign'),null);
});
test('unique last-user original survives until custody; only inert preferences enter content history',async()=>{
 const s=storage(),user=fixture('cache-custody',{featureAccess:{premium:true},csrf:'MUST-NOT-BECOME-CONTENT'}),raw=JSON.stringify(user);s.setItem(LAST_USER_CACHE_KEY,raw);
 assert.equal(cacheLastUser({...user,privatePreferencesMode:'e2ee'},s),false);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 const content=userCachePreferenceOriginal(raw,user.uid);assert.deepEqual(Object.keys(content),['advicePreferences','uiVisibility','syncRouting']);assert(!JSON.stringify(content).includes('MUST-NOT'));
 let held;await retainPrivateUserCache(user.uid,async original=>{held=original;assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);},()=>{},s);
 assert.equal(held,raw);assert.equal(read(s).privatePreferencesMode,'e2ee');assert(!Object.hasOwn(read(s),'uiVisibility'));
 assert(cacheLastUser(user,s));assert(!Object.hasOwn(read(s),'uiVisibility'));
});
test('concurrent cache change is detected after custody and is never overwritten',async()=>{
 const s=storage(),user=fixture('cache-racing'),raw=JSON.stringify(user);s.setItem(LAST_USER_CACHE_KEY,raw);
 const changed=JSON.stringify(fixture('another-cache-owner'));
 await assert.rejects(retainPrivateUserCache(user.uid,async()=>{s.setItem(LAST_USER_CACHE_KEY,changed);},()=>{},s),/CAPTURE_CHANGED/);
 assert.equal(s.getItem(LAST_USER_CACHE_KEY),changed);
});
test('actual independent vault retains exact profile ciphertext through cold unlock before plaintext cache removal',async()=>{
 const s=storage(),owner='cache-cold',raw=JSON.stringify(fixture(owner,{featureAccess:{premium:true},csrf:'AUTHORITY-MUST-NOT-EXPORT'}));s.setItem(LAST_USER_CACHE_KEY,raw);
 const old=globalThis.localStorage;globalThis.localStorage=s;
 const recovery=await createRecoveryKit(owner),records=new Records(),keys=new Keys();
 try{
  const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys);
  await retainEncryptedUserCache(device,()=>{});assert(!s.getItem(LAST_USER_CACHE_KEY).includes('PRIVATE-CACHE-CANARY'));
  assert(!JSON.stringify([...records.rows]).includes('PRIVATE-CACHE-CANARY'));device.lock();
  const cold=await UnlockedWebDevice.unlock(owner,recovery.secret,records,keys),id='profile-original:'+Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))).toString('base64url');
  const {E2eeDeviceDocument}=await import('../app/e2ee/device-document.ts');
  const document=new E2eeDeviceDocument(cold,id,value=>value,()=>cold.requireOpen());const original=await document.load();
  assert.equal(original.value.original,raw);assert.equal(original.value.execution,'history-only');
  const history=await retainedProfilePreferenceHistory(id,original.value,owner);assert(JSON.stringify(history).includes('PRIVATE-CACHE-CANARY'));assert(!JSON.stringify(history).includes('AUTHORITY-MUST-NOT-EXPORT'));assert(!Object.hasOwn(history,'featureAccess'));
  await assert.rejects(retainedProfilePreferenceHistory(id,original.value,'foreign-owner'),/CORRUPT/);
  await assert.rejects(retainedProfilePreferenceHistory('profile-original:'+'A'.repeat(43),original.value,owner),/CORRUPT/);
  const claims=[];await inspectDeviceControlCustody({device:cold,vault:cold.vault,personalScopeId:'personal:'+owner,current:()=>cold.requireOpen(),claim:(...claim)=>claims.push(claim)});
  assert(claims.some(([domain,key,scope])=>domain==='draft'&&key===id&&scope==='personal:'+owner));assert(claims.some(([,key])=>key.startsWith('device-doc:')));cold.lock();
 }finally{recovery.secret.fill(0);if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
});
test('real local-work capture retains only this owner profile, exposing no identity or entitlement authority in content',async()=>{
 const s=storage(),owner='cache-local-source',raw=JSON.stringify(fixture(owner,{csrf:'SOURCE-AUTHORITY',featureAccess:{premium:true}}));s.setItem(LAST_USER_CACHE_KEY,raw);
 const prior=globalThis.indexedDB;globalThis.indexedDB={open(){const request={transaction:{abort(){queueMicrotask(()=>request.onerror());}}};queueMicrotask(()=>request.onupgradeneeded({oldVersion:0}));return request;}};
 const target={ownerId:owner,kind:'personal',resourceId:owner,pathId:'personal.local-work'},ports={storage:s,assertCurrent:()=>{},open:async()=>{throw Error('Unexpected legacy decryption');}};
 try{
  const result=await captureWebPrivatePathLocal(target,ports),entry=result.entries.find(row=>row.key===LAST_USER_CACHE_KEY);assert(entry);assert.equal(entry.raw,raw);
  assert(JSON.stringify(entry.content).includes('PRIVATE-CACHE-CANARY'));assert(!JSON.stringify(entry.content).includes('SOURCE-AUTHORITY'));assert(!Object.hasOwn(entry.content,'featureAccess'));
  const other=await captureWebPrivatePathLocal({...target,ownerId:'foreign-owner'},ports);assert.equal(other.entries.length,0);assert.equal(s.getItem(LAST_USER_CACHE_KEY),raw);
 }finally{if(prior===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=prior;}
});
test('local sign-out never permits a cache rewrite; all mounted writers and offline restoration use the shared boundary',()=>{
 const s=storage();s.setItem('genesis-local-sign-out-v1','{}');assert.equal(cacheLastUser(fixture('cache-logout'),s),false);assert.equal(s.getItem(LAST_USER_CACHE_KEY),null);
 const source=readFileSync(new URL('../app/GenesisCalendar.tsx',import.meta.url),'utf8');assert(!/setItem\(LAST_USER_KEY/.test(source));assert(source.includes('cached=await restoreOfflinePrivateWorkspace(cached)'));
});
