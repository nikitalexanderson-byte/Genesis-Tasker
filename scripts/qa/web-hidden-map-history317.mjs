import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
const baseURL=process.env.GENESIS_QA_WEB_ORIGIN,output=process.env.GENESIS_QA_WEB_OUTPUT;
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??'')&&output);
const tiers=(process.env.GENESIS_QA_TIERS??'free').split(',');
const browser=await chromium.launch({headless:true}),results=[];
const history=page=>page.evaluate(()=>({length:window.history.length,view:window.history.state?.genesisView??null,mapTask:window.history.state?.genesisMindmapTaskPanel??false}));
try {
 for(const tier of tiers) {
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU'});
  await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
  await context.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('genesis-language-v1','ru');},baseURL);
  const login=await context.request.get('/api/qa/login?tier='+tier);assert((await login.json()).synthetic);
  const page=await context.newPage();page.setDefaultTimeout(20000);const title='Synthetic history '+tier;
  let before,opened,closed,error;
  try {
   await page.goto('/#today');await page.waitForLoadState('networkidle');
   await page.getByRole('button',{name:'Создать задачу',exact:true}).first().click();
   const composer=page.getByRole('dialog',{name:'Создать · Личное дело',exact:true});
   await composer.getByRole('textbox',{name:'Новая задача',exact:true}).fill(title);
   await composer.getByRole('button',{name:'Добавить задачу',exact:true}).click();await composer.waitFor({state:'hidden'});
   await page.getByRole('button',{name:`Редактировать задачу «${title}»`,exact:true}).waitFor();
   // This is the URL left by navigating from an open map to Today; no map data is fabricated.
   await page.goto('/?mindmap=qa-hidden-map#today');await page.waitForLoadState('networkidle');
   before=await history(page);assert.equal(before.view,'today');
   await page.getByRole('button',{name:`Редактировать задачу «${title}»`,exact:true}).click();
   const editor=page.getByRole('dialog',{name:'Задача и её контекст',exact:true});await editor.waitFor();
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   opened=await history(page);
   await page.screenshot({path:`${output}/${tier}-hidden-map-editor.png`,fullPage:true,animations:'disabled'});
   await editor.getByRole('button',{name:'Отмена',exact:true}).click();await editor.waitFor({state:'hidden'});
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));closed=await history(page);
   assert.equal(opened.mapTask,false,'Today editor incorrectly adopted hidden mindmap history');
   assert.equal(opened.length,before.length,'Opening Today editor added a hidden-map history entry');
   assert.equal(closed.view,'today');assert.equal(closed.mapTask,false);
   // A second ordinary click must open the same stored task after close, without a history race.
   await page.getByRole('button',{name:`Редактировать задачу «${title}»`,exact:true}).click();await editor.waitFor();
   await editor.getByRole('textbox',{name:'Название',exact:true}).fill(title+' changed');
   await editor.getByRole('button',{name:/^Сохранить(?: задачу)?$/}).click();await editor.waitFor({state:'hidden'});
   await page.reload();await page.getByRole('button',{name:`Редактировать задачу «${title} changed»`,exact:true}).waitFor();
  } catch(cause){error=cause.message;}
  finally {results.push({id:`web.${tier}.today-editor-hidden-map-history`,planId:tier,platformId:'web',status:error?'FAIL':'PASS',before,opened,closed,error:error??null});writeFileSync(output+'/results.json',JSON.stringify({scope:'Today task editor must not own hidden map navigation; synthetic ordinary users',results},null,2));await context.close();}
  console.log(`${results.at(-1).status} ${tier} Today editor hidden-map history`);
 }
} finally {await browser.close();}
if(results.some(row=>row.status!=='PASS'))process.exitCode=1;
