import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {adviceNotificationPreferences,adviceTargetFromUrl} from '../app/advice-notifications.ts';
import {advicePreferences} from '../app/daily-advice.ts';

test('advice notification defaults require explicit opt-in and normalize cached time and zone',()=>{
  assert.equal(advicePreferences().notifications.enabled,false);
  assert.equal(adviceNotificationPreferences({enabled:'true',time:'25:80',timeZone:'invalid'}).enabled,false);
  assert.equal(adviceNotificationPreferences({time:'25:80'}).time,'09:00');
  assert.deepEqual(adviceNotificationPreferences({enabled:true,time:'21:30',timeZone:'Pacific/Kiritimati'}),{enabled:true,time:'21:30',timeZone:'Pacific/Kiritimati'});
});
test('notification links bind advice, civil day and collection, without accepting supplied content',()=>{
  const target={id:'advice-'+'a'.repeat(24),dayKey:'2026-11-01',collection:'philosophers'};
  const url=new URL('https://genesiscalendar.com/?advice='+target.id+'&adviceDay='+target.dayKey+'&adviceCollection='+target.collection+'#today');
  assert.deepEqual(adviceTargetFromUrl(url),target);
  for(const [key,value] of [['advice','../secret'],['adviceDay','2026-02-30'],['adviceCollection','unknown']]){
    const invalid=new URL(url);invalid.searchParams.set(key,value);assert.equal(adviceTargetFromUrl(invalid),null);
  }
  assert.equal(adviceTargetFromUrl('https://genesiscalendar.com/#today'),null);
});
test('advice notification controls and saved-entry states are translated in all fourteen app languages',()=>{
  const copy=JSON.parse(fs.readFileSync(new URL('../app/advice-notification-copy.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);
  for(const language of Object.values(copy)){
    assert.deepEqual(Object.keys(language).sort(),Object.keys(copy.ru).sort());
    assert.ok(Object.values(language).every(text=>typeof text==='string'&&text.trim()));
    assert.ok(language.zone.includes('{zone}'));
  }
});

const source=fs.readFileSync(new URL('../public/advice-notification-worker.js',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const clickSource=sw.slice(sw.indexOf('self.addEventListener("notificationclick"'));
const scope='https://genesiscalendar.com/app/',id='11111111-1111-4111-8111-111111111111';
const adviceId='advice-'+'a'.repeat(24),target=scope+'?advice='+adviceId+'&adviceDay=2026-11-01&adviceCollection=aurora#today';
function fixture({stores=new Map(),status=200,allowed=true,url=target,failShow=false,visible=false}={}){
  const events=new Map(),shown=[],requests=[],opened=[],navigated=[],posted=[];
  const cache={match:async key=>stores.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>stores.set(typeof key==='string'?key:key.url,response),
    delete:async key=>stores.delete(typeof key==='string'?key:key.url),keys:async()=>[...stores.keys()].map(url=>new Request(url))};
  const client={focus:async()=>{},navigate:async url=>navigated.push(url),postMessage:value=>posted.push(value)};
  const self={registration:{scope,showNotification:async(title,options)=>{if(failShow)throw Error('Synthetic OS error');shown.push({title,...options});}},
    clients:{matchAll:async()=>visible?[client]:[],openWindow:async url=>opened.push(url)},addEventListener:(name,callback)=>events.set(name,callback)};
  runInNewContext(source+'\n'+clickSource,{self,SCOPE:scope,URL,Request,Response,Date,caches:{open:async()=>cache},fetch:async(requestUrl,options)=>{
    requests.push({url:requestUrl,options});return new Response(JSON.stringify({displayAllowed:allowed,userId:'synthetic-user',message:{deliveryId:id,title:'Public advice title',body:'The exact persisted public advice body.',lang:'en',url}}),{status});
  }});
  const dispatch=async(name,event)=>{let work;events.get(name)({...event,waitUntil:promise=>{work=promise;}});await work;};
  const push=(payload={channel:'advice',deliveryId:id})=>dispatch('push',{data:{json:()=>payload}});
  const click=()=>dispatch('notificationclick',{notification:{data:{url,adviceDeliveryId:id},close(){}}});
  return{stores,shown,requests,opened,navigated,posted,push,click};
}
test('advice push uses cookie visibility checks and durable deduplication across concurrent delivery and restart',async()=>{
  const worker=fixture();await Promise.all([worker.push(),worker.push()]);
  assert.equal(worker.shown.length,1);assert.equal(worker.requests.length,1);
  assert.equal(worker.requests[0].options.credentials,'include');assert.equal(worker.requests[0].options.cache,'no-store');
  assert.ok(worker.requests[0].url.includes('/api/advice/notifications/deliveries/'));
  assert.equal(worker.shown[0].body,'The exact persisted public advice body.');
  assert.equal(worker.shown[0].data.url,target);assert.equal(worker.shown[0].data.adviceDeliveryId,id);
  const restarted=fixture({stores:worker.stores});await restarted.push();assert.equal(restarted.shown.length,0);
});
test('revoked access, foreign URLs, invalid targets and another notification channel cannot display advice',async()=>{
  for(const options of [{status:403},{allowed:false},{url:'https://outside.invalid/'},{url:'https://genesiscalendar.com/other/?advice='+adviceId},{url:scope+'?advice=bad&adviceDay=2026-11-01&adviceCollection=aurora'}]){
    const worker=fixture(options);await worker.push();assert.equal(worker.shown.length,0);
  }
  const worker=fixture();await worker.push({channel:'habit',deliveryId:id});assert.equal(worker.requests.length,0);
});
test('OS display failure leaves no receipt and a later retry can show the same advice',async()=>{
  const failed=fixture({failShow:true});await failed.push();assert.equal(failed.shown.length,0);
  const retry=fixture({stores:failed.stores});await retry.push();assert.equal(retry.shown.length,1);
});
test('notification click reuses the existing SW navigation and opens the exact saved-advice URL',async()=>{
  const closed=fixture();await closed.click();assert.deepEqual(closed.opened,[target]);
  const open=fixture({visible:true});await open.click();assert.deepEqual(open.navigated,[target]);assert.equal(open.opened.length,0);
  const foreign=fixture({url:'https://outside.invalid/'});await foreign.click();assert.equal(foreign.opened.length,0);
});
