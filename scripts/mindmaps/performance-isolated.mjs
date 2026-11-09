
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from './browser.mjs';
const fixture=JSON.parse(readFileSync('output/browser-session.json'));
const b=await chromium.launch({headless:true,channel:'chrome'});
const c=await b.newContext({storageState:'output/browser-state.json',viewport:{width:1440,height:1000}});
const p=await c.newPage();
await p.goto('http://127.0.0.1:4319/#projects');await p.getByRole('button',{name:'Майндмепы',exact:true}).click();
await p.locator('.mindmap-catalog-open').first().waitFor();
const maps=await p.evaluate(async uid=>{
 const path=performance.getEntriesByType('resource').find(e=>e.name.includes('/app/mindmaps-storage.ts')).name.split('?')[0];
 const {MindmapRepository}=await import(path);const repo=new MindmapRepository(uid);const list=await repo.list();
 return [200,1000].map(size=>({size,id:list.find(r=>r.document.title===`Нагрузка ${size} узлов`).document.id}));
},fixture.userId);
async function timedAction(name,selector){
 return p.evaluate(async({name,selector})=>{
   const button=[...document.querySelectorAll('.mindmaps button')].find(b=>b.textContent.trim()===name);
   if(!button)throw new Error('No button '+name);
   const start=performance.now();button.click();
   await new Promise(resolve=>{const check=()=>document.querySelector(selector)?requestAnimationFrame(()=>requestAnimationFrame(resolve)):requestAnimationFrame(check);requestAnimationFrame(check);});
   return Math.round(performance.now()-start);
 },{name,selector});
}
const results=[];
for(const {size,id} of maps){
 await p.goto(`http://127.0.0.1:4319/?mindmap=${id}#projects`);
 await p.waitForFunction(()=>document.querySelector('.mindmap-graph-node'));
 const loadMs=await p.evaluate(()=>Math.round(performance.now()));
 const structure=[],canvas=[];
 for(let i=0;i<5;i++){structure.push(await timedAction('Структура','.mindmap-row'));canvas.push(await timedAction('Карта','.mindmap-graph-node'));}
 await p.getByRole('textbox',{name:'Найти узел',exact:true}).fill(`Мысль ${size-2} —`);
 await p.locator('.mindmap-search-results button').first().click();
 const focusMs=await timedAction('Фокус на ветке','.mindmap-graph-node');
 results.push({nodes:size,loadMs,structureMs:structure,canvasMs:canvas,focusMs});
}
writeFileSync('output/mindmaps-performance-isolated.json',JSON.stringify({browser:b.version(),method:'Isolated local Chrome dev server; DOM click to rendered selector + two animation frames; 5 warm switches, no other build/test processes. Navigation to first graph node. Search precedes focus timing.',results},null,2));console.log(results);await b.close();
