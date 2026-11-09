import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { verifySharedRetention } from './web-shared-retention.mjs';

const baseURL=process.env.GENESIS_QA_WEB_ORIGIN, output=process.env.GENESIS_QA_WEB_OUTPUT;
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''),'Owned loopback origin required');
assert(output,'Owned output required');
const tiers=process.env.GENESIS_QA_TIERS?.split(',')??['business','premium4life'];
assert(tiers.length>0&&tiers.every(tier=>['business','premium4life'].includes(tier)),'Collaboration tiers required');
const results=[], browser=await chromium.launch({headless:true});
try {
  for(const tier of tiers){
    const context=await browser.newContext({baseURL,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
    let page;
    const pageErrors=[];
    try {
      await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
      await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
      const login=await context.request.get(`/api/qa/login?tier=${tier}`);assert(login.ok()&&(await login.json()).synthetic);
      page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>pageErrors.push(error.message));
      await verifySharedRetention({context,page,tier,output,baseURL});
      assert.deepEqual(pageErrors,[]);
      results.push({id:`web.${tier}.shared-existing-after-downgrade`,status:'PASS',planId:tier});
    } catch(error){
      if(page)await page.screenshot({path:path.join(output,`${tier}-retention-failure.png`),fullPage:true}).catch(()=>{});
      results.push({id:`web.${tier}.shared-existing-after-downgrade`,status:'FAIL',planId:tier,error:error.message,pageErrors});
    } finally { await context.close(); }
    writeFileSync(path.join(output,'results.json'),JSON.stringify({platform:'web',scope:'retention',results},null,2));
    console.log(`${results.at(-1).status} ${tier} shared-existing-after-downgrade`);
  }
} finally { await browser.close(); }
if(results.some(row=>row.status!=='PASS'))process.exitCode=1;
