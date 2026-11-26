import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
async function bounded(promise,label){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error(label)),20000))]);}
 finally{clearTimeout(timer);}
}
export async function verifyLatestMindmapSave({page,secondContext,output,tier}){
 const expected='Карта синтетического теста — сохранённое описание 🌱.';
 const path=`/api/mindmaps/${new URL(page.url()).searchParams.get('mindmap')}`;
 const firstEntered=deferred(),firstRelease=deferred(),secondEntered=deferred(),secondRelease=deferred();
 const writes=[],routingErrors=[];
 const routePattern=`**${path}`;
 const handler=async route=>{
  if(route.request().method()!=='PUT')return route.continue();
  const request=route.request().postDataJSON();writes.push(request);
  try{
   if(writes.length===1){const upstream=await route.fetch();firstEntered.resolve();await firstRelease.promise;await route.fulfill({response:upstream});}
   else if(writes.length===2){secondEntered.resolve();await secondRelease.promise;await route.continue();}
   else await route.continue();
  }catch(error){routingErrors.push(error.message);firstEntered.resolve();secondEntered.resolve();await route.abort().catch(()=>{});}
 };
 await page.route(routePattern,handler);
 try{
  await page.getByRole('button',{name:'Настройка карты',exact:true}).click();
  const description=page.getByRole('textbox',{name:'Описание',exact:true});
  await description.fill('Предыдущее описание: ответ сервера задержан.');
  await bounded(firstEntered.promise,'First map upload did not reach the controlled response gate');assert.deepEqual(routingErrors,[]);
  await description.fill(expected);
  await page.evaluate(()=>{
   const node=document.querySelector('.mindmap-save-state');
   window.__mapSaveStates=[node.dataset.saveState];
   window.__mapSaveObserver=new MutationObserver(records=>{
    for(const record of records)window.__mapSaveStates.push(record.oldValue);
    window.__mapSaveStates.push(node.dataset.saveState);
   });
   window.__mapSaveObserver.observe(node,{attributes:true,attributeFilter:['data-save-state'],attributeOldValue:true});
  });
  firstRelease.resolve();await bounded(secondEntered.promise,'Latest edit did not reach its own upload gate');assert.deepEqual(routingErrors,[]);
  const states=await page.evaluate(()=>window.__mapSaveStates);
  assert.equal(states.includes('synced'),false,'An earlier response transiently acknowledged an unsent edit');
  assert.notEqual(await page.locator('.mindmap-save-state').getAttribute('data-save-state'),'synced');
  assert.equal(await description.inputValue(),expected);
  assert.equal(writes.length,2);assert.equal(writes[1].expectedRevision,writes[0].expectedRevision+1);
  const acknowledged=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='PUT'&&
   response.request().postDataJSON().operationId===writes[1].operationId&&response.ok());
  secondRelease.resolve();const response=await acknowledged;
  assert.equal((await response.json()).revision,writes[1].expectedRevision+1);
  await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
  await page.evaluate(()=>window.__mapSaveObserver.disconnect());
  const other=await secondContext.newPage();await other.goto(page.url());
  await other.getByRole('button',{name:'Настройка карты',exact:true}).click();
  assert.equal(await other.getByRole('textbox',{name:'Описание',exact:true}).inputValue(),expected);
  await other.screenshot({path:`${output}/${tier}-mindmap-edit-second-client.png`,fullPage:true});
  return{states,writes:writes.map(({expectedRevision,operationId})=>({expectedRevision,operationId})),secondClientDescription:expected};
 }finally{
  firstRelease.resolve();secondRelease.resolve();
  await page.unroute(routePattern,handler);
  await page.evaluate(()=>window.__mapSaveObserver?.disconnect()).catch(()=>{});
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const origin=process.env.GENESIS_QA_WEB_ORIGIN,output=process.env.GENESIS_QA_WEB_OUTPUT;
 assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin??'')&&output,'Owned loopback runtime required');
 const browser=await chromium.launch({headless:true}),errors=[],results=[];
 const newContext=async()=>{
  const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
  await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
  const login=await context.request.get('/api/qa/login?tier=premium');assert(login.ok()&&(await login.json()).synthetic);return context;
 };
 try{
  const context=await newContext(),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/#habits');await page.getByRole('button',{name:'Новая привычка',exact:true}).waitFor();
  await page.goto('/?affairs=personal&mindmap=catalog#projects');await page.locator('.mindmap-create-map').click();
  const create=page.getByRole('dialog',{name:'Новая карта',exact:true});
  await create.getByRole('textbox',{name:'Название карты',exact:true}).fill('QA ordered map acknowledgement');
  const initial=page.waitForResponse(response=>new URL(response.url()).pathname.startsWith('/api/mindmaps/')&&response.request().method()==='PUT'&&response.ok());
  await create.getByRole('button',{name:'Создать карту',exact:true}).click();await initial;
  await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
  for(let cycle=0;cycle<3;cycle++){
   const second=await newContext();
   try{results.push({cycle,status:'PASS',...await verifyLatestMindmapSave({page,secondContext:second,output,tier:`premium-${cycle}`})});}
   finally{await second.close();}
   await page.getByRole('dialog',{name:'Настройка карты',exact:true}).getByRole('button',{name:'Закрыть',exact:true}).click();
  }
  assert.deepEqual(errors,[]);console.log('PASS mindmap ordered acknowledgements and independent cold client: 3 cycles');
 }catch(error){results.push({status:'FAIL',error:error.stack});process.exitCode=1;console.error(error);}
 finally{writeFileSync(`${output}/results.json`,JSON.stringify({browser:browser.version(),results,errors},null,2));await browser.close();}
}
