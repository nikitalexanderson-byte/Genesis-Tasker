import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {chromium} from '../mindmaps/browser.mjs';
const origin='http://127.0.0.1:4342';
const fixture=JSON.parse(readFileSync('output/mobile-fixture.json'));
const state=JSON.parse(readFileSync('output/browser-state.json'));
state.origins=state.origins.map(o=>({...o,origin:o.origin.replace('4340','4342')}));
const dir='output/playwright/tablet-web';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome'});const results=[];
// These are Chromium touch viewports, NOT Android OS emulators.
const cases=[{width:600,height:960,rotated:{width:960,height:600}},{width:800,height:1280,rotated:{width:1280,height:800}},{width:1280,height:800,rotated:{width:800,height:1280}}];
try {for(const size of cases)for(const theme of ['standart','standart-dark']) {
 const context=await browser.newContext({storageState:state,viewport:{width:size.width,height:size.height},isMobile:true,hasTouch:true});
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const title=`Планшетная проверка ${size.width} ${theme} ${Date.now()}`;
 const url=`${origin}/?affairs=shared&space=${fixture.space}&project=${fixture.project}#projects`;
 const api=path=>page.evaluate(async path=>{const r=await fetch('/api'+path);if(!r.ok)throw Error(String(r.status));return r.json()},path);
 const noOverflow=async()=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 try {
  await page.goto(url);await page.locator('.shared-project-workspace').waitFor();
  const session=await api('/session');assert.ok(session.user.email.endsWith('@example.invalid'));
  await page.evaluate(t=>document.documentElement.dataset.genesisTheme=t,theme);
  const views=page.getByRole('group',{name:'Вид проекта',exact:true});
  assert.equal(await views.getByRole('button',{name:size.width<1100?'Список':'Доски',exact:true}).getAttribute('aria-pressed'),'true');
  await page.locator('.shared-projects-open-modal').tap();let dialog=page.getByRole('dialog',{name:'Новая задача команды'});
  assert.equal(await dialog.getByRole('combobox',{name:'Проект или подпроект'}).inputValue(),fixture.project);
  assert.equal(await dialog.getByRole('button',{name:'Создать задачу',exact:true}).isDisabled(),true);
  await dialog.getByRole('textbox',{name:'Название',exact:true}).fill(title);
  await dialog.locator('summary').filter({hasText:'Даты и планирование'}).tap();await dialog.getByLabel('Окончание',{exact:true}).fill('2026-10-27');
  await dialog.getByRole('button',{name:'Создать задачу',exact:true}).tap();await dialog.waitFor({state:'hidden'});
  let snapshot=await api(`/shared/projects/${fixture.project}`);let task=snapshot.tasks.find(t=>t.title===title);assert.ok(task);
  const search=page.getByLabel('Поиск задач и проектов по названию или #тегу',{exact:true});await search.fill(title);await page.locator('.tag-search-results button').first().tap();dialog=page.locator('.shared-task-modal[open]');await dialog.waitFor();
  await dialog.getByRole('combobox',{name:'Исполнитель',exact:true}).selectOption({index:1});await page.waitForFunction(()=>!document.querySelector('.shared-task-modal select:disabled'));
  await dialog.getByRole('combobox',{name:'Доска',exact:true}).selectOption(snapshot.statuses[1].id);await dialog.getByText('Задача перемещена.',{exact:true}).waitFor();
  const name=dialog.getByRole('textbox',{name:'Название',exact:true});await name.fill('');assert.equal(await name.evaluate(e=>e.checkValidity()),false);
  const edited=title+' — сохранённый длинный заголовок';await name.fill(edited);await dialog.getByRole('textbox',{name:'Описание',exact:true}).fill('Черновик после поворота и узкого окна');
  await dialog.getByRole('button',{name:/^Комментарии ·/}).tap();const comment=dialog.getByRole('textbox',{name:'Комментарий · @ для упоминания коллеги',exact:true});await comment.fill('Тестовый комментарий планшета');
  await page.setViewportSize(size.rotated);await noOverflow();assert.equal(await comment.inputValue(),'Тестовый комментарий планшета');
  await dialog.getByRole('button',{name:'Задача',exact:true}).tap();assert.equal(await name.inputValue(),edited);
  await page.setViewportSize({width:640,height:800});await noOverflow();assert.equal(await name.inputValue(),edited);
  await dialog.getByRole('button',{name:'Сохранить задачу',exact:true}).tap();await dialog.getByText('Задача сохранена.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:/^Комментарии ·/}).tap();assert.equal(await comment.inputValue(),'Тестовый комментарий планшета');
  await page.route('**/api/shared/projects/*/tasks/*/comments',r=>r.request().method()==='POST'?r.fulfill({status:500,contentType:'application/json',body:'{"error":"TEST_FAILURE"}'}):r.continue());
  await dialog.getByRole('button',{name:'Отправить комментарий',exact:true}).tap();await dialog.getByText('Не удалось отправить комментарий. Черновик сохранён.',{exact:true}).waitFor();assert.equal(await comment.inputValue(),'Тестовый комментарий планшета');await page.unrouteAll({behavior:'wait'});
  await dialog.getByRole('button',{name:'Отправить комментарий',exact:true}).tap();await dialog.locator('.shared-comment-list').getByText('Тестовый комментарий планшета',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Закрыть задачу',exact:true}).tap();assert.equal(await search.inputValue(),title);
  await page.locator('.tag-search-results button').first().tap();await dialog.waitFor();await page.goBack();await dialog.waitFor({state:'hidden'});assert.equal(await search.inputValue(),title);
  await page.reload();await page.locator('.shared-project-workspace').waitFor();snapshot=await api(`/shared/projects/${fixture.project}`);task=snapshot.tasks.find(t=>t.id===task.id);assert.equal(task.title,edited);assert.equal(task.dueDate,'2026-10-27');assert.equal(task.statusId,snapshot.statuses[1].id);assert.ok(task.assigneeId);
  await page.setViewportSize({width:size.width,height:size.height});await search.fill('совпадений-нет-000');await page.getByText('Совпадений нет',{exact:true}).waitFor();await search.fill('');
  for(const [name,selector] of [['Доски','.shared-projects-board'],['Календарь','.shared-projects-calendar'],['Гант','.shared-gantt'],['Список','.shared-projects-list']]){await views.getByRole('button',{name,exact:true}).tap();await page.locator(selector).waitFor();await noOverflow();}
  await page.setViewportSize(size.rotated);assert.equal(await views.getByRole('button',{name:'Список',exact:true}).getAttribute('aria-pressed'),'true');await page.setViewportSize({width:size.width,height:size.height});
  // Remove only the synthetic task created by this iteration.
  await page.evaluate(async({project,id,revision})=>{const s=await(await fetch('/api/session')).json();const r=await fetch(`/api/shared/projects/${project}/tasks/${id}`,{method:'DELETE',headers:{'Content-Type':'application/json','X-CSRF-Token':s.csrf},body:JSON.stringify({expectedRevision:revision})});if(!r.ok)throw Error('Synthetic cleanup '+r.status)},{project:fixture.project,id:task.id,revision:task.revision});

  await page.getByRole('button',{name:'Личные',exact:true}).tap();await page.locator('.project-tree-workspace').waitFor();await page.getByRole('button',{name:'Майндмепы',exact:true}).tap();await page.getByRole('button',{name:'Создать карту',exact:true}).tap();
  dialog=page.getByRole('dialog',{name:'Новая карта'});await dialog.getByRole('textbox',{name:'Название карты',exact:true}).fill(title);await dialog.getByRole('button',{name:'Создать карту',exact:true}).tap();
  const saved=()=>page.locator('.mindmap-save-state').filter({hasText:'Синхронизировано с сервером'}).waitFor();await saved();
  await page.getByRole('button',{name:'Структура',exact:true}).tap();
  if(size.width<1100){await page.locator('.mindmap-row').first().tap();}else{assert.equal(await page.locator('.mindmap-inspector').isVisible(),true);await page.getByRole('button',{name:/^Изменить узел:/}).first().tap();}
  dialog=page.getByRole('dialog',{name:'Редактор узла'});await dialog.waitFor();const note=dialog.getByRole('textbox',{name:'Пояснение · только в карте',exact:true});await note.fill('Планшетный черновик, переход между боковой панелью и отдельным редактором');
  await page.setViewportSize(size.rotated);assert.equal(await note.inputValue(),'Планшетный черновик, переход между боковой панелью и отдельным редактором');await noOverflow();await page.screenshot({path:`${dir}/rotation-node-${size.width}-${theme}.png`});
  await dialog.getByRole('button',{name:'Добавить дочернюю мысль',exact:true}).tap();await dialog.getByRole('textbox',{name:'Название мысли',exact:true}).fill('Длинная мысль для проверки планшетного редактора и сохранения');await dialog.getByRole('button',{name:'Закрыть окно карты',exact:true}).tap();await saved();
  await page.setViewportSize({width:640,height:800});await page.locator('.mindmap-row').filter({hasText:'Длинная мысль'}).tap();await dialog.waitFor();await dialog.getByRole('combobox',{name:'Переместить в ветку',exact:true}).selectOption({label:title});await dialog.getByRole('button',{name:'Переместить узел',exact:true}).tap();await dialog.getByRole('button',{name:'Закрыть окно карты',exact:true}).tap();await saved();
  await page.reload();await page.locator('.mindmap-row').filter({hasText:'Длинная мысль'}).waitFor();await page.getByRole('textbox',{name:'Найти узел',exact:true}).fill('Длинная мысль');await page.locator('.mindmap-search-results button').tap();await dialog.waitFor();await dialog.getByRole('button',{name:'Создать задачу из мысли',exact:true}).tap();await page.locator('.task-composer-modal').getByRole('button',{name:'Добавить задачу',exact:true}).tap();await saved();
  await page.locator('.mindmap-row').filter({hasText:'Длинная мысль'}).tap();await dialog.getByRole('button',{name:'Выполнить задачу',exact:true}).tap();await page.getByText('Связанные задачи: 1 из 1',{exact:true}).waitFor();await page.goBack();await dialog.waitFor({state:'hidden'});
  await page.setViewportSize({width:size.width,height:size.height});await page.getByRole('button',{name:'Карта',exact:true}).tap();await page.locator('.mindmap-canvas').waitFor();await page.getByRole('button',{name:'Увеличить масштаб',exact:true}).tap();await page.getByRole('button',{name:'К выбранному узлу',exact:true}).tap();await noOverflow();
  await page.getByRole('button',{name:'Все майндмепы',exact:true}).tap();await page.getByRole('textbox',{name:'Поиск карт',exact:true}).fill(title);await page.getByRole('combobox',{name:'Контекст проекта',exact:true}).selectOption('p-pilot');await page.getByText('Ничего не найдено. Измените запрос.',{exact:true}).waitFor();await page.getByRole('combobox',{name:'Контекст проекта',exact:true}).selectOption('');await page.locator('.mindmap-catalog article').filter({hasText:title}).getByRole('button',{name:'Архивировать',exact:true}).tap();
  await page.goto(url);await page.locator('.shared-project-workspace').waitFor();await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/'});await navigator.serviceWorker.ready;});await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);await page.reload();await page.locator('.shared-project-workspace').waitFor();await page.waitForTimeout(500);
  await context.setOffline(true);await page.reload();await page.locator('.shared-project-workspace').waitFor();await page.getByText('Нет связи:',{exact:false}).first().waitFor();await noOverflow();await page.screenshot({path:`${dir}/pwa-offline-${size.width}-${theme}.png`});await context.setOffline(false);await page.reload();await page.locator('.shared-project-workspace').waitFor();
  assert.deepEqual(errors,[]);results.push({...size,theme,shared:true,commentsErrorRetry:true,rotationDraft:true,narrowWindowDraft:true,reload:true,explicitViewPreserved:true,mindmap:true,conversion:true,offlineReload:true,errors});console.log('PASS tablet',size.width,size.height,theme);
 }catch(error){await page.screenshot({path:`${dir}/failure-${size.width}-${theme}.png`});writeFileSync(`${dir}/failure-dom.txt`,await page.locator('body').ariaSnapshot());throw error;}finally{await context.close();}
 }writeFileSync(`${dir}/functional-results.json`,JSON.stringify({androidEmulator:false,browser:'Chromium touch emulation',results},null,2));}finally{await browser.close();}
