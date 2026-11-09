import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from '../mindmaps/browser.mjs';
const phase=process.argv[2]||'before';
const origin='http://127.0.0.1:4342';
const fixture=JSON.parse(readFileSync('output/mobile-fixture.json'));
const state=JSON.parse(readFileSync('output/browser-state.json'));
state.origins=state.origins.map(o=>({...o,origin:o.origin.replace('4340','4342')}));
const dir='output/playwright/tablet-web';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
const sizes=phase==='desktop'?[[1440,900]]:phase==='regression'?[[360,844],[390,844],[1440,900]]:[[600,960],[960,600],[800,1280],[1280,800],[768,1024],[1024,768],[640,800]];
try {for(const [width,height] of sizes)for(const theme of ['standart','standart-dark']) {
 const context=await browser.newContext({storageState:state,viewport:{width,height},isMobile:phase!=='desktop',hasTouch:phase!=='desktop',deviceScaleFactor:2});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const result={width,height,theme,errors,states:[]};
 const shot=async name=>{
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});
  await page.screenshot({path:`${dir}/${phase}-${name}-${width}x${height}-${theme}.png`,animations:'disabled'});
  const metrics=await page.evaluate(()=>{
   const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,display:getComputedStyle(e).display};};
   return {overflow:document.documentElement.scrollWidth>innerWidth,viewport:{width:innerWidth,height:innerHeight},firstTask:rect('[data-shared-task-id]'),workspace:rect('.shared-projects-workspace'),mindmap:rect('.mindmap-editor'),inspector:rect('.mindmap-inspector'),smallControls:[...document.querySelectorAll('.shared-projects button,.shared-projects select,.project-tree-workspace button,.mindmaps button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.height<43||r.width<43)}).slice(0,16).map(e=>({name:(e.getAttribute('aria-label')||e.textContent).slice(0,80),width:Math.round(e.getBoundingClientRect().width),height:Math.round(e.getBoundingClientRect().height)}))};
  });result.states.push({name,...metrics});
  if(['final','regression','desktop'].includes(phase))assert.equal(metrics.overflow,false,`${name}/${width}/${theme}`);
 };
 try {
  await page.goto(`${origin}/?affairs=shared&space=${fixture.space}&project=${fixture.project}#projects`);await page.locator('.shared-project-workspace').waitFor();await page.evaluate(t=>document.documentElement.dataset.genesisTheme=t,theme);await shot('shared');
  await page.getByLabel('Поиск задач и проектов по названию или #тегу',{exact:true}).fill('длинное название');await page.locator('.tag-search-results button').first().click();await page.locator('.shared-task-modal[open]').waitFor();await shot('task');await page.getByRole('button',{name:'Закрыть задачу',exact:true}).click();
  await page.getByRole('button',{name:'Личные',exact:true}).click();await page.locator('.project-tree-workspace').waitFor();await shot('personal');
  await page.getByRole('button',{name:'Майндмепы',exact:true}).click();await page.locator('.mindmap-catalog-open').first().waitFor();await shot('catalog');
  await page.locator('.mindmap-catalog-open').filter({hasText:'Подготовка встречи'}).first().click();await page.getByRole('button',{name:'Структура',exact:true}).click();await shot('outline');
  await page.getByRole('button',{name:'Карта',exact:true}).click();await page.locator('.mindmap-canvas').waitFor();await shot('canvas');
  console.log('CAPTURED',phase,width,height,theme,JSON.stringify(result.states.map(s=>({name:s.name,overflow:s.overflow,small:s.smallControls.length,taskTop:s.firstTask?.y,mapWidth:s.mindmap?.width}))));
  if(['final','regression','desktop'].includes(phase))assert.deepEqual(errors,[]);
  results.push(result);
 } catch(error){await page.screenshot({path:`${dir}/${phase}-failure-${width}-${theme}.png`});throw error;}finally{await context.close();}
 }writeFileSync(`${dir}/${phase}-audit.json`,JSON.stringify(results,null,2));}finally{await browser.close();}
