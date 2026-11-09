import {chromium} from './browser.mjs';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const b=await chromium.launch({headless:true,channel:'chrome'});
const c=await b.newContext({storageState:'output/browser-state.json',viewport:{width:1440,height:1000}});
const p=await c.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
try {
await p.goto('http://127.0.0.1:4340/#projects');
const fixture=await p.evaluate(async()=>{
 const s=await(await fetch('/api/session')).json();
 const api=async(path,body,method='POST')=>{const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify(body)});if(!r.ok)throw Error(path+':'+r.status);return r.json()};
 await api('/account/preferences',{language:'ru',sharedProjectsEnabled:true},'PUT');
 const {space}=await api('/shared/spaces',{title:'Проверка выпуска 2.8.0',description:'Локальные синтетические данные',invitations:[]});
 const {project}=await api(`/shared/spaces/${space.id}/projects`,{title:'Проект проверки',description:'Заголовок, описание и задачи вместе',layout:'list'});
 return {space:space.id,project:project.id};
});
await p.reload();await p.getByRole('button',{name:'Общие',exact:true}).click();
await p.getByRole('combobox',{name:'Текущее пространство',exact:true}).selectOption(fixture.space);
await p.getByRole('combobox',{name:'Текущий проект',exact:true}).selectOption(fixture.project);
await p.locator('.shared-project-workspace').waitFor();
const categories=p.locator('.shared-project-categories');
assert.equal(await categories.getAttribute('open'),null);
await categories.locator('summary').click();await p.waitForTimeout(600);await p.reload();await categories.waitFor();assert.notEqual(await categories.getAttribute('open'),null);
await categories.locator('summary').click();await p.waitForTimeout(600);await p.reload();await categories.waitFor();assert.equal(await categories.getAttribute('open'),null);
await p.locator('.shared-workspace-toolbar .shared-workspace-search input').waitFor();
assert.equal(await p.locator('.shared-workspace-toolbar .shared-workspace-search input').count(),1);
await p.locator('.shared-project-workspace .shared-projects-context').waitFor();
assert.equal(await p.locator('.shared-project-workspace .shared-projects-context').count(),1);
const viewports=[];
for(const theme of ['standart','standart-dark'])for(const width of [360,390,768,1440]){
 await p.setViewportSize({width,height:1000});await p.evaluate(t=>{document.documentElement.dataset.genesisTheme=t},theme);await p.waitForTimeout(100);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${theme}/${width}`);
 await p.screenshot({path:`output/playwright/resumed/shared-${theme}-${width}.png`,fullPage:true,animations:'disabled'});viewports.push({theme,width,overflow:false});
}
await p.locator('.shared-projects-open-modal').click();
const tabs=p.locator('.task-composer-tabs');
console.log('Creation dialog tabs:',await tabs.innerText());
assert.equal(await tabs.locator('svg').count(),0);
await p.screenshot({path:'output/playwright/resumed/shared-create.png',fullPage:true,animations:'disabled'});
assert.equal(errors.length,0);
writeFileSync('output/resume-shared-results.json',JSON.stringify({defaultCollapsed:true,toggleReloadPersists:true,searchInToolbar:true,unifiedProjectSurface:true,textOnlyCreationTabs:true,viewports,errors},null,2));
console.log('PASS shared preferences, toolbar, project surface, creation tabs and 8 viewport/theme states');
}catch(e){await p.screenshot({path:'output/playwright/resumed/shared-failure.png',fullPage:true});console.log((await p.locator('body').innerText()).slice(-7000));throw e}finally{await b.close()}
