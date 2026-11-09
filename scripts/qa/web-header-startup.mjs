import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** Keep a real pointer press across deferred header loading; never retry a missed click. */
export async function runHeaderStartup({baseURL,output,browser}) {
  assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL??''),'Owned loopback origin required');
  mkdirSync(output,{recursive:true});
  const ownBrowser=!browser;
  browser??=await chromium.launch({headless:true});
  const report={scope:'deferred-header-pointer-stability',browser:browser.version(),cases:[]};
  const save=()=>writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
  try {
    for(const width of [360,390,768,1440])for(const scheme of ['light','dark']) {
      const row={id:`web.header-startup.${width}.${scheme}`,planId:'free',platformId:'web',width,scheme,status:'RUNNING'};
      report.cases.push(row);save();
      const context=await browser.newContext({baseURL,viewport:{width,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
      let release=()=>{};
      try {
        await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
        await context.addInitScript(()=>localStorage.setItem('genesis-language-v1','ru'));
        const login=await context.request.get('/api/qa/login?tier=free');assert(login.ok()&&(await login.json()).synthetic);
        const page=await context.newPage();page.setDefaultTimeout(15000);
        const errors=[];page.on('pageerror',error=>errors.push(error.message));
        // Persist the requested real theme first; the measured navigation uses that account preference.
        await page.goto('/#today');
        const theme=page.locator('.theme-mode-toggle:visible:not([disabled])').first();await theme.waitFor();
        const desired=scheme==='dark'?'standart-dark':'standart';
        if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)await theme.click();
        await page.waitForFunction(value=>document.documentElement.getAttribute('data-genesis-theme')===value,desired);
        await page.waitForFunction(()=>[...document.querySelectorAll('.theme-mode-toggle')].filter(node=>node.getClientRects().length).every(node=>node.getAttribute('aria-busy')!=='true'));
        await page.waitForLoadState('networkidle');
        const held=new Set(),routeErrors=[];
        let bothSeen;
        const seen=new Promise(resolve=>{bothSeen=resolve;});
        const gate=new Promise(resolve=>{release=resolve;});
        await page.route(/\/assets\/(?:NotificationDock|TodayBlockOrderDialog)-[^/]+\.js$/,async route=>{
          held.add(new URL(route.request().url()).pathname);if(held.size===2)bothSeen();
          await gate;
          await route.continue().catch(error=>routeErrors.push(error.message));
        });
        await page.goto(`/?header-case=${width}-${scheme}#today`,{waitUntil:'domcontentloaded'});
        let timer;
        try { await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Both deferred controls must be requested')),15000);})]); }
        finally {clearTimeout(timer);}
        const account=page.getByRole('button',{name:'Открыть личный кабинет и настройки',exact:true});await account.waitFor();
        await page.evaluate(()=>document.fonts.ready);
        const before=await account.boundingBox();assert(before);
        const point={x:before.x+before.width/2,y:before.y+before.height/2};
        await page.screenshot({path:path.join(output,`${width}-${scheme}-held.png`),fullPage:true,animations:'disabled'});
        await page.mouse.move(point.x,point.y);await page.mouse.down();release();
        await page.locator('.notification-dock-toggle:visible').waitFor();
        await page.locator('.today-order-toggle:visible').waitFor();
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        const after=await account.boundingBox();assert(after);
        const stillAccount=await page.evaluate(({x,y})=>Boolean(document.elementFromPoint(x,y)?.closest('.account-open')),point);
        await page.mouse.up();
        Object.assign(row,{before,after,heldModules:[...held],sameHitTarget:stillAccount,routeErrors});
        for(const property of ['x','y','width','height'])assert(Math.abs(before[property]-after[property])<=0.5,`Account ${property} shifted while pressed`);
        assert(stillAccount,'Pointer release must still hit the account control');
        await page.locator('.account-panel').waitFor();
        assert.equal(await page.locator('html').getAttribute('data-genesis-theme'),desired);
        assert.deepEqual(routeErrors,[]);assert.deepEqual(errors,[]);
        await page.screenshot({path:path.join(output,`${width}-${scheme}-opened.png`),fullPage:true,animations:'disabled'});
        row.status='PASS';
      } catch(error){row.status='FAIL';row.error=error.message;}
      finally {release();await context.close();save();}
      console.log(`${row.status} ${row.id}`);
    }
  } finally {if(ownBrowser)await browser.close();}
  report.status=report.cases.length===8&&report.cases.every(row=>row.status==='PASS')?'PASS':'FAIL';save();
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=await runHeaderStartup({baseURL:process.env.GENESIS_QA_WEB_ORIGIN,output:process.env.GENESIS_QA_WEB_OUTPUT});
  if(report.status!=='PASS')process.exitCode=1;
}
