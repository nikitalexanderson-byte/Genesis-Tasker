import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

/** User-visible trial activation against the real isolated API, with owned fixtures. */
export async function verifyTrialWeb317({browser,baseURL,output}) {
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL));
  const results=[],labels={standart:'Trial-Standart',premium:'Trial-Premium',business:'Trial-Business'};
  const save=()=>writeFileSync(`${output}/trial-results.json`,JSON.stringify({schemaVersion:1,results},null,2));
  const fresh=async fixture=>{
    const context=await browser.newContext({baseURL,viewport:{width:390,height:900},locale:'ru-RU',timezoneId:'Europe/Moscow'});
    await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
    await context.addInitScript(origin=>{if(location.origin===origin)localStorage.setItem('genesis-language-v1','ru');},baseURL);
    const response=await context.request.get(`/api/qa/login?tier=${fixture}`);
    assert(response.ok()&&(await response.json()).synthetic,'Only synthetic local users may be used');
    return context;
  };
  const session=async context=>{const r=await context.request.get('/api/session');assert.equal(r.status(),200);return r.json();};
  const reloadToday=async page=>{
    await page.goto('/#today');
    await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).waitFor();
    const live=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/session'&&response.status()===200);
    await page.reload();
    const profile=(await (await live).json()).user;
    assert(profile,'Synthetic account must be authenticated after reload');
    await page.waitForFunction(theme=>document.documentElement.getAttribute('data-genesis-theme')===theme,profile.theme??'standart');
  };
  const account=async(page,{reload=true}={})=>{
    if(reload)await reloadToday(page);
    await page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true}).click();
    const panel=page.locator('.account-panel');await panel.waitFor();
    await panel.locator('[data-settings-tab="account"]').click();return panel;
  };
  const openUpgrade=async(page,options)=>{
    const panel=await account(page,options);await panel.locator('.account-plan-upgrade button').click();
    const dialog=page.locator('.upgrade-dialog[open]');await dialog.locator('[data-dialog-header-host]').waitFor();return dialog;
  };
  const capture=async(page,id)=>{
    await page.screenshot({path:`${output}/${id}.png`,fullPage:true,animations:'disabled'});
    writeFileSync(`${output}/${id}.txt`,await page.locator('body').ariaSnapshot());
  };
  const check=async(plan,id,page,operation)=>{
    const key=`trial-${plan}-${id}`,started=performance.now();
    try {await operation();await capture(page,key);results.push({id:`web.${plan}.trial-${id}`,planId:plan,platformId:'web',subscriptionState:'trial',status:'PASS',durationMs:Math.round(performance.now()-started),evidence:[`${output}/${key}.png`,`${output}/${key}.txt`]});}
    catch(error){await capture(page,key+'-failure').catch(()=>{});results.push({id:`web.${plan}.trial-${id}`,planId:plan,platformId:'web',subscriptionState:'trial',status:'FAIL',error:error.message,evidence:[`${output}/${key}-failure.png`,`${output}/${key}-failure.txt`]});}
    save();console.log(`${results.at(-1).status} ${plan} trial-${id}`);
  };
  for(const [plan,label] of Object.entries(labels)) {
    const context=await fresh('trial-'+plan),page=await context.newPage();page.setDefaultTimeout(20000);
    const pageErrors=[],paymentRequests=[];let original;
    page.on('pageerror',error=>pageErrors.push(error.message));
    page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/billing/orders')paymentRequests.push('order');});
    try {
      if(plan==='premium') {
        for(const width of [360,390,768,1440])for(const theme of ['light','dark']) {
          await check(plan,`confirmation-${width}-${theme}`,page,async()=>{
            await page.setViewportSize({width,height:1000});await reloadToday(page);
            const desired=theme==='dark'?'standart-dark':'standart';
            if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)
              await page.getByRole('button',{name:theme==='dark'?'Включить тёмную тему':'Включить светлую тему',exact:true}).click();
            await page.waitForFunction(theme=>document.documentElement.getAttribute('data-genesis-theme')===theme,desired);
            await page.locator('.theme-mode-toggle[aria-busy="false"]').waitFor();
            const dialog=await openUpgrade(page,{reload:false});await dialog.locator(`.upgrade-plan-${plan} input`).check();
            await dialog.locator(`[data-trial-start="${plan}"]`).click();
            const confirm=dialog.locator(`[data-trial-confirm="${plan}"]`);await confirm.waitFor();
            assert((await dialog.innerText()).includes(label));
            const bounds=await confirm.boundingBox(),box=await dialog.boundingBox();
            assert(bounds&&bounds.width>=44&&bounds.height>=44,'Trial confirm requires a44px target');
            assert(box&&box.x>=-1&&box.x+box.width<=width+1,'Confirmation exceeds viewport');
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
            await capture(page,`trial-${plan}-confirmation-${width}-${theme}-before-cancel`);
            await dialog.locator('[data-trial-back]').click();
            assert.equal(await dialog.locator('[data-trial-confirm]').count(),0);
            const r=await context.request.get('/api/billing/catalog?client=web');assert.equal((await r.json()).trial.status,'available','Cancelling spent the one trial');
          });
        }
      }
      await check(plan,'activate-and-live-profile',page,async()=>{
        const dialog=await openUpgrade(page);await dialog.locator(`.upgrade-plan-${plan} input`).check();
        await dialog.locator(`[data-trial-start="${plan}"]`).click();
        const responsePromise=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/billing/trial'&&r.request().method()==='POST');
        await dialog.locator(`[data-trial-confirm="${plan}"]`).click();
        const response=await responsePromise;assert.equal(response.status(),200);
        const data=await response.json();original=data.trial;
        assert.equal(original.label,label);assert.equal(original.durationSeconds,259200);
        assert.equal((Date.parse(original.endsAt)-Date.parse(original.startsAt))/1000,259200);
        assert.equal(data.user.subscriptionPlan,'free');assert.equal(data.user.featureAccess.source,'trial');
        assert.equal(data.user.featureAccess.effectivePlan,plan);
        await page.locator('[data-subscription-trial="active"]').first().waitFor();
        assert((await page.locator('body').innerText()).includes(label));
      });
      await check(plan,'reload-keeps-server-window',page,async()=>{
        assert(original,'Activation prerequisite failed');await account(page);
        await page.locator('[data-subscription-trial="active"]').first().waitFor();
        const data=await session(context);assert.equal(data.user.trial.startsAt,original.startsAt);assert.equal(data.user.trial.endsAt,original.endsAt);
        assert.equal(data.user.trial.label,label);
        const dialog=await openUpgrade(page);assert.equal(await dialog.locator('[data-trial-start]').count(),0,'A used trial was offered again');
      });
      const second=await fresh('trial-'+plan),other=await second.newPage();
      try {
        await check(plan,'second-client-server-state',other,async()=>{
          assert(original,'Activation prerequisite failed');await account(other);
          await other.locator('[data-subscription-trial="active"]').first().waitFor();
          const data=await session(second);assert.equal(data.user.trial.endsAt,original.endsAt);assert.equal(data.user.trial.startsAt,original.startsAt);
          assert.equal(data.user.featureAccess.effectivePlan,plan);assert((await other.locator('body').innerText()).includes(label));
        });
      } finally {await second.close();}
      await check(plan,'no-charge-and-no-uncaught-error',page,async()=>{assert.deepEqual(paymentRequests,[]);assert.deepEqual(pageErrors,[]);});
    } finally {await context.close();}
  }
  const context=await fresh('trial-soon'),page=await context.newPage();page.setDefaultTimeout(25000);
  try {
    await check('business','server-expiry-payment-clock-rollback',page,async()=>{
      const runtime=process.env.GENESIS_QA_BACKEND_RUNTIME,php=process.env.GENESIS_QA_PHP;
      assert(runtime&&php,'Owned runtime/php is required for expiry fixture');
      const seeded=JSON.parse(execFileSync(php,['-d','disable_functions=curl_exec,mail','scripts/qa/backend-control.php',`--dir=${runtime}`,'--tier=trial-soon','--action=seed-trial','--plan=business','--expires-in=20'],{encoding:'utf8',windowsHide:true}));
      assert(seeded.fixtureAssigned);assert.equal((Date.parse(seeded.trial.endsAt)-Date.parse(seeded.trial.startsAt))/1000,259200);
      await account(page);await page.locator('[data-subscription-trial="active"]').first().waitFor();
      await page.locator('.account-panel .account-plan-upgrade button').click();
      const alreadyOpen=page.locator('.upgrade-dialog[open]');
      await alreadyOpen.locator('.upgrade-plan-standart input').check();
      assert.equal(await alreadyOpen.locator('.upgrade-plan-standart input').isChecked(),true);
      await page.evaluate(()=>{globalThis.__qaTrialOriginalNow=Date.now;Date.now=()=>946684800000;});
      await page.locator('[data-subscription-trial="expired"]').first().waitFor({timeout:40000});
      const data=await session(context);assert.equal(data.user.trial.status,'expired');assert.equal(data.user.featureAccess.effectivePlan,'free');
      const csrf=data.csrf;
      const denied=await context.request.post('/api/stoicheion/draws',{headers:{'X-CSRF-Token':csrf,Origin:baseURL},data:{kind:'timeline',seed:20261103}});
      assert.equal(denied.status(),403,'Server accepted a paid operation after deadline');
      const dialog=page.locator('.upgrade-dialog[open]');await dialog.waitFor();
      assert.equal(await dialog.locator('.upgrade-plan-business input').isChecked(),true,'Expiry payment did not select original trial plan');
      assert.equal(await dialog.locator('[data-trial-start]').count(),0);
      await page.evaluate(()=>{Date.now=globalThis.__qaTrialOriginalNow;delete globalThis.__qaTrialOriginalNow;});
    });
  } finally {await context.close();}
  return results;
}
