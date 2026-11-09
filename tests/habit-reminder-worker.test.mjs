import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
const source=fs.readFileSync(new URL('../public/habit-reminder-worker.js',import.meta.url),'utf8');
const origin='https://genesiscalendar.com/',userId='synthetic-habit-user',id='11111111-1111-4111-8111-111111111111',receiptKey='a'.repeat(64);
function fixture({stores=new Map(),status=200,allowed=true,failShow=false,snoozeStatus=200,sessionUser=userId}={}){
 const events=new Map(),shown=[],requests=[],opened=[];
 const cache={match:async key=>stores.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>stores.set(typeof key==='string'?key:key.url,response),
  delete:async key=>stores.delete(typeof key==='string'?key:key.url),keys:async()=>[...stores.keys()].map(url=>new Request(url))};
 const self={registration:{scope:origin,showNotification:async(title,options)=>{if(failShow)throw Error('Synthetic OS failure');shown.push({title,...options});}},
  clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},addEventListener:(name,callback)=>events.set(name,callback)};
 const target={id:'opaque-occurrence',kind:'habit',date:'2026-10-17',at:'2026-10-17T09:00:00.000Z',habitId:'opaque-habit',ruleId:'opaque-rule',action:'complete',timeZone:'UTC',allowDuringQuietHours:false};
 runInNewContext(source,{self,URL,Request,Response,crypto,caches:{open:async()=>cache},fetch:async(url,options)=>{
  const path=new URL(url).pathname;requests.push({path,options});
  const result=path==='/api/session'?{user:{uid:sessionUser},csrf:'synthetic-csrf'}:path.endsWith('/snooze')?{ok:true}
   :{userId,target,receiptKey,displayAllowed:allowed,message:{deliveryId:id,body:'Neutral translated copy',lang:'de',kind:'habit',primaryLabel:'Done',snoozeLabel:'Snooze',url:`${origin}?habitNotice=${id}#habits`}};
  return new Response(JSON.stringify(result),{status:path.endsWith('/snooze')?snoozeStatus:path==='/api/session'?200:status});
 }});
 const dispatch=async(name,event)=>{let work;events.get(name)({...event,waitUntil:promise=>{work=promise;}});await work;};
 const push=()=>dispatch('push',{data:{json:()=>({channel:'habit',deliveryId:id})}});
 const click=action=>dispatch('notificationclick',{notification:{data:{habitDeliveryId:id,userId},close(){}},action});
 const message=async(data,clientUrl=origin)=>{let answer;await dispatch('message',{data,source:{url:clientUrl},ports:[{postMessage:value=>{answer=value;}}]});return answer;};
 return {stores,shown,requests,opened,push,click,message,dispatch};
}
test('personal push uses live cookie access and durable receipts across retries, concurrent delivery and worker restart',async()=>{
 const worker=fixture();await Promise.all([worker.push(),worker.push()]);assert.equal(worker.shown.length,1);
 assert.equal(worker.requests[0].options.credentials,'include');assert.equal(worker.requests[0].options.cache,'no-store');
 assert.equal(worker.shown[0].actions.length,2);assert.equal(worker.shown[0].data.userId,userId);
 const restarted=fixture({stores:worker.stores});await restarted.push();assert.equal(restarted.shown.length,0);
});
test('revoked access and obsolete projections cannot display a delivered push',async()=>{
 for(const options of [{status:403},{allowed:false}]){const worker=fixture(options);await worker.push();assert.equal(worker.shown.length,0);}
});
test('open-tab fallback and background transport reserve the same event before display',async()=>{
 const worker=fixture();const request={type:'GENESIS_HABIT_EVENT_RECEIPT',userId,key:receiptKey,action:'reserve'};
 assert.equal(await worker.message(request),true);await worker.push();assert.equal(worker.shown.length,0);
 await worker.message({...request,action:'commit'});assert.equal(await worker.message(request),false);
 assert.equal(await worker.message({...request,key:'b'.repeat(64)},'https://outside.invalid/'),undefined);
});
test('OS display errors release the event reservation for a later push retry',async()=>{
 const worker=fixture({failShow:true});await worker.push();assert.equal(worker.shown.length,0);
 const retry=fixture({stores:worker.stores});await retry.push();assert.equal(retry.shown.length,1);
});
test('primary action is a persisted minimal intent, scoped to the account and acknowledged only after app processing',async()=>{
 const worker=fixture();await worker.click('primary');assert.equal(worker.opened.length,1);
 const intentId=new URL(worker.opened[0]).searchParams.get('habitIntent');assert.ok(intentId);
 const restarted=fixture({stores:worker.stores});
 const request={type:'GENESIS_HABIT_INTENT',userId,id:intentId};
 assert.equal(await restarted.message({...request,userId:'other-account'}),null);
 const intent=await restarted.message(request);assert.equal(intent.action,'primary');assert.equal(intent.deliveryId,id);
 assert.deepEqual(Object.keys(intent).sort(),['action','deliveryId','receivedAt','userId']);
 assert.equal((await restarted.message(request)).deliveryId,id);
 await restarted.message({...request,type:'GENESIS_HABIT_INTENT_ACK'});assert.equal(await restarted.message(request),null);
});
test('snooze uses authenticated CSRF, while offline or changed-account actions open a retryable intent',async()=>{
 const worker=fixture();await worker.click('snooze');assert.equal(worker.opened.length,0);
 const request=worker.requests.find(value=>value.path.endsWith('/snooze'));assert.equal(request.options.headers['X-CSRF-Token'],'synthetic-csrf');
 for(const options of [{snoozeStatus:409},{sessionUser:'other-user'}]){
  const failed=fixture(options);await failed.click('snooze');assert.equal(failed.opened.length,1);
  if(options.sessionUser)assert.equal(failed.requests.filter(value=>value.path.endsWith('/snooze')).length,0);
 }
});
