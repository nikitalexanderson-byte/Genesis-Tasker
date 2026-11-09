import {chromium} from './browser.mjs';
import {readFileSync} from 'node:fs';
const s=JSON.parse(readFileSync('output/browser-session.json','utf8'));
const browser=await chromium.launch({headless:true,channel:"chrome"});const context=await browser.newContext({viewport:{width:1440,height:1000}});
await context.addCookies([{name:'GENESISSESSID',value:s.session,url:'http://127.0.0.1:4319'}]);
const page=await context.newPage();
await page.addInitScript(({userId})=>{
 const key='genesis-calendar-v2:'+userId;
 if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({projects:[{id:'p-pilot',title:'Запуск личного проекта',description:'Реальные личные дела тестового аккаунта',tags:[],parentId:null,categoryId:null,status:'active',position:0}],categories:[],tasks:[{id:'task-pilot',title:'Собрать материалы',description:'Задача локального тестового аккаунта',projectId:'p-pilot',project:'Запуск личного проекта',dueDate:'2026-10-12',endDate:'2026-10-12',tags:[],dependsOnIds:[],reminders:[],time:'',done:false,priority:5,recurrence:'none',recurrenceMode:'none',recurrencePattern:'none',recurrenceInterval:1,recurrenceDays:[],recurrenceMonths:[],recurrencePyatas:[],recurrenceExcludedDates:[],googleReadOnly:false,googleLinks:{},syncAccountIds:[],createdIn:'genesis',updatedAt:Date.now(),sacredYear:2026,monthIndex:7,day:1}],taskLists:[],taskListLinks:[]}));
},s);
await page.goto('http://127.0.0.1:4319/#projects');await page.getByRole('button',{name:'Майндмепы',exact:true}).waitFor();await context.storageState({path:'output/browser-state.json'});await browser.close();console.log('Private browser state prepared in ignored output/.');
