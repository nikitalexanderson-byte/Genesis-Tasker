import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';

/** Isolated browser scenarios use synthetic coordinates and local fixture accounts. */
export async function verifyPublicRegions({browser,baseURL,output}) {
  const cases=[
    {id:'gps-ru-vpn',ip:'outside-RU',gps:{latitude:56.8389,longitude:60.6057},path:'/?lang=en#pricing',destination:'/ru/?lang=en#pricing',domestic:true},
    {id:'gps-only-document',ip:'unknown',gps:{latitude:56.8389,longitude:60.6057},path:'/support',destination:'/ru/support',domestic:true},
    {id:'foreign-gps-ru-ip',ip:'RU',gps:{latitude:40.7128,longitude:-74.006},path:'/?lang=en',destination:'/?lang=en',donation:false},
    {id:'ip-only-no-redirect',ip:'RU',path:'/?lang=ru',destination:'/?lang=ru',donation:true},
    {id:'unknown-region',ip:'unknown',path:'/?lang=en',destination:'/?lang=en',donation:false},
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
      await page.goto(scenario.path);
      await page.waitForURL(baseURL+scenario.destination);
      const merchant=page.locator('.public-merchant').first();await merchant.waitFor();
      assert.match(await merchant.innerText(),scenario.domestic?/Nikita|Никита/:/Iurii Logvinov/);
      if(!scenario.domestic)assert.doesNotMatch(await merchant.innerText(),/Nikita|Никита/);
      if(scenario.path.includes('lang=')){
        await page.locator('.public-plans[data-currency="USD"]').waitFor();
        assert.equal(await page.getByRole('radio').count(),14);
      }
      if(scenario.donation!==undefined){
        const login=await context.request.get('/api/qa/login?tier=free');
        assert(login.ok()&&(await login.json()).synthetic,'Use only a synthetic account');
        const regionResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/billing/location');
        await page.goto('/?lang=en#today');await regionResponse;
        await page.locator('.genesis-page-footer').waitFor();await page.waitForLoadState('networkidle');
        const footer=page.locator('.genesis-page-footer');
        if(scenario.donation)await footer.locator('a[href^="https://pay.cloudtips.ru/"]').waitFor();
        else {
          assert.equal(await footer.locator('a[href^="https://pay.cloudtips.ru/"]').count(),0);
          assert.equal(await footer.locator('button.genesis-donation-disabled').isDisabled(),true);
          assert.equal(await footer.locator('button.genesis-donation-disabled').getAttribute('href'),null);
          assert.equal(claims,0,'Unavailable donations must not claim a support popup');
        }
      }
      await page.screenshot({path:evidence,fullPage:true,animations:'disabled'});
      results.push({id:'web.public-region.'+scenario.id,platformId:'web',status:'PASS',durationMs:Math.round(performance.now()-started),evidence:[evidence]});
    }catch(error){
      await page.screenshot({path:evidence,fullPage:true,animations:'disabled'}).catch(()=>{});
      results.push({id:'web.public-region.'+scenario.id,platformId:'web',status:'FAIL',error:error.message,evidence:[evidence]});
    }finally{await context.close();}
    console.log(results.at(-1).status+' public-region '+scenario.id);
  }
  writeFileSync(output+'/public-region-results.json',JSON.stringify(results,null,2));
  return results;
}
