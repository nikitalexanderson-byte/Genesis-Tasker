import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {clearPrivateDeviceStorage} from '../app/local-sign-out.ts';
import {waitForSharedPush} from '../app/shared-push-device.ts';
import {rebaseNotificationPreferences} from '../app/notification-preferences-rebase.ts';

const preferenceFixture=()=>({types:{assignment:true,mentions:true,changes:true},channels:{inbox:true,push:false,email:false},frequency:'immediate',digestTime:'09:00',quiet:{enabled:false,start:'22:00',end:'08:00'},timeZone:'Europe/Moscow',timeZoneMode:'fixed',reminderDays:1});
test('notification refresh preserves own input and loads independent changes without enabling an external channel',()=>{
 const base=preferenceFixture(),draft=structuredClone(base),latest=structuredClone(base);
 draft.types.mentions=false;draft.quiet.start='23:00';draft.timeZone='Bad/typed-zone';
 latest.types.assignment=false;latest.quiet.end='10:00';latest.reminderDays=3;
 const originals=JSON.stringify({base,draft,latest}),rebased=rebaseNotificationPreferences(base,draft,latest);
 assert.equal(rebased.types.mentions,false);assert.equal(rebased.types.assignment,false);
 assert.equal(rebased.quiet.start,'23:00');assert.equal(rebased.quiet.end,'10:00');assert.equal(rebased.reminderDays,3);
 assert.equal(rebased.timeZone,'Bad/typed-zone');assert.deepEqual(rebased.channels,{inbox:true,push:false,email:false});
 assert.equal(JSON.stringify({base,draft,latest}),originals);
});
test('notification conflict refresh keeps an explicit zero and false for the subsequent Save',()=>{
 const base=preferenceFixture(),draft=structuredClone(base),latest=structuredClone(base);
 draft.reminderDays=0;draft.types.changes=false;latest.reminderDays=7;latest.types.changes=true;latest.channels.email=true;
 const next=rebaseNotificationPreferences(base,draft,latest);
 assert.equal(next.reminderDays,0);assert.equal(next.types.changes,false);assert.equal(next.channels.email,true);
 const refreshed=structuredClone(next);refreshed.frequency='daily';refreshed.quiet.end='11:00';
 assert.deepEqual(rebaseNotificationPreferences(next,next,refreshed),refreshed);
});
test('notification refresh retains newly supplied per-email settings and later edits without sharing object references',()=>{
 const base=preferenceFixture(),draft=structuredClone(base),latest=structuredClone(base);
 draft.frequency='hourly';latest.emailTypes={...latest.types,messages:false};
 const next=rebaseNotificationPreferences(base,draft,latest);
 assert.deepEqual(next.emailTypes,latest.emailTypes);assert.equal(next.frequency,'hourly');
 next.emailTypes.messages=true;next.quiet.enabled=true;assert.equal(latest.emailTypes.messages,false);assert.equal(draft.quiet.enabled,false);
});

