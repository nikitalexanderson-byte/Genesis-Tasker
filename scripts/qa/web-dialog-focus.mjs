import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const origin=process.env.GENESIS_QA_WEB_ORIGIN,output=process.env.GENESIS_QA_WEB_OUTPUT;
assert(/^http:\/\/127\.0\.0\.1:\d+$/.test(origin??'')&&output,'Owned loopback runtime required');
const browser=await chromium.launch({headless:true}),results=[];
try{
 const context=await browser.newContext({baseURL:origin,viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});
 await context.route(/https?:\/\//,route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
 await context.addInitScript(()=>{
  localStorage.setItem('genesis-language-v1','ru');
  window.__dialogFocusCalls=[];
  const describe=el=>({tag:el?.tagName,classes:el?.className,label:el?.getAttribute('aria-label'),connected:el?.isConnected});
  document.addEventListener('focusin',event=>window.__dialogFocusCalls.push({kind:'focusin',...describe(event.target)}));
 });
 const login=await context.request.get('/api/qa/login?tier=business');assert(login.ok()&&(await login.json()).synthetic);
 const page=await context.newPage();page.setDefaultTimeout(20000);
 await page.goto('/#habits');await page.getByRole('button',{name:'Новая привычка',exact:true}).waitFor();
 await page.goto('/?affairs=personal&mindmap=catalog#projects');await page.locator('.mindmap-create-map').click();
 const create=page.getByRole('dialog',{name:'Новая карта',exact:true});await create.getByRole('textbox',{name:'Название карты',exact:true}).fill('QA dialog focus');await create.getByRole('button',{name:'Создать карту',exact:true}).click();
 await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});const url=page.url();
 for(const width of [360,390,768,1440])for(const scheme of ['light','dark']){
  await page.goto(url);await page.setViewportSize({width,height:1000});await page.locator('.theme-mode-toggle:visible:not([disabled])').first().waitFor();
  const desired=scheme==='dark'?'standart-dark':'standart';if(await page.locator('html').getAttribute('data-genesis-theme')!==desired)await page.locator('.theme-mode-toggle:visible').first().click();
  await page.waitForFunction(desired=>document.documentElement.dataset.genesisTheme===desired,desired);await page.locator('.mindmap-save-state[data-save-state="synced"]').waitFor({state:'attached'});
  const view=page.locator('.mindmap-view-toggle');if(await view.getAttribute('aria-label')==='Карта')await view.click();await page.locator('.mindmap-canvas').waitFor();await view.click();await page.locator('.mindmap-structure').waitFor();
  await page.evaluate(()=>window.__dialogFocusCalls=[]);
  const trigger=page.locator('.mindmap-settings-toggle');await trigger.evaluate(node=>window.__originalSettingsButton=node);await trigger.click();const dialog=page.getByRole('dialog',{name:'Настройка карты',exact:true});await dialog.waitFor();
  const focusable=dialog.locator('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled])');await focusable.first().focus();await page.keyboard.press('Shift+Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)));await focusable.last().focus();await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)));
  if(width>=1100){await page.setViewportSize({width:768,height:1000});await page.locator('.mindmap-canvas-search').waitFor();await page.setViewportSize({width,height:1000});await page.locator('.mindmap-canvas-search').waitFor({state:'hidden'});}
  await page.screenshot({path:`${output}/settings-${width}-${scheme}.png`,fullPage:true,animations:'disabled'});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  const restored=await page.waitForFunction(()=>document.activeElement===window.__originalSettingsButton&&window.__originalSettingsButton?.isConnected,{},{timeout:2000}).then(()=>true,()=>false);
  const trace=await page.evaluate(()=>({active:{tag:document.activeElement?.tagName,classes:document.activeElement?.className,label:document.activeElement?.getAttribute('aria-label')},originalConnected:window.__originalSettingsButton?.isConnected,events:window.__dialogFocusCalls.slice(-20)}));
  results.push({width,scheme,status:restored?'PASS':'FAIL',trace});writeFileSync(`${output}/results.json`,JSON.stringify({results},null,2));console.log(`${restored?'PASS':'FAIL'} dialog-focus ${width} ${scheme}`);if(!restored)console.error(JSON.stringify(trace));
 }
 await context.close();
}finally{await browser.close();}
if(results.some(row=>row.status!=='PASS'))process.exitCode=1;
