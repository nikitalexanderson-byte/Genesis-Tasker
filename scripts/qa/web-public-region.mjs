import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

/** Isolated browser scenarios use synthetic coordinates and local fixture accounts. */
export async function verifyPublicRegions({browser,baseURL,output}) {
  const cases=[
    {id:'gps-ru-vpn',ip:'outside-RU',gps:{latitude:56.8389,longitude:60.6057},path:'/?lang=en#pricing',destination:'/?lang=en#pricing'},
    {id:'gps-only-document',ip:'unknown',gps:{latitude:56.8389,longitude:60.6057},path:'/support',destination:'/support'},
    {id:'foreign-gps-ru-ip',ip:'RU',gps:{latitude:40.7128,longitude:-74.006},path:'/?lang=en',destination:'/?lang=en',donation:true},
    {id:'ip-only-no-redirect',ip:'RU',path:'/?lang=ru',destination:'/?lang=ru',donation:true},
    {id:'unknown-region',ip:'unknown',path:'/?lang=en',destination:'/?lang=en',donation:true},
    {id:'suggestion-from-gps',ip:'outside-RU',gps:{latitude:56.8389,longitude:60.6057},path:'/',destination:'/',suggested:'ru'},
    {id:'suggestion-from-ip',ip:'RU',path:'/',destination:'/',suggested:'ru'},
  ];
  const results=[];
  for(const scenario of cases){
    const context=await browser.newContext({baseURL,locale:'en-US',serviceWorkers:'block',...(scenario.gps?{permissions:['geolocation'],geolocation:{...scenario.gps,accuracy:100}}:{})});
    let claims=0;
    await context.route(/https?:\/\//,route=>{
      const url=new URL(route.request().url());
      if(url.origin!==baseURL)return route.abort();
      if(url.pathname==='/api/billing/location')return route.fulfill({json:{source:'ip',region:scenario.ip}});
      if(url.pathname==='/api/account/support-notice'){claims++;return route.fulfill({json:{show:false,nextAt:'2099-01-01T00:00:00Z',cadence:'monthly'}});}
      return route.continue();
    });
    const page=await context.newPage(),started=performance.now(),evidence=output+'/public-region-'+scenario.id+'.png';
    try{
      if(scenario.id==='gps-ru-vpn'){
        const metadata=await context.request.get('/api/donations/methods');assert.equal(metadata.status(),200);
        assert.equal(metadata.headers()['set-cookie'],undefined,'Public options must not replace a login cookie');
        assert.deepEqual(await metadata.json(),{schemaVersion:1,region:'unknown',boosty:{available:false,url:null}});
      }
      await page.goto(scenario.path);
      await page.waitForURL(baseURL+scenario.destination);
      if(scenario.suggested){
        await page.locator(`html[lang="${scenario.suggested}"]`).waitFor({state:'attached'});
        assert.equal(await page.url(),baseURL+scenario.destination);
        const languages=page.getByRole('radio');
        await languages.first().waitFor({state:'attached'});
        assert.equal(await languages.count(),14);
        await page.getByRole('radio',{name:'Deutsch',exact:true}).click();
        await page.locator('html[lang="de"]').waitFor({state:'attached'});
        await page.goto('/');
        await page.locator('html[lang="de"]').waitFor({state:'attached'});
        await languages.first().waitFor({state:'attached'});
        assert.equal(await languages.count(),14);
      }
      const merchant=page.locator('.public-merchant').first();await merchant.waitFor();
      assert.match(await merchant.innerText(),/Nikita|Никита/);
      assert.match(await merchant.innerText(),/Iurii Logvinov/);
      assert.match(await merchant.innerText(),/772495179010/);
      if(scenario.path.includes('lang=')){
        await page.locator(`.public-plans[data-currency="${scenario.path.includes('lang=ru')?'RUB':'USD'}"]`).waitFor();
        assert.equal(await page.getByRole('radio').count(),14);
      }
      if(scenario.id==='gps-ru-vpn'){
        for(const language of ['en','ru'])for(const scheme of ['light','dark'])for(const width of [360,390,768,1440]){
          await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme:scheme});
          await page.goto('/?lang='+language+'#pricing');
          const footer=page.locator('.public-footer');await footer.waitFor();await page.evaluate(()=>document.fonts.ready);
          const geometry=await footer.evaluate(element=>({width:element.getBoundingClientRect().width,overflow:element.scrollWidth>element.clientWidth+1,viewport:document.documentElement.scrollWidth>innerWidth+1,details:[...element.querySelectorAll('.public-footer-details p')].map(p=>p.getBoundingClientRect().toJSON())}));
          assert.equal(geometry.overflow||geometry.viewport,false,`${language}/${scheme}/${width}: footer must fit`);
          const [a,b]=geometry.details;assert.ok(a&&b&&(b.y>=a.bottom-1||b.x>=a.right-1),'Performer and infrastructure blocks must not overlap');
          assert.match(await footer.innerText(),/772495179010/);
          assert.match(await footer.locator('a[href$="#pricing"]').getAttribute('href'),/\/#pricing|\/\?lang=ru#pricing/);
          await footer.screenshot({path:`${output}/footer-${language}-${scheme}-${width}.png`,animations:'disabled'});
        }
      }
      if(scenario.donation!==undefined){
        const login=await context.request.get('/api/qa/login?tier=free');
        assert(login.ok()&&(await login.json()).synthetic,'Use only a synthetic account');
        await page.goto('/?lang=en#today');
        // A hash-only navigation keeps the anonymous app instance alive after
        // the fixture login. Start the authenticated document explicitly.
        await page.reload();
        await page.locator('.genesis-page-footer').waitFor();await page.waitForLoadState('networkidle');
        const footer=page.locator('.genesis-page-footer');
        if(scenario.donation){
          await footer.locator('a[aria-haspopup="dialog"]').click();
          const donation=page.locator('.donation-method-dialog');await donation.waitFor();
          assert.equal(await donation.locator('[data-donation-method="cloudtips"]').isEnabled(),true);
          assert.equal(await donation.locator('[data-donation-method="boosty"]').isDisabled(),true);
          assert.doesNotMatch(await footer.innerText(),/only from Russia|только из России/i);
          await donation.locator('.dialog-close-button').click();
        }
        else {
          assert.equal(await footer.locator('a[href^="https://pay.cloudtips.ru/"]').count(),0);
          assert.equal(await footer.locator('button.genesis-donation-disabled').isDisabled(),true);
          assert.equal(await footer.locator('button.genesis-donation-disabled').getAttribute('href'),null);
          assert.equal(claims,0,'Unavailable donations must not claim a support popup');
        }
        if(scenario.id==='unknown-region'){
          // Let the saved account preference arrive before checking the URL's
          // public-document language. Anonymous rendering cannot catch this.
          for(const [path,language]of [['/terms?lang=en','en'],['/terms?lang=ru','ru'],['/ru/terms','ru']]){
            await page.goto(path);await page.locator('.legal-document').waitFor();await page.waitForLoadState('networkidle');
            assert.equal(await page.locator('html').getAttribute('lang'),language,'Document URL wins over the account language');
            const document=await page.locator('.legal-document').innerText();
            if(language==='en')assert.match(document,/Terms of (?:Use|Service)/i);
            assert.match(document,/772495179010/);
            assert.match(document,/RUB|рубл/iu);
            assert.match(document,language==='en'
              ? /For purchases through Paddle, Paddle is the Merchant of Record\./
              : /Для покупок через Paddle продавцом по сделке \(Merchant of Record\) выступает Paddle\./u);
            assert.match(document,language==='en'
              ? /Iurii Logvinov is the GENESIS supplier for Paddle sales and the sole recipient of the supplier payouts/
              : /Юрий Логвинов \(Iurii Logvinov\) — поставщик GENESIS по продажам через Paddle и единственный получатель/u);
            assert.equal(await page.locator('.legal-document a[href="https://www.paddle.com/legal/buyer-terms"]').count(),1);
          }
        }
      }
      await page.screenshot({path:evidence,fullPage:true,animations:'disabled'});
      results.push({id:'web.public-region.'+scenario.id,platformId:'web',status:'PASS',durationMs:Math.round(performance.now()-started),evidence:[evidence]});
    }catch(error){
      await page.screenshot({path:evidence,fullPage:true,animations:'disabled'}).catch(()=>{});
      results.push({id:'web.public-region.'+scenario.id,platformId:'web',status:'FAIL',error:error.message,evidence:[evidence]});
    }finally{await context.close();}
    console.log(results.at(-1).status+' public-region '+scenario.id+(results.at(-1).error?': '+results.at(-1).error:''));
  }
  writeFileSync(output+'/public-region-results.json',JSON.stringify(results,null,2));
  return results;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {chromium}=await import('playwright'),baseURL=process.env.GENESIS_QA_WEB_ORIGIN,output=process.env.GENESIS_QA_WEB_OUTPUT;if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??'')||!output)throw new Error('Owned isolated loopback services required');const browser=await chromium.launch({headless:true});try{const results=await verifyPublicRegions({browser,baseURL,output});if(results.some(row=>row.status!=='PASS'))process.exitCode=1;}finally{await browser.close();}
}