const source=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),origin='https://genesiscalendar.com/';
function pushWorker({status=200,displayAllowed=true,externalUrl=false,stores=new Map()}={}){
 const events=new Map(),shown=[],requests=[];
 const cacheFor=name=>{if(!stores.has(name))stores.set(name,new Map());const rows=stores.get(name);return{match:async key=>rows.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>rows.set(typeof key==='string'?key:key.url,response),keys:async()=>[...rows.keys()].map(url=>new Request(url)),delete:async key=>rows.delete(typeof key==='string'?key:key.url)};};
 const self={registration:{scope:origin,showNotification:async(title,options)=>shown.push({title,...options})},location:{origin:new URL(origin).origin},addEventListener:(name,listener)=>events.set(name,listener)};
 runInNewContext(source,{self,URL,Request,Response,importScripts(){},caches:{open:async name=>cacheFor(name)},fetch:async(url,options)=>{
  requests.push({url,options});const id=new URL(url).pathname.split('/').at(-1);return new Response(JSON.stringify({displayAllowed,message:{deliveryId:id,body:'Synthetic recipient-localized generic copy',lang:'el',url:externalUrl?'https://outside.invalid/':`${origin}?notice=${id}#projects`}}),{status,headers:{'Content-Type':'application/json'}});
 }});
 const push=async(data)=>{let work;events.get('push')({data:{json:()=>data},waitUntil:promise=>{work=promise;}});await work;};
 return{push,shown,requests,stores};
}
test('shared push checks the authenticated current-access endpoint and persists one receipt across duplicate deliveries and worker restarts',async()=>{
 const id=crypto.randomUUID(),worker=pushWorker();await Promise.all([worker.push({deliveryId:id,taskTitle:'must not be used'}),worker.push({deliveryId:id})]);
 assert.equal(worker.shown.length,1);assert.equal(worker.requests.length,1);assert.equal(worker.requests[0].options.credentials,'include');assert.equal(worker.requests[0].options.cache,'no-store');
 assert.equal(worker.shown[0].tag,`genesis-shared-${id}`);assert.equal(worker.shown[0].lang,'el');assert.equal(worker.shown[0].renotify,false);assert.equal(JSON.stringify(worker.shown).includes('must not be used'),false);
 const restarted=pushWorker({stores:worker.stores});await restarted.push({deliveryId:id});assert.equal(restarted.shown.length,0);assert.equal(restarted.requests.length,0);
});
test('revoked access, quiet hours, cross-origin destinations and malformed push identities never display a notification',async()=>{
 for(const options of[{status:401},{status:403},{status:404},{displayAllowed:false},{externalUrl:true}]){const worker=pushWorker(options);await worker.push({deliveryId:crypto.randomUUID()});assert.equal(worker.shown.length,0);}
 const worker=pushWorker();for(const data of[{},{deliveryId:'invalid'},{deliveryId:'../task'}])await worker.push(data);assert.equal(worker.requests.length,0);assert.equal(worker.shown.length,0);
});
test('shared push receipt pruning retains current IDs beyond transport TTL and removes only expired metadata',async()=>{
 const stores=new Map(),expired=crypto.randomUUID(),rows=new Map([[`${origin}__shared-push-receipt/${expired}`,new Response(JSON.stringify({receivedAt:Date.now()-3*86400000}))]]);stores.set('genesis-shared-push-receipts-v1',rows);
 const worker=pushWorker({stores});const ids=Array.from({length:50},()=>crypto.randomUUID());for(const deliveryId of ids)await worker.push({deliveryId});assert.equal(worker.shown.length,50);assert.equal(rows.has(`${origin}__shared-push-receipt/${expired}`),false);for(const id of ids)assert.equal(rows.has(`${origin}__shared-push-receipt/${id}`),true);
});
test('every notification setting and API error has translated resources with matching parameters in all14 languages',()=>{
 const keys=new Set();for(const relative of['app/SharedNotificationPreferences.tsx','app/notification-settings-model.ts'])for(const match of fs.readFileSync(new URL('../'+relative,import.meta.url),'utf8').matchAll(/"([^"\r\n]*[А-Яа-яЁё][^"\r\n]*)"/g))keys.add(match[1]);
 for(const key of['История уведомлений','Отметить непрочитанным','Уведомление больше недоступно. Проверьте доступ и подключение.','Есть новые уведомления в общих делах GENESIS.','Откройте GENESIS, чтобы посмотреть обновления.'])keys.add(key);
 const parameters=text=>[...text.matchAll(/\{[^{}]+\}/g)].map(match=>match[0]).sort();assert.ok(keys.size>=60);
 for(const locale of['en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
  const catalog={};for(const relative of[`app/translations.${locale}.json`,`app/translations.${locale}.a.json`,`app/translations.${locale}.b.json`,`app/ui-translations/${locale}.json`]){const file=new URL('../'+relative,import.meta.url);if(fs.existsSync(file))Object.assign(catalog,JSON.parse(fs.readFileSync(file,'utf8')));}
  for(const key of keys){assert.ok(catalog[key],`${locale}: ${key}`);if(!(key==='Недоступно'&&['sr','uk'].includes(locale)))assert.notEqual(catalog[key],key,`${locale}: untranslated ${key}`);assert.deepEqual(parameters(catalog[key]),parameters(key),`${locale}: parameters ${key}`);}
 }
 const server=JSON.parse(fs.readFileSync(new URL('../server/resources/shared-notification-copy.json',import.meta.url),'utf8'));assert.equal(Object.keys(server).length,14);for(const [locale,copy]of Object.entries(server))for(const [key,value]of Object.entries(copy))assert.ok(value&&(locale==='ru'||value!==key));
});
test('logout clears every account device subscription identifier without clearing language preferences',()=>{
 const entries=new Map([['genesis.shared-push.account-a','synthetic-device-a'],['genesis.shared-push.account-b','synthetic-device-b'],['genesis-language-v1','el']]);const storage={get length(){return entries.size;},key:index=>[...entries.keys()][index]??null,removeItem:key=>entries.delete(key)};
 clearPrivateDeviceStorage(storage);assert.deepEqual([...entries],[['genesis-language-v1','el']]);
});
test('closed or timed-out push forms clean up a late browser subscription without registering it',async()=>{
 for(const mode of['abort','timeout']){
  const controller=new AbortController();let complete,cleaned=0;const browser=new Promise(resolve=>{complete=resolve;});
  const waiting=waitForSharedPush(browser,controller.signal,()=>{cleaned++;},mode==='timeout'?1:1000);if(mode==='abort')controller.abort();
  await assert.rejects(waiting,error=>mode==='abort'?error.name==='AbortError':error.message==='PUSH_CONNECTION_FAILED');complete({endpoint:'synthetic'});await Promise.resolve();assert.equal(cleaned,1);
 }
});
