import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const origin='http://127.0.0.1:4380';
const output=process.argv[2]??'output/playwright/referral-access-335';
mkdirSync(output,{recursive:true});
const copy=JSON.parse(readFileSync('app/referral-copy.json','utf8')).ru;
const report={access:[],layouts:[],networkRecovery:false,staleActionsCleared:false};
const browser=await chromium.launch({headless:true});
try {
  const context=await browser.newContext({locale:'ru-RU'}),page=await context.newPage();
  for(const tier of ['free','standart','premium','business','premium4life'])for(const identity of ['primary','linked']){
    await page.goto(`${origin}/api/qa/login?tier=${tier}&identity=${identity}`);
    const response=await page.request.get(`${origin}/api/referrals/me`);
    const body=await response.json();
    assert.equal(response.status(),tier==='free'||identity==='linked'?403:200);
    if(identity==='linked')assert.equal(body.error,'REFERRAL_PRIMARY_GOOGLE_REQUIRED');
    else if(tier==='free')assert.equal(body.error,'REFERRAL_STANDARD_REQUIRED');
    else assert.equal(body.monthlyLimit,10);
    report.access.push({tier,identity,status:response.status()});
  }
  await page.goto(`${origin}/api/qa/login?tier=premium&identity=linked`);
  await page.goto(origin);
  await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
  await page.getByRole('button',{name:'Аккаунт GENESIS',exact:true}).click();
  const panel=page.locator('.referral-panel');
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByRole('alert').innerText(),copy.primaryRequired);
  assert.equal(await panel.getByRole('button',{name:copy.retry,exact:true}).count(),0);
  assert.equal(await panel.getByRole('button',{name:copy.create,exact:true}).count(),0);
  for(const scheme of ['light','dark']) {
    await page.getByRole('button',{name:'Оформление',exact:true}).click();
    await page.getByRole('radio',{name:scheme==='dark'?'Тёмная':'Светлая',exact:true}).click();
    await page.getByRole('button',{name:'Аккаунт GENESIS',exact:true}).click();
    await panel.getByRole('alert').waitFor();
    for(const width of [360,390,768,1440]) {
      await page.setViewportSize({width,height:1000});
      await panel.getByRole('alert').scrollIntoViewIfNeeded();
      assert.equal(await panel.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
      const path=`${output}/linked-${scheme}-${width}.png`;
      await panel.screenshot({path,animations:'disabled'});report.layouts.push({width,scheme,path});
    }
  }
  await page.goto(`${origin}/api/qa/login?tier=premium`);
  let failures=1;
  await page.route('**/api/referrals/me',async route=>{if(failures-- >0)await route.abort();else await route.continue();});
  await page.goto(origin);
  await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
  await page.getByRole('button',{name:'Аккаунт GENESIS',exact:true}).click();
  await panel.getByRole('button',{name:copy.retry,exact:true}).click();
  await panel.getByRole('button',{name:copy.create,exact:true}).waitFor();report.networkRecovery=true;
  // Simulate an access denial after the dashboard loaded; real identity denial is checked above.
  await page.route('**/api/referrals/code',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'REFERRAL_PRIMARY_GOOGLE_REQUIRED'})}));
  await panel.getByRole('button',{name:copy.create,exact:true}).click();
  await panel.getByRole('alert').waitFor();
  assert.equal(await panel.getByRole('alert').innerText(),copy.primaryRequired);
  assert.equal(await panel.getByRole('button',{name:copy.create,exact:true}).count(),0);
  assert.equal(await panel.getByRole('button',{name:copy.retry,exact:true}).count(),0);
  report.staleActionsCleared=true;
  writeFileSync(`${output}/results.json`,JSON.stringify({...report,status:'PASS'},null,2));
  console.log(JSON.stringify({status:'PASS',access:report.access.length,layouts:report.layouts.length,networkRecovery:report.networkRecovery,staleActionsCleared:report.staleActionsCleared}));
} finally {await browser.close();}
