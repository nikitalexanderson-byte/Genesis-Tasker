// Run only against the isolated PHP/SQLite fixture, never production.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '../mindmaps/browser.mjs';
const fixture=JSON.parse(readFileSync('output/mobile-fixture.json'));
const origin='http://127.0.0.1:4340';
const dir='output/playwright/mobile-web';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const results=[];
try {
for(const width of [360,390,430])for(const theme of ['standart','standart-dark']){
 const context=await browser.newContext({storageState:'output/browser-state.json',viewport:{width,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const title=`Проверка ${width} ${theme} ${Date.now()}`;const url=`${origin}/?affairs=shared&space=${fixture.space}&project=${fixture.project}#projects`;
 const dialog=page.locator('.shared-task-modal');
 const api=async path=>page.evaluate(async path=>{const r=await fetch(path);if(!r.ok)throw Error(String(r.status));return r.json()},'/api'+path);
 try {
 await page.goto(url);await page.locator('.shared-project-workspace').waitFor();await page.evaluate(theme=>document.documentElement.dataset.genesisTheme=theme,theme);
 assert.equal(await page.getByRole('button',{name:'Список',exact:true}).getAttribute('aria-pressed'),'true');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.locator('.shared-projects-open-modal').click();const create=page.getByRole('dialog',{name:'Новая задача команды'});
 assert.equal(await create.getByRole('button',{name:'Создать задачу',exact:true}).isDisabled(),true);
 assert.equal(await create.getByRole('combobox',{name:'Проект или подпроект'}).inputValue(),fixture.project);
 await create.getByRole('textbox',{name:'Название',exact:true}).fill(title);
 await create.locator('summary').filter({hasText:'Даты и планирование'}).click();
 await create.getByLabel('Окончание',{exact:true}).fill('2026-10-24');
 await create.getByRole('button',{name:'Создать задачу',exact:true}).click();await create.waitFor({state:'hidden'});
 let snapshot=await api(`/shared/projects/${fixture.project}`);const task=snapshot.tasks.find(t=>t.title===title);assert.ok(task,'Created in current project');assert.equal(task.dueDate,'2026-10-24');
 const search=page.getByLabel('Поиск задач и проектов по названию или #тегу',{exact:true});await search.fill(title);await page.locator('.tag-search-results button').first().waitFor();
 await page.locator('.tag-search-results button').first().click();await dialog.waitFor({state:'visible'});
 await dialog.getByRole('combobox',{name:'Исполнитель',exact:true}).selectOption({index:1});await page.waitForFunction(()=>!document.querySelector('.shared-task-modal select:disabled'));
 await dialog.getByRole('combobox',{name:'Доска',exact:true}).selectOption(snapshot.statuses[1].id);await dialog.getByText('Задача перемещена.',{exact:true}).waitFor();
 await dialog.getByRole('textbox',{name:'Название',exact:true}).fill('');assert.equal(await dialog.getByRole('textbox',{name:'Название',exact:true}).evaluate(e=>e.checkValidity()),false);
 const edited=title+' — сохранено';await dialog.getByRole('textbox',{name:'Название',exact:true}).fill(edited);
 await dialog.getByRole('textbox',{name:'Описание',exact:true}).fill('Проверены длинные названия, назначение и сохранение на мобильном экране.');
 await dialog.getByLabel('Окончание',{exact:true}).fill('2026-10-25');
 await dialog.getByRole('button',{name:/^Комментарии ·/}).click();
 const comment=dialog.getByRole('textbox',{name:'Комментарий · @ для упоминания коллеги',exact:true});await comment.fill('Синтетический комментарий '+width);
 await dialog.getByRole('button',{name:'Задача',exact:true}).click();assert.equal(await dialog.getByRole('textbox',{name:'Название',exact:true}).inputValue(),edited);
 await dialog.getByRole('button',{name:'Сохранить задачу',exact:true}).click();await dialog.getByText('Задача сохранена.',{exact:true}).waitFor();
 await dialog.getByRole('button',{name:/^Комментарии ·/}).click();assert.equal(await comment.inputValue(),'Синтетический комментарий '+width);
 if(width===360){
  await page.route('**/api/shared/projects/*/tasks/*/comments',async route=>route.request().method()==='POST'?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'TEST_FAILURE'})}):route.continue());
  await dialog.getByRole('button',{name:'Отправить комментарий',exact:true}).click();await dialog.getByText('Не удалось отправить комментарий. Черновик сохранён.',{exact:true}).waitFor();assert.equal(await comment.inputValue(),'Синтетический комментарий '+width);
  await page.screenshot({path:`${dir}/error-comment-${theme}-${width}.png`});await page.unroute('**/api/shared/projects/*/tasks/*/comments');
 }
 await dialog.getByRole('button',{name:'Отправить комментарий',exact:true}).click();await dialog.locator('.shared-comment-list').getByText('Синтетический комментарий '+width,{exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Закрыть задачу',exact:true}).click();assert.equal(await search.inputValue(),title);
 await page.locator('.tag-search-results button').first().click();await dialog.waitFor({state:'visible'});await page.goBack();await dialog.waitFor({state:'hidden'});assert.equal(await search.inputValue(),title);
 await page.reload();await page.locator('.shared-project-workspace').waitFor();snapshot=await api(`/shared/projects/${fixture.project}`);const saved=snapshot.tasks.find(t=>t.id===task.id);assert.equal(saved.title,edited);assert.equal(saved.dueDate,'2026-10-25');assert.equal(saved.statusId,snapshot.statuses[1].id);assert.ok(saved.assigneeId);
 await search.fill('нет-такой-задачи-0000');await page.getByText('Совпадений нет',{exact:true}).waitFor();await page.screenshot({path:`${dir}/empty-search-${theme}-${width}.png`});await search.fill('');
 await page.getByRole('button',{name:'Доски',exact:true}).click();await page.locator('.shared-projects-board').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 const views=page.getByRole('group',{name:'Вид проекта',exact:true});await views.getByRole('button',{name:'Календарь',exact:true}).click();await page.locator('.shared-projects-calendar').waitFor();await views.getByRole('button',{name:'Гант',exact:true}).click();await page.locator('.shared-gantt').waitFor();await views.getByRole('button',{name:'Список',exact:true}).click();
 await context.setOffline(true);await page.getByText('Нет связи:',{exact:false}).first().waitFor();await page.screenshot({path:`${dir}/offline-${theme}-${width}.png`});await context.setOffline(false);
 assert.deepEqual(errors,[]);results.push({width,theme,passed:['create in current project','empty title validation','due date','assignee','status without drag','edit title and description','draft across tabs','comment and retry','retain search','browser Back','reload persistence','no-results state','list/board/calendar/gantt','offline notice'],errors});console.log('PASS',width,theme);
 // Delete only the uniquely named synthetic task created by this run.
 await page.evaluate(async({project,id,revision})=>{const s=await(await fetch('/api/session')).json();const r=await fetch(`/api/shared/projects/${project}/tasks/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({expectedRevision:revision})});if(!r.ok)throw Error('Fixture cleanup '+r.status)},{project:fixture.project,id:saved.id,revision:saved.revision});
 }catch(e){await page.screenshot({path:`${dir}/functional-failure-${width}-${theme}.png`});writeFileSync(`${dir}/functional-failure-dom.txt`,await page.locator('body').ariaSnapshot());throw e;}finally{await context.close();}
}
writeFileSync(`${dir}/shared-functional-results.json`,JSON.stringify(results,null,2));
}finally{await browser.close();}
