import {chromium} from '../mindmaps/browser.mjs';import {existsSync,writeFileSync} from 'node:fs';
if(existsSync('output/mobile-fixture.json'))throw Error('A mobile fixture already exists; reuse it rather than creating duplicates.');
const browser=await chromium.launch({headless:true,channel:'chrome'});const context=await browser.newContext({storageState:'output/browser-state.json'});const page=await context.newPage();
try{await page.goto('http://127.0.0.1:4340/#projects');const fixture=await page.evaluate(async()=>{
 const session=await(await fetch('/api/session')).json();if(!session.user?.email?.endsWith('@example.invalid'))throw Error('Only synthetic fixture accounts are allowed.');
 const api=async(path,body,method='POST')=>{const r=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrf},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(path+':'+r.status);return r.json()};
 await api('/account/preferences',{language:'ru',sharedProjectsEnabled:true},'PUT');
 const {space}=await api('/shared/spaces',{title:'Мастерская ГЕНЕЗИС',description:'Тестовое пространство для подготовки календаря и совместной работы. Только синтетические данные.',invitations:[]});
 const {project}=await api(`/shared/spaces/${space.id}/projects`,{title:'Подготовка осеннего календаря и материалов для нашей команды',description:'Согласуем содержание, проверим даты и подготовим материалы к публикации.',layout:'board'});
 const snapshot=await api(`/shared/projects/${project.id}`,null,'GET');const tasks=[];
 for(const [i,title] of ['Согласовать содержание осеннего календаря','Проверить длинное название задачи: материалы для публикации, иллюстрации и календарные даты','Подготовить иллюстрации','Собрать обратную связь','Проверить ссылки в макете','Опубликовать готовый календарь'].entries())tasks.push(await api(`/shared/projects/${project.id}/tasks`,{title,description:'Тестовая задача. Проверяем удобство работы с содержимым на небольшом экране.',statusId:snapshot.statuses[i%snapshot.statuses.length].id,dueDate:'2026-10-20',tags:['осень']}));
 return {space:space.id,project:project.id,tasks};
});writeFileSync('output/mobile-fixture.json',JSON.stringify(fixture,null,2));console.log('Synthetic mobile fixture created; no invitations.');}finally{await browser.close();}
