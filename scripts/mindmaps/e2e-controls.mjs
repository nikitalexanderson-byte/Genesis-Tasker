import {chromium} from './browser.mjs';import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
const result=JSON.parse(readFileSync('output/mindmaps-e2e-result.json'));const b=await chromium.launch({headless:true,channel:'chrome'});const checks=[];
for(const timezoneId of ['Europe/Moscow','America/Los_Angeles']){
 const c=await b.newContext({storageState:'output/browser-state.json',timezoneId,viewport:{width:390,height:960}});const p=await c.newPage();
 const preference=async timeFormat=>p.evaluate(async timeFormat=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/app/cloud-sync.ts')).name;const api=await import(url);await api.updateAccountPreferences({timeFormat});},timeFormat);
 await p.goto(result.mapUrl);await p.getByRole('button',{name:'Структура',exact:true}).waitFor();
 try{
  for(const timeFormat of ['24h','12h']){
   await preference(timeFormat);await p.reload();await p.getByRole('button',{name:'Добавить мысль',exact:true}).click();await p.getByRole('dialog').getByRole('textbox',{name:'Название мысли',exact:true}).fill('Проверка календарных контролов');await p.getByRole('dialog').getByRole('button',{name:'Создать задачу из мысли'}).click();
   const form=p.locator('form[aria-label="Создание задачи"]');await form.waitFor();
   const displayMode=await p.locator('.calendar-mode-cycle').getAttribute('data-calendar-mode');assert.ok(['sacred','lunar','profane'].includes(displayMode));
   for(const mode of ['Сакральный','Лунный','Григорианский']){
    await form.getByRole('group',{name:'Календарь записи',exact:true}).getByRole('button',{name:mode,exact:true}).click();
    if(mode==='Григорианский'){assert.equal(await form.locator('[id$="-task-end-date"]').getAttribute('type'),'date');}
    else{
     await form.locator('[id$="-task-end-date"]').click();const picker=p.getByRole('dialog',{name:mode==='Сакральный'?'Выбор сакральной даты':'Выбор лунной даты',exact:true});await picker.waitFor();
     await picker.locator(mode==='Сакральный'?'.sacred-picker-days button:not(:disabled)':'.lunar-picker-days button:not(:disabled)').first().click();
    }
    assert.equal(await p.locator('.calendar-mode-cycle').getAttribute('data-calendar-mode'),displayMode);
    checks.push({timezoneId,timeFormat,inputCalendar:mode});
   }
   await form.getByText('Подробности и настройки',{exact:true}).click();await form.locator('[id$="-new-task-time-hour"]').click();const clock=p.getByRole('dialog',{name:'Выбор времени',exact:true});await clock.waitFor();assert.equal(await clock.getByRole('button',{name:'PM',exact:true}).count(),timeFormat==='12h'?1:0);if(timeFormat==='12h')await clock.getByRole('button',{name:'PM',exact:true}).click();await clock.getByRole('button',{name:'Готово',exact:true}).click();await p.keyboard.press('Escape');await form.waitFor({state:'hidden'});
  }
 }finally{await preference('24h');await c.close();}
}
writeFileSync('output/mindmaps-controls-result.json',JSON.stringify({passed:checks,scope:'Real existing form and preferences on local fixture. Calendar controls open/select; time picker modes open. This is not a live Google timezone/recurrence sync test.'},null,2));console.log('PASS 12 calendar/input/time-format/timezone combinations in actual mobile task form');await b.close();
