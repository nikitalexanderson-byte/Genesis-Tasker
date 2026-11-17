import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

// Requires the explicitly opted-in, synthetic qa:serve fixture. Never authenticates to production.
const origin=new URL(process.argv.find(value=>value.startsWith('--origin='))?.slice(9)??'http://127.0.0.1:4380');
assert.ok(['127.0.0.1','localhost','[::1]'].includes(origin.hostname)&&!origin.username&&!origin.password,'Loopback fixture required');
const output=process.argv.find(value=>value.startsWith('--output='))?.slice(9)??'output/qa/paddle-readiness';
assert.equal(existsSync(output),false,'Fresh acceptance output required');
mkdirSync(output,{recursive:true});
const copy=JSON.parse(readFileSync(new URL('../../app/public-product-copy.json',import.meta.url),'utf8'));
const report={languages:[],publicLayouts:[],documents:[],invitation:null,referralLayouts:[],eligibility:[]};
const browser=await chromium.launch({headless:true});
try{
  const publicContext=await browser.newContext({locale:'en-US'}), page=await publicContext.newPage();
  await page.goto(origin.href);
  const languages=['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'];
  for(const [index,language]of languages.entries()){
    await page.locator('.welcome-language-flags [role=radio]').nth(index).click();
    await page.waitForFunction(text=>document.querySelector('#pricing h2')?.textContent===text,copy[language].pricing);
    assert.equal(await page.locator('.public-price').count(),4);
    assert.equal(await page.locator('.public-footer').getByRole('link',{name:'demiurge.soft@gmail.com'}).count(),1);
    report.languages.push(language);
  }
  await page.getByRole('radio',{name:'English',exact:true}).click();
  for(const [target,label]of [['pricing',copy.en.pricing],['features',copy.en.features]]){
    await page.locator('.welcome-nav').getByRole('link',{name:label,exact:true}).click();
    await page.waitForFunction(id=>Math.abs(document.getElementById(id).getBoundingClientRect().top)<innerHeight,target);
  }
  await page.locator('.public-footer').getByRole('link',{name:copy.en.terms,exact:true}).click();
  await page.locator('.public-merchant').getByText(copy.en.merchantTitle,{exact:true}).waitFor();
  assert.equal(await page.locator('.welcome-auth').count(),0,'Terms required sign in');await page.goto(origin.href);
  await page.locator('.welcome-language-flags').waitFor();
  await page.locator('.public-previews').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('.public-previews img').count(),20);
  await page.locator('.public-previews img').first().evaluate(image=>image.decode());
  assert.equal(await page.locator('.public-previews img').first().evaluate(image=>image.complete&&image.naturalWidth>0),true);
  assert.equal(await page.locator('.public-previews img[loading="lazy"]').count(),20);
  for(const colorScheme of ['light','dark'])for(const width of [360,390,768,1440]){
    await page.emulateMedia({colorScheme});await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const path=`${output}/public-${width}-${colorScheme}.png`;await page.screenshot({path,fullPage:true,animations:'disabled'});
    report.publicLayouts.push({width,colorScheme,path});
  }
  await page.setViewportSize({width:390,height:1000});
  await page.goto(new URL('/login#sign-in',origin).href);await page.locator('.welcome-language-flags').waitFor();
  await page.waitForFunction(()=>Math.abs(document.getElementById('sign-in').getBoundingClientRect().top)<innerHeight);
  assert.equal(new URL(page.url()).hash,'#sign-in','App routing overwrote the public sign-in anchor');
  const rawContext=await browser.newContext({javaScriptEnabled:false}), raw=await rawContext.newPage();
  for(const path of ['/','/terms','/privacy','/refund','/support','/delete-account']){
    const response=await raw.goto(new URL(path,origin).href);assert.equal(response.status(),200,path);
    const text=await raw.locator('body').innerText();assert.ok(text.includes('Iurii Logvinov')&&text.includes('demiurge.soft@gmail.com'),path);
    const titles={'/terms':'Пользовательское соглашение','/privacy':'Политика конфиденциальности','/refund':'Refund Policy','/support':'Поддержка GENESIS','/delete-account':'Удаление аккаунта и данных'};
    if(path!=='/')assert.equal(await raw.locator('h1').innerText(),titles[path],'Public document path served the homepage');
    if(path==='/'){assert.equal(await raw.locator('#pricing').count(),1);assert.equal(await raw.locator('#features').count(),1);}
    if(path==='/refund')assert.match(text,/14/);
    report.documents.push({path,status:response.status(),withoutJavaScript:true});
  }
  await rawContext.close();await publicContext.close();

  const context=await browser.newContext({locale:'ru-RU'}), owner=await context.newPage();
  await owner.goto(new URL('/api/qa/login?tier=premium',origin).href);await owner.goto(origin.href);
  await owner.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
  await owner.getByRole('button',{name:'Аккаунт GENESIS',exact:true}).click();
  const panel=owner.locator('.referral-panel');await panel.waitFor();
  const create=panel.getByRole('button',{name:'Создать ссылку приглашения',exact:true});
  await create.or(panel.locator('input').first()).waitFor();
  if(await create.count())await create.click();
  await panel.locator('input').first().waitFor();const code=await panel.locator('input').first().inputValue();
  assert.match(code,/^g_[a-f0-9]{20}$/);const link=await panel.locator('input').nth(1).inputValue();
  assert.equal(new URL(link).origin,origin.origin);
  for(let attempt=0;attempt<3;attempt++){
    const anonymousContext=await browser.newContext({locale:'ru-RU'}), anonymous=await anonymousContext.newPage();
    const errors=[];anonymous.on('response',response=>{if(response.url().includes('/referrals/invitation')&&response.status()>=400)errors.push(response.status());});
    let release;const gate=new Promise(resolve=>{release=resolve;});
    await anonymous.route('**/api/referrals/invitation',async route=>{if(route.request().method()==='GET')await gate;await route.continue();});
    await anonymous.goto(link);const signIn=anonymous.getByRole('button',{name:'Войти через Google',exact:true});await signIn.waitFor();
    assert.equal(await signIn.isDisabled(),true,'Google entry raced before invitation capture');release();
    await anonymous.locator('.partner-invitation [role=status]').waitFor();assert.equal(await signIn.isEnabled(),true);
    const response=await anonymous.request.get(new URL('/api/referrals/invitation',origin).href);
    assert.equal(response.status(),200);assert.equal((await response.json()).accepted,true);assert.deepEqual(errors,[]);
    assert.equal((await anonymous.request.get(new URL('/api/referrals/me',origin).href)).status(),401,'Anonymous capture exposed a private dashboard');
    await anonymousContext.close();
  }
  report.invitation={codeCreated:true,anonymousFreshContexts:3,captured:true};
  for(const tier of ['free','standart','premium','business','premium4life']){
    const gateContext=await browser.newContext(), actor=await gateContext.newPage();
    await actor.goto(new URL(`/api/qa/login?tier=${tier}`,origin).href);
    const session=await(await actor.request.get(new URL('/api/session',origin).href)).json();
    const response=await actor.request.post(new URL('/api/referrals/code',origin).href,{headers:{'X-CSRF-Token':session.csrf},data:{}});
    assert.equal(response.status(),['free','standart'].includes(tier)?403:200,`Invitation access for ${tier}`);
    report.eligibility.push({tier,status:response.status()});await gateContext.close();
  }
  for(const scheme of ['light','dark']){
    await owner.getByRole('button',{name:'Оформление',exact:true}).click();
    await owner.getByRole('radio',{name:scheme==='dark'?'Тёмная':'Светлая',exact:true}).click();
    await owner.getByRole('button',{name:'Аккаунт GENESIS',exact:true}).click();await panel.waitFor();
    for(const width of [360,390,768,1440]){
      await owner.setViewportSize({width,height:1000});await panel.scrollIntoViewIfNeeded();
      assert.equal(await panel.evaluate(element=>element.scrollWidth>element.clientWidth+1),false);
      const path=`${output}/referrals-${width}-${scheme}.png`;await panel.screenshot({path,animations:'disabled'});
      report.referralLayouts.push({width,scheme,path});
    }
  }
  await context.close();writeFileSync(`${output}/results.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({languages:report.languages.length,publicLayouts:report.publicLayouts.length,documents:report.documents.length,
    invitation:report.invitation,referralLayouts:report.referralLayouts.length,eligibility:report.eligibility}));
}finally{await browser.close();}
