import {readFileSync,writeFileSync} from 'node:fs';import assert from 'node:assert/strict';
import {chromium} from './browser.mjs';
const state=JSON.parse(readFileSync('output/browser-state.json'));const original=JSON.parse(readFileSync('output/mindmaps-e2e-result.json'));
const b=await chromium.launch({headless:true,channel:'chrome'});const c=await b.newContext({storageState:state});const p=await c.newPage();await p.goto(original.mapUrl);await p.getByRole('button',{name:'Структура',exact:true}).click();const before=await (await p.request.get('http://127.0.0.1:4319/api/mindmaps')).json();
state.origins=state.origins.map(o=>({...o,origin:o.origin.replace(':4319',':4322')}));const off=await b.newContext({storageState:state});const q=await off.newPage();await q.goto(original.mapUrl.replace(':4319',':4322'));await q.getByRole('button',{name:/^Текущие/}).waitFor();
assert.equal(await q.getByRole('button',{name:'Майндмепы',exact:true}).count(),0);assert.equal(await q.locator('.mindmaps').count(),0);assert.deepEqual(await (await q.request.get('http://127.0.0.1:4322/api/mindmaps')).json(),before);await off.close();
const metrics=[];
for(const width of [320,1440])for(const theme of ['standart','standart-dark']){
 await p.setViewportSize({width,height:960});await p.goto(original.mapUrl);await p.reload();await p.getByRole('button',{name:'Структура',exact:true}).click();
 await p.evaluate(t=>{document.documentElement.dataset.genesisTheme=t;const sizes=[...document.querySelectorAll('body *')].map(e=>[e,parseFloat(getComputedStyle(e).fontSize)]);for(const[e,s]of sizes)e.style.setProperty('font-size',(s*2)+'px','important');},theme);
 await p.screenshot({path:`output/playwright/mindmaps/after/text200-${theme}-${width}.png`,fullPage:true});
 metrics.push({width,theme,...await p.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,map:document.querySelector('.mindmaps').scrollWidth}))});
}
writeFileSync('output/mindmaps-flagoff-text-result.json',JSON.stringify({flagoff:'entry hidden; ordinary affairs usable; encrypted API envelopes exactly unchanged',textResizeMethod:'all computed font sizes doubled, CSS text resize simulation, not physical device OS scaling',metrics},null,2));console.log(metrics);assert.ok(metrics.every(m=>m.scroll<=m.viewport));await b.close();
