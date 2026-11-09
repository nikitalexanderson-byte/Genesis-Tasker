import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {chromium} from '../mindmaps/browser.mjs';
const fixture=JSON.parse(readFileSync('output/mobile-fixture.json'));const state=JSON.parse(readFileSync('output/browser-state.json'));
const origin='http://127.0.0.1:4342';state.origins=state.origins.map(item=>({...item,origin:item.origin.replace('4340','4342')}));
const browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({storageState:state,viewport:{width:390,height:844},isMobile:true,hasTouch:true});const page=await context.newPage();page.setDefaultTimeout(20000);
try{
await page.goto(`${origin}/?affairs=shared&space=${fixture.space}&project=${fixture.project}#projects`);await page.locator('.shared-project-workspace').waitFor();
// Local previews deliberately skip registration. Register the production worker explicitly
// to verify its cache/offline behavior, without claiming a real installation on a phone.
await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;});
await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await page.reload();await page.locator('.shared-project-workspace').waitFor();await page.waitForTimeout(500);
const online=await page.locator('.shared-project-workspace h2').first().innerText();
await context.setOffline(true);await page.reload();await page.locator('.shared-project-workspace').waitFor();assert.equal(await page.locator('.shared-project-workspace h2').first().innerText(),online);await page.getByText('Нет связи:',{exact:false}).first().waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
await page.screenshot({path:'output/playwright/mobile-web/pwa-offline-reload-390.png'});await context.setOffline(false);await page.reload();await page.locator('.shared-project-workspace').waitFor();
writeFileSync('output/playwright/mobile-web/pwa-results.json',JSON.stringify({productionBuild:true,explicitLocalWorkerRegistration:true,controlled:true,offlineReloadRestoresProtectedSharedSnapshot:true,reconnectReload:true,physicalInstall:false},null,2));console.log('PASS built service worker, offline reload with shared snapshot, reconnect');
}catch(e){await page.screenshot({path:'output/playwright/mobile-web/pwa-failure.png'});console.log((await page.locator('body').innerText()).slice(-2200));throw e;}finally{await browser.close();}
