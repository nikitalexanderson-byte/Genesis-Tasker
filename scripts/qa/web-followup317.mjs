import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {chromium} from 'playwright';
import {verifyCalendarVisual317} from './web-calendar-visual317.mjs';
import {runSharedInbox} from './web-shared-inbox.mjs';

const baseURL=process.env.GENESIS_QA_WEB_ORIGIN,output=process.env.GENESIS_QA_WEB_OUTPUT;
const scope=process.env.GENESIS_QA_FOLLOWUP_SCOPE??'all';
assert(['all','calendar'].includes(scope),'Unknown focused scope');
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''),'Owned loopback runtime required');
assert(output,'Owned output required');
const results=[],errors=[];
const save=()=>writeFileSync(path.join(output,'results.json'),JSON.stringify({platform:'web',scope:'Focused 3.1.7 age/deity and shared-inbox regressions',results,errors},null,2));
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
  try {
    await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
    await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
    const login=await context.request.get('/api/qa/login?tier=business');assert(login.ok()&&(await login.json()).synthetic);
    const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto('/#habits');await page.getByRole('button',{name:'Новая привычка',exact:true}).waitFor();
    const snapshot=async id=>{await page.screenshot({path:path.join(output,`business-${id}.png`),fullPage:true,animations:'disabled'});writeFileSync(path.join(output,`business-${id}.txt`),await page.locator('body').ariaSnapshot());};
    const check=async(id,operation)=>{
      try{await operation();results.push({id:`web.business.${id}`,planId:'business',platformId:'web',status:'PASS'});}
      catch(error){await snapshot(id+'-failure').catch(()=>{});results.push({id:`web.business.${id}`,planId:'business',platformId:'web',status:'FAIL',error:error.message});await page.reload({waitUntil:'domcontentloaded'});}
      save();console.log(`${results.at(-1).status} business ${id}`);
    };
    await verifyCalendarVisual317({context,page,tier:'business',output,check,snapshot});
  } finally {await context.close();}
} finally {await browser.close();}
if(scope==='all'){
  const inboxOutput=path.join(output,'shared-inbox');mkdirSync(inboxOutput,{recursive:true});
  const inbox=await runSharedInbox({baseURL,output:inboxOutput,runtime:process.env.GENESIS_QA_BACKEND_RUNTIME,php:process.env.GENESIS_QA_PHP,tiers:['business']});
  for(const row of inbox.cases??[])results.push({...row,platformId:'web'});
  if(inbox.status!=='PASS')results.push({id:'web.business.shared-inbox-coverage',planId:'business',platformId:'web',status:'FAIL',error:'See shared-inbox/results.json'});
}
save();
if(errors.length||results.some(row=>row.status!=='PASS'))process.exitCode=1;
